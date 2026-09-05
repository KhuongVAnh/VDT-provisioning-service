/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/video/VideoRelayBridge.cpp
 * MÔ TẢ: Triển khai toàn bộ quy trình WebRTC WHEP (WebRTC HTTP Egress Protocol - RFC 8829):
 *       1. Sinh bản tin SDP Offer cục bộ với Video Track H.264 (Payload Type 96, RecvOnly).
 *       2. Bắt tay HTTP POST WHEP qua NestJS Gateway (Cổng 10004) để gửi SDP Offer và nhận SDP Answer.
 *       3. Đục lỗ NAT ICE STUN & Bắt tay mã hóa bảo mật DTLS 1.2 qua MediaMTX (UDP Cổng 10005).
 *       4. Giải mã gói tin SRTP thành RTP H.264 thô và bắn trực tiếp bằng POSIX Socket ::sendto
 *          sang cổng UDP 5600 của QGroundControl (Zero-Transcoding, Non-blocking GUI, Trễ < 30ms).
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

namespace
{

  /**
   * @brief Kiểm tra xem địa chỉ IP có thuộc dải mạng nội bộ (RFC 1918) hay không.
   */
  bool isPrivateIp(const QString &ip)
  {
    static const QRegularExpression privRe(
        "^(10\\.|192\\.168\\.|127\\.|169\\.254\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.)");
    return privRe.match(ip).hasMatch();
  }

  /**
   * @brief Chuẩn hóa bản tin SDP Answer:
   *        1. Lọc bỏ các candidate IP nội bộ của Cloud VPS (10.1.10.189, 172.x).
   *        2. Ép c=IN IP4 và candidate UDP về đúng Public IP của máy chủ VPS (103.253.20.32:10005).
   */
  QString sanitizeWhepAnswerSdp(const QString &sdp, const QString &fallbackServerHost)
  {
    if (sdp.isEmpty())
      return sdp;

    const QStringList lines = sdp.split(QRegularExpression("[\r\n]+"), Qt::SkipEmptyParts);
    QString publicHost;

    // 1. Quét tìm IP Public đầu tiên do MediaMTX gửi về (không thuộc dải Private RFC 1918)
    static const QRegularExpression candRegex(
        "^a=candidate:[^\\s]+\\s+\\d+\\s+(?:udp|tcp)\\s+\\d+\\s+([^\\s]+)\\s+\\d+",
        QRegularExpression::CaseInsensitiveOption);

    for (const QString &line : lines)
    {
      auto match = candRegex.match(line);
      if (match.hasMatch())
      {
        QString host = match.captured(1);
        if (!isPrivateIp(host))
        {
          publicHost = host;
          break;
        }
      }
    }

    // Nếu MediaMTX chỉ gửi IP nội bộ (như 10.1.10.189), fallback về IP Public của máy chủ
    if (publicHost.isEmpty() && !fallbackServerHost.isEmpty())
    {
      publicHost = fallbackServerHost;
    }

    QString result = sdp;

    // 2. Cập nhật dòng c=IN IP4 thành IP Public đó
    if (!publicHost.isEmpty())
    {
      static const QRegularExpression cLineRe("c=IN IP4 [0-9.]+");
      result.replace(cLineRe, QString("c=IN IP4 %1").arg(publicHost));
    }

    // 3. Tự động lọc bỏ các candidate thuộc dải Private (RFC 1918)
    const QStringList updatedLines = result.split(QRegularExpression("[\r\n]+"), Qt::SkipEmptyParts);
    QStringList filteredLines;
    bool hasPublicCandidate = false;

    for (const QString &line : updatedLines)
    {
      if (line.startsWith("a=candidate:"))
      {
        auto match = candRegex.match(line);
        if (match.hasMatch() && isPrivateIp(match.captured(1)))
        {
          continue; // Lọc bỏ IP nội bộ của VPS (như 10.1.10.189)
        }
        hasPublicCandidate = true;
      }
      filteredLines.append(line);
    }

    // 4. Nếu toàn bộ candidate bị lọc bỏ vì là Private IP, bổ sung 1 candidate UDP trỏ vào Public Host :10005
    if (!hasPublicCandidate && !publicHost.isEmpty())
    {
      // MediaMTX sử dụng cổng 10005 UDP cho WebRTC Media
      QString injectedCandidate = QString("a=candidate:1 1 udp 2130706431 %1 10005 typ host").arg(publicHost);
      filteredLines.append(injectedCandidate);
    }

    return filteredLines.join("\r\n") + "\r\n";
  }

} // anonymous namespace

