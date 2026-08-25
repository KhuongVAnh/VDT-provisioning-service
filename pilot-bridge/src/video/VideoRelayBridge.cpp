/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/video/VideoRelayBridge.cpp
 * MÔ TẢ: Triển khai toàn bộ quy trình WebRTC WHEP:
 *       1. Sinh SDP Offer chuẩn RFC 8829.
 *       2. Bắt tay HTTP POST WHEP qua NestJS Gateway (Cổng 10004).
 *       3. Đục lỗ NAT ICE STUN & Bắt tay mã hóa DTLS 1.2 qua MediaMTX (Cổng
 * 10005).
 *       4. Giải mã SRTP -> RTP thô và bắn trực tiếp sang UDP 5600 của
 * QGroundControl.
 * ============================================================================
 */

#include "VideoRelayBridge.h"
#include <QFile>
#include <QHostAddress>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QTextStream>
#include <QTimer>
#include <QUrl>
#include <arpa/inet.h>
#include <cstring>
#include <netinet/in.h>
#include <rtc/rtc.hpp>
#include <sys/socket.h>
#include <unistd.h>

VideoRelayBridge::VideoRelayBridge(QObject *parent)
    : QObject(parent), m_httpNet(new QNetworkAccessManager(this)),
      m_statsTimer(new QTimer(this)) {

  // Kết nối timer 1s để cập nhật số liệu tốc độ KB/s và Keyframe request
  connect(m_statsTimer, &QTimer::timeout, this,
          &VideoRelayBridge::onStatsTimer);

  // Khởi tạo mức log cảnh báo cho thư viện libdatachannel
  rtc::InitLogger(rtc::LogLevel::Warning);
}

VideoRelayBridge::~VideoRelayBridge() { stopRelay(); }

void VideoRelayBridge::startRelay(const QString &serverUrl,
                                  const QString &deviceId,
                                  const QString &jwtToken,
                                  quint16 localQgcPort) {
  // Nếu đang có phiên chạy trước đó, dọn dẹp sạch sẽ trước khi tạo phiên mới
  if (m_isRunning) {
    stopRelay();
  }

  // 1. Chuẩn hóa địa chỉ URL máy chủ
  m_serverUrl = serverUrl.trimmed();
  if (m_serverUrl.endsWith('/')) {
    m_serverUrl.chop(1);
  }
  if (!m_serverUrl.startsWith("http://") &&
      !m_serverUrl.startsWith("https://")) {
    m_serverUrl = "http://" + m_serverUrl;
  }

  // 2. Lưu trữ thông số phiên bay
  m_deviceId = deviceId.trimmed();
  m_jwtToken = jwtToken.trimmed();
  m_localQgcPort = localQgcPort;
  m_totalBytesTransferred = 0;
  m_totalPacketsReceived = 0;
  m_packetsInLastSec = 0;
  m_offerSent = false;
  m_isRunning = true;

  // 3. Khởi tạo BSD Socket UDP thuần của hệ điều hành
  // Lý do: Các gói tin video giải mã xong sẽ được xử lý trong Worker Thread của
  // libdatachannel. Dùng socket native ::sendto đảm bảo an toàn 100% đa luồng
  // (Thread-safe), không bị Qt cản trở.
  m_rawUdpSock = ::socket(AF_INET, SOCK_DGRAM, 0);

  // Cấu hình địa chỉ đích: Localhost (127.0.0.1:5600 cho QGroundControl)
  memset(&m_localQgcAddr, 0, sizeof(m_localQgcAddr));
  m_localQgcAddr.sin_family = AF_INET;
  m_localQgcAddr.sin_port = htons(m_localQgcPort);
  m_localQgcAddr.sin_addr.s_addr = inet_addr("127.0.0.1");

  emit logMessage("INFO", QString("🎥 [WebRTC] Bắt đầu kích hoạt cầu nối Video "
                                  "WebRTC cho Drone [%1]...")
                              .arg(m_deviceId));
  emit logMessage(
      "INFO",
      QString("🎥 [WebRTC] Đích chuyển tiếp QGroundControl: UDP 127.0.0.1:%1")
          .arg(m_localQgcPort));

  // 4. Khởi tạo PeerConnection và bắt đầu quy trình WHEP WebRTC
  setupPeerConnection();

  // 5. Kích hoạt bộ đếm thời gian
  m_statsTimer->start(1000);
  emit statusChanged(true, QString("Đang kết nối WebRTC..."));
}

void VideoRelayBridge::setupPeerConnection() {
  // 1. Cấu hình WebRTC & STUN Server
  rtc::Configuration config;
  config.iceServers.emplace_back(
      "stun:stun.l.google.com:19302"); // Hỗ trợ tìm IP Public NAT
  config.enableIceUdpMux = true;

  // 2. Tạo đối tượng kết nối PeerConnection
  m_peerConnection = std::make_shared<rtc::PeerConnection>(config);

  // 3. Lắng nghe trạng thái thay đổi của kết nối WebRTC (State Machine)
  m_peerConnection->onStateChange([this](rtc::PeerConnection::State state) {
    if (!m_isRunning)
      return;

    if (state == rtc::PeerConnection::State::Connected) {
      emit logMessage("SUCCESS", "🟢 [WebRTC] PeerConnection & DTLS Handshake "
                                 "thành công! Đang nhận video SRTP...");
      emit statusChanged(
          true,
          QString("🟢 Video FPV Đang Stream -> UDP %1").arg(m_localQgcPort));
    } else if (state == rtc::PeerConnection::State::Connecting) {
      emit logMessage(
          "INFO", "🔄 [WebRTC] Đang bắt tay DTLS & ICE Connectivity Check...");
    } else if (state == rtc::PeerConnection::State::Disconnected ||
               state == rtc::PeerConnection::State::Failed ||
               state == rtc::PeerConnection::State::Closed) {
      emit logMessage("WARN",
                      "⚠️ [WebRTC] Kết nối WebRTC đã đóng hoặc mất kết nối.");
      emit statusChanged(false, "⚪ Video FPV Đã Tắt");
    }
  });

  // 4. Lắng nghe quá trình thu thập địa chỉ ứng viên ICE (ICE Candidate
  // Gathering) Khi hoàn tất (Complete) -> Toàn bộ candidate đã có trong
  // localDescription -> Gửi SDP Offer
  m_peerConnection->onGatheringStateChange(
      [this, weakPc = std::weak_ptr<rtc::PeerConnection>(m_peerConnection)](
          rtc::PeerConnection::GatheringState state) {
        if (state == rtc::PeerConnection::GatheringState::Complete) {
          if (auto pc = weakPc.lock()) {
            if (!m_offerSent && m_isRunning) {
              auto localDesc = pc->localDescription();
              if (localDesc.has_value()) {
                m_offerSent = true;
                QString sdp =
                    QString::fromStdString(std::string(localDesc.value()));
                // Gọi hàm gửi HTTP qua Main GUI Thread
                QMetaObject::invokeMethod(
                    this, [this, sdp]() { sendWhepOffer(sdp); },
                    Qt::QueuedConnection);
              }
            }
          }
        }
      });

  // 5. Thiết lập hàm xử lý nhận gói tin Video RTP (Data Plane Callback)
  auto setupTrackCallbacks = [this](std::shared_ptr<rtc::Track> track) {
    if (!track)
      return;
    emit logMessage("INFO",
                    "🎥 [WebRTC] Đã thiết lập bộ nhận Video RTP cho Track!");

    // Khi libdatachannel nhận gói tin SRTP, giải mã bảo mật xong -> Bắn vào
    // onMessage dưới dạng RTP thô:
    track->onMessage(
        [this](rtc::binary rtpPacket) {
          if (!m_isRunning || m_rawUdpSock < 0 || rtpPacket.empty())
            return;

          if (m_totalPacketsReceived == 0) {
            emit logMessage(
                "SUCCESS",
                QString("🎉 [WebRTC] Đã nhận gói tin Video RTP đầu tiên (%1 "
                        "bytes)! Bắt đầu bắn sang QGC UDP 5600...")
                    .arg(rtpPacket.size()));
          }

          // Bắn gói tin RTP sang Localhost:5600 cho QGroundControl
          ::sendto(m_rawUdpSock, rtpPacket.data(), rtpPacket.size(), 0,
                   (struct sockaddr *)&m_localQgcAddr, sizeof(m_localQgcAddr));

          // Cập nhật số liệu thống kê truyền tải
          m_totalBytesTransferred += rtpPacket.size();
          m_totalPacketsReceived++;
          m_packetsInLastSec++;
        },
        [](std::string) {});

    track->onClosed([this]() {
      emit logMessage("INFO", "⏹ [WebRTC] Video Track đã đóng.");
    });
  };

  // 6. Khởi tạo mô tả Video Track nhận H.264 (Payload Type 96, RecvOnly)
  rtc::Description::Video videoDesc("video",
                                    rtc::Description::Direction::RecvOnly);
  videoDesc.addH264Codec(96);
  m_videoTrack = m_peerConnection->addTrack(videoDesc);
  setupTrackCallbacks(m_videoTrack);

  // Đăng ký dự phòng nếu MediaMTX khởi tạo track phía remote
  m_peerConnection->onTrack([this, setupTrackCallbacks](
                                std::shared_ptr<rtc::Track> track) {
    if (track && track->description().type() == "video") {
      emit logMessage("INFO", "🎥 [WebRTC] Nhận Video Track từ MediaMTX! Đang "
                              "giải mã SRTP và chuyển tiếp RTP sang UDP...");
      setupTrackCallbacks(track);
    }
  });

  // 7. Yêu cầu PeerConnection sinh bản tin SDP Offer cục bộ
  m_peerConnection->setLocalDescription();

  // 8. Fallback Timer 300ms đề phòng trường hợp mạng không kích hoạt sự kiện
  // GatheringState::Complete
  QTimer::singleShot(300, this, [this]() {
    if (!m_offerSent && m_isRunning && m_peerConnection) {
      auto localDesc = m_peerConnection->localDescription();
      if (localDesc.has_value()) {
        m_offerSent = true;
        QString sdp = QString::fromStdString(std::string(localDesc.value()));
        sendWhepOffer(sdp);
      }
    }
  });
}