VideoRelayBridge::VideoRelayBridge(QObject *parent)
    : QObject(parent), m_httpNet(new QNetworkAccessManager(this)),
      m_statsTimer(new QTimer(this))
{

  // Kết nối timer 1s để cập nhật số liệu tốc độ KB/s và định kỳ yêu cầu Keyframe (RTCP PLI)
  connect(m_statsTimer, &QTimer::timeout, this,
          &VideoRelayBridge::onStatsTimer);

  // Khởi tạo mức log cảnh báo cho thư viện C++ WebRTC libdatachannel
  rtc::InitLogger(rtc::LogLevel::Warning);
}

VideoRelayBridge::~VideoRelayBridge() { stopRelay(); }

/**
 * @brief Bắt đầu kích hoạt cầu nối WebRTC WHEP và chuyển tiếp video FPV.
 * @param serverUrl Địa chỉ Base URL của NestJS Backend (vd: http://103.253.20.32:10004)
 * @param deviceId Mã định danh duy nhất của Drone (vd: VM-DRONE-e232039...)
 * @param jwtToken Token JWT xác thực quyền sở hữu của phi công
 * @param localQgcPort Cổng UDP đích của QGroundControl (mặc định: 5600)
 */
void VideoRelayBridge::startRelay(const QString &serverUrl,
                                  const QString &deviceId,
                                  const QString &jwtToken,
                                  quint16 localQgcPort)
{
  // Nếu đang có phiên stream trước đó, dọn dẹp sạch sẽ trước khi tạo phiên mới
  if (m_isRunning)
  {
    stopRelay();
  }

  // -------------------------------------------------------------------------
  // BƯỚC 1: Chuẩn hóa địa chỉ URL máy chủ Backend
  // -------------------------------------------------------------------------
  m_serverUrl = serverUrl.trimmed();
  if (m_serverUrl.endsWith('/'))
  {
    m_serverUrl.chop(1);
  }
  if (!m_serverUrl.startsWith("http://") &&
      !m_serverUrl.startsWith("https://"))
  {
    m_serverUrl = "http://" + m_serverUrl;
  }

  // -------------------------------------------------------------------------
  // BƯỚC 2: Lưu trữ thông số phiên bay & Reset các bộ đếm thống kê Atomic
  // -------------------------------------------------------------------------
  m_deviceId = deviceId.trimmed();
  m_jwtToken = jwtToken.trimmed();
  m_localQgcPort = localQgcPort;
  m_totalBytesTransferred = 0;
  m_totalPacketsReceived = 0;
  m_packetsInLastSec = 0;
  m_offerSent = false;
  m_isRunning = true;

  // -------------------------------------------------------------------------
  // BƯỚC 3: Khởi tạo POSIX / BSD Socket UDP thuần của hệ điều hành
  // LÝ DO KIẾN TRÚC:
  // Các gói tin video SRTP sau khi giải mã sẽ được đẩy vào Worker Thread của libdatachannel.
  // Nếu dùng QUdpSocket của Qt, sẽ bị lỗi "Qt Thread Affinity" (thao tác QObject từ sai Thread).
  // Dùng socket native ::sendto đảm bảo an toàn 100% đa luồng (Thread-safe), không khóa Mutex.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // BƯỚC 4: Khởi tạo PeerConnection và bắt đầu quy trình bắt tay WebRTC WHEP
  // -------------------------------------------------------------------------
  setupPeerConnection();

  // -------------------------------------------------------------------------
  // BƯỚC 5: Kích hoạt Timer cập nhật số liệu bitrate
  // -------------------------------------------------------------------------
  m_statsTimer->start(1000);
  emit statusChanged(true, QString("Đang kết nối WebRTC..."));
}

/**
 * @brief Cấu hình PeerConnection, STUN Server, Video Track và các Callbacks xử lý gói tin.
 */
void VideoRelayBridge::setupPeerConnection()
{
  // -------------------------------------------------------------------------
  // 1. Cấu hình WebRTC & STUN Server (Hỗ trợ đục lỗ NAT)
  // -------------------------------------------------------------------------
  rtc::Configuration config;
  config.iceServers.emplace_back("stun:stun.l.google.com:19302"); // Máy chủ STUN công cộng của Google
  config.iceServers.emplace_back("stun:stun1.l.google.com:19302");
  config.iceServers.emplace_back("stun:stun.cloudflare.com:3478"); // Máy chủ STUN Cloudflare
  config.enableIceUdpMux = true;

  // 2. Tạo đối tượng kết nối PeerConnection từ libdatachannel
  m_peerConnection = std::make_shared<rtc::PeerConnection>(config);

  // -------------------------------------------------------------------------
  // 3. Lắng nghe trạng thái thay đổi của kết nối WebRTC (State Machine)
  // -------------------------------------------------------------------------
  m_peerConnection->onStateChange([this](rtc::PeerConnection::State state)
                                  {
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
    } });

  // -------------------------------------------------------------------------
  // 4. Lắng nghe quá trình thu thập địa chỉ ứng viên ICE (ICE Candidate Gathering)
  // Khi đạt trạng thái 'Complete' -> Tất cả candidate đã có trong localDescription
  // -> Tiến hành gửi SDP Offer lên WHEP Gateway qua HTTP POST
  // -------------------------------------------------------------------------
  m_peerConnection->onGatheringStateChange(
      [this, weakPc = std::weak_ptr<rtc::PeerConnection>(m_peerConnection)](
          rtc::PeerConnection::GatheringState state)
      {
        if (state == rtc::PeerConnection::GatheringState::Complete)
        {
          if (auto pc = weakPc.lock())
          {
            if (!m_offerSent && m_isRunning)
            {
              auto localDesc = pc->localDescription();
              if (localDesc.has_value())
              {
                m_offerSent = true;
                QString sdp =
                    QString::fromStdString(std::string(localDesc.value()));

                // ĐẨY VỀ MAIN THREAD: Vì callback này chạy trên Worker Thread của WebRTC,
                // ta dùng QMetaObject::invokeMethod (QueuedConnection) để gọi hàm gửi HTTP
                // trên Main GUI Thread một cách an toàn.
                QMetaObject::invokeMethod(
                    this, [this, sdp]()
                    { sendWhepOffer(sdp); },
                    Qt::QueuedConnection);
              }
            }
          }
        }
      });

  // -------------------------------------------------------------------------
  // 5. Thiết lập Callback nhận gói tin Video RTP (Data Plane Callback)
  // -------------------------------------------------------------------------
  auto setupTrackCallbacks = [this](std::shared_ptr<rtc::Track> track)
  {
    if (!track)
      return;
    emit logMessage("INFO",
                    "🎥 [WebRTC] Đã thiết lập bộ nhận Video RTP cho Track!");

    // Khi libdatachannel nhận gói tin SRTP qua UDP 10005, giải mã bảo mật xong -> Bắn vào onMessage:
    track->onMessage(
        [this](rtc::binary rtpPacket)
        {
          if (!m_isRunning || m_rawUdpSock < 0 || rtpPacket.empty())
            return;

          if (m_totalPacketsReceived == 0)
          {
            emit logMessage(
                "SUCCESS",
                QString("🎉 [WebRTC] Đã nhận gói tin Video RTP đầu tiên (%1 "
                        "bytes)! Bắt đầu bắn sang QGC UDP 5600...")
                    .arg(rtpPacket.size()));
          }

          // Bắn trực tiếp mảng byte RTP sang Localhost:5600 cho QGroundControl (Zero-copy, Zero-transcode)
          ::sendto(m_rawUdpSock, rtpPacket.data(), rtpPacket.size(), 0,
                   (struct sockaddr *)&m_localQgcAddr, sizeof(m_localQgcAddr));

          // Cập nhật các biến đếm atomic an toàn đa luồng
          m_totalBytesTransferred += rtpPacket.size();
          m_totalPacketsReceived++;
          m_packetsInLastSec++;
        },
        [](std::string) {});

    track->onClosed([this]()
                    { emit logMessage("INFO", "⏹ [WebRTC] Video Track đã đóng."); });
  };

  // -------------------------------------------------------------------------
  // 6. Khởi tạo mô tả Video Track nhận H.264 (Payload Type 96, RecvOnly)
  // -------------------------------------------------------------------------
  rtc::Description::Video videoDesc("video",
                                    rtc::Description::Direction::RecvOnly);
  videoDesc.addH264Codec(96);
  m_videoTrack = m_peerConnection->addTrack(videoDesc);
  setupTrackCallbacks(m_videoTrack);

  // Đăng ký dự phòng nếu MediaMTX khởi tạo track phía remote
  m_peerConnection->onTrack([this, setupTrackCallbacks](
                                std::shared_ptr<rtc::Track> track)
                            {
    if (track && track->description().type() == "video") {
      emit logMessage("INFO", "🎥 [WebRTC] Nhận Video Track từ MediaMTX! Đang "
                              "giải mã SRTP và chuyển tiếp RTP sang UDP...");
      setupTrackCallbacks(track);
    } });

  // -------------------------------------------------------------------------
  // 7. Yêu cầu PeerConnection sinh bản tin SDP Offer cục bộ
  // -------------------------------------------------------------------------
  m_peerConnection->setLocalDescription();

  // -------------------------------------------------------------------------
  // 8. Fallback Timer 300ms đề phòng mạng cục bộ không kích hoạt GatheringState::Complete
  // -------------------------------------------------------------------------
  QTimer::singleShot(300, this, [this]()
                     {
    if (!m_offerSent && m_isRunning && m_peerConnection) {
      auto localDesc = m_peerConnection->localDescription();
      if (localDesc.has_value()) {
        m_offerSent = true;
        QString sdp = QString::fromStdString(std::string(localDesc.value()));
        sendWhepOffer(sdp);
      }
    } });
}