void VideoRelayBridge::sendWhepOffer(const QString &sdpOffer) {
  if (m_deviceId.isEmpty() || !m_isRunning)
    return;

  // 1. Tạo đường dẫn WHEP Proxy qua NestJS Gateway
  QString whepUrlStr =
      QString("%1/api/v1/video/%2/whep").arg(m_serverUrl, m_deviceId);
  emit logMessage(
      "INFO",
      QString("🎥 [WebRTC] Gửi SDP Offer WHEP lên Cloud: %1").arg(whepUrlStr));

  // 2. Thiết lập Header HTTP theo chuẩn IETF WHEP (Content-Type:
  // application/sdp)
  QUrl whepUrl(whepUrlStr);
  QNetworkRequest request(whepUrl);
  request.setHeader(QNetworkRequest::ContentTypeHeader, "application/sdp");
  if (!m_jwtToken.isEmpty()) {
    request.setRawHeader("Authorization",
                         QString("Bearer %1").arg(m_jwtToken).toUtf8());
  }

  // 3. Thực hiện gửi bản tin SDP Offer bằng HTTP POST
  QNetworkReply *reply = m_httpNet->post(request, sdpOffer.toUtf8());
  connect(reply, &QNetworkReply::finished, this, [this, reply]() {
    reply->deleteLater();
    if (!m_isRunning || !m_peerConnection)
      return;

    // 4. Tiếp nhận phản hồi SDP Answer từ MediaMTX
    if (reply->error() == QNetworkReply::NoError) {
      QByteArray rawAnswer = reply->readAll();
      QString sdpAnswer = QString::fromUtf8(rawAnswer);

      emit logMessage("SUCCESS",
                      "🟢 [WebRTC] Nhận SDP Answer từ MediaMTX thành công! Bắt "
                      "đầu kết nối PeerConnection...");

      try {
        // Nạp SDP Answer vào PeerConnection -> Kích hoạt đục lỗ ICE và DTLS
        // Handshake
        m_peerConnection->setRemoteDescription(
            rtc::Description(sdpAnswer.toStdString(), "answer"));
      } catch (const std::exception &e) {
        emit logMessage(
            "ERROR",
            QString("🔴 [WebRTC] Lỗi nạp SDP Answer: %1").arg(e.what()));
      }
    } else {
      // Xử lý lỗi nếu Token sai hoặc Drone chưa bật camera
      QString errStr = reply->errorString();
      QByteArray resBody = reply->readAll();
      int statusCode =
          reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
      QString bodyDetail =
          resBody.isEmpty()
              ? ""
              : QString(" (%1)").arg(QString::fromUtf8(resBody).trimmed());
      emit logMessage("WARN",
                      QString("⚠️ [WebRTC] Phản hồi WHEP lỗi (HTTP %1): %2%3.")
                          .arg(statusCode)
                          .arg(errStr)
                          .arg(bodyDetail));
      emit statusChanged(false, QString("Lỗi WHEP HTTP %1").arg(statusCode));
    }
  });
}

void VideoRelayBridge::onStatsTimer() {
  if (!m_isRunning)
    return;

  // Phát Signal cập nhật thống kê lưu lượng cho UI Widget
  emit statsUpdated(m_totalBytesTransferred, m_packetsInLastSec);
  m_packetsInLastSec = 0;

  // Định kỳ yêu cầu Keyframe (RTCP PLI / SPS / PPS) để QGroundControl hiển thị
  // ngay lập tức
  if (m_videoTrack && m_videoTrack->isOpen()) {
    m_videoTrack->requestKeyframe();
  }
}

void VideoRelayBridge::stopRelay() {
  if (!m_isRunning)
    return;

  m_isRunning = false;
  m_offerSent = false;
  m_statsTimer->stop();

  // Đóng socket UDP hệ điều hành
  if (m_rawUdpSock >= 0) {
    ::close(m_rawUdpSock);
    m_rawUdpSock = -1;
  }

  // Đóng Video Track
  if (m_videoTrack) {
    m_videoTrack->close();
    m_videoTrack.reset();
  }

  // Đóng phiên PeerConnection
  if (m_peerConnection) {
    m_peerConnection->close();
    m_peerConnection.reset();
  }

  emit logMessage("INFO", "⏹ [WebRTC] Đã dừng chuyển tiếp Video FPV.");
  emit statusChanged(false, "⚪ Đã tắt Video");
}