/**
 * @brief Gửi bản tin SDP Offer chuẩn RFC 8829 (WHEP) lên NestJS Gateway qua HTTP POST.
 * @param sdpOffer Chuỗi SDP Offer do libdatachannel sinh ra
 */
void VideoRelayBridge::sendWhepOffer(const QString &sdpOffer)
{
  if (m_deviceId.isEmpty() || !m_isRunning)
    return;

  // -------------------------------------------------------------------------
  // 1. Tạo đường dẫn WHEP Proxy qua NestJS Gateway
  // Endpoint: POST /api/v1/video/:id/whep
  // -------------------------------------------------------------------------
  QString whepUrlStr =
      QString("%1/api/v1/video/%2/whep").arg(m_serverUrl, m_deviceId);
  emit logMessage(
      "INFO",
      QString("🎥 [WebRTC] Gửi SDP Offer WHEP lên Cloud: %1").arg(whepUrlStr));

  // -------------------------------------------------------------------------
  // 2. KỸ THUẬT CLIENT-FIRST UDP HOLE PUNCHING:
  // Lọc bỏ toàn bộ candidate khỏi SDP Offer trước khi gửi lên Cloud Gateway.
  // Điều này ngăn MediaMTX trên VPS bắn bất kỳ gói UDP nào ra trước (tránh bị Cloud NAT đổi cổng).
  // Client sẽ là bên chủ động bắn gói tin UDP STUN đầu tiên vào cổng 10005 của VPS!
  // -------------------------------------------------------------------------
  const QStringList offerLines = sdpOffer.split(QRegularExpression("[\r\n]+"), Qt::SkipEmptyParts);
  QStringList clientFirstLines;
  for (const QString &line : offerLines)
  {
    if (!line.startsWith("a=candidate:"))
    {
      clientFirstLines.append(line);
    }
  }
  QString clientFirstOfferSdp = clientFirstLines.join("\r\n") + "\r\n";

  // -------------------------------------------------------------------------
  // 3. Thiết lập Header HTTP theo chuẩn IETF WHEP (Content-Type: application/sdp)
  // -------------------------------------------------------------------------
  QUrl whepUrl(whepUrlStr);
  QNetworkRequest request(whepUrl);
  request.setHeader(QNetworkRequest::ContentTypeHeader, "application/sdp");
  if (!m_jwtToken.isEmpty())
  {
    request.setRawHeader("Authorization",
                         QString("Bearer %1").arg(m_jwtToken).toUtf8());
  }

  // -------------------------------------------------------------------------
  // 4. Thực hiện gửi bản tin SDP Offer bằng HTTP POST bất đồng bộ
  // -------------------------------------------------------------------------
  QNetworkReply *reply = m_httpNet->post(request, clientFirstOfferSdp.toUtf8());
  connect(reply, &QNetworkReply::finished, this, [this, reply]()
          {
    reply->deleteLater();
    if (!m_isRunning || !m_peerConnection)
      return;

    // -----------------------------------------------------------------------
    // 5. Tiếp nhận phản hồi SDP Answer từ MediaMTX (HTTP 200 OK)
    // -----------------------------------------------------------------------
    if (reply->error() == QNetworkReply::NoError) {
      QByteArray rawAnswer = reply->readAll();
      QString sdpAnswer = QString::fromUtf8(rawAnswer);

      // Trích xuất host công khai của máy chủ VPS từ m_serverUrl (ví dụ "103.253.20.32")
      QUrl serverQUrl(m_serverUrl);
      QString serverHost = serverQUrl.host();

      // Làm sạch SDP Answer: Thay thế IP Private nội bộ (10.1.10.189) bằng Public IP VPS (:10005)
      QString cleanAnswerSdp = sanitizeWhepAnswerSdp(sdpAnswer, serverHost);

      emit logMessage("SUCCESS",
                      QString("🟢 [WebRTC] Nhận SDP Answer từ MediaMTX thành công! "
                              "Đã chuẩn hóa IP đích về [%1:10005] và bắt đầu kết nối PeerConnection...")
                          .arg(serverHost));

      try {
        // NẠP SDP ANSWER: Kích hoạt quá trình đục lỗ NAT ICE và bắt tay DTLS 1.2 Handshake
        // trên cổng UDP 10005 của VPS
        m_peerConnection->setRemoteDescription(
            rtc::Description(cleanAnswerSdp.toStdString(), "answer"));
      } catch (const std::exception &e) {
        emit logMessage(
            "ERROR",
            QString("🔴 [WebRTC] Lỗi nạp SDP Answer: %1").arg(e.what()));
      }
    } else {
      // Xử lý lỗi nếu Token sai hoặc Drone chưa bật camera RTSP
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
    } });
}

/**
 * @brief Slot timer định kỳ mỗi giây: Cập nhật bitrate và gửi yêu cầu Keyframe.
 */
void VideoRelayBridge::onStatsTimer()
{
  if (!m_isRunning)
    return;

  // Phát Signal cập nhật thống kê lưu lượng cho UI Widget
  emit statsUpdated(m_totalBytesTransferred, m_packetsInLastSec);
  m_packetsInLastSec = 0;

  // ĐỊNH KỲ YÊU CẦU KEYFRAME (RTCP PLI / Picture Loss Indication):
  // Giúp QGroundControl ngay khi vừa kết nối nhận được ngay khung hình IDR/Keyframe (SPS/PPS)
  // để bắt đầu vẽ video tức thì mà không phải chờ đợi.
  if (m_videoTrack && m_videoTrack->isOpen())
  {
    m_videoTrack->requestKeyframe();
  }
}

/**
 * @brief Dừng toàn bộ phiên WebRTC, đóng socket và dọn dẹp bộ nhớ.
 */
void VideoRelayBridge::stopRelay()
{
  if (!m_isRunning)
    return;

  m_isRunning = false;
  m_offerSent = false;
  m_statsTimer->stop();

  // 1. Đóng socket UDP hệ điều hành
  if (m_rawUdpSock >= 0)
  {
    ::close(m_rawUdpSock);
    m_rawUdpSock = -1;
  }

  // 2. Đóng Video Track
  if (m_videoTrack)
  {
    m_videoTrack->close();
    m_videoTrack.reset();
  }

  // 3. Đóng phiên WebRTC PeerConnection
  if (m_peerConnection)
  {
    m_peerConnection->close();
    m_peerConnection.reset();
  }

  emit logMessage("INFO", "⏹ [WebRTC] Đã dừng chuyển tiếp Video FPV.");
  emit statusChanged(false, "⚪ Đã tắt Video");
}
