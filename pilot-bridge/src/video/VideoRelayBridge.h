/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/video/VideoRelayBridge.h
 * MÔ TẢ: Định nghĩa lớp VideoRelayBridge — chịu trách nhiệm nhận luồng video
 *       WebRTC WHEP độ trễ siêu thấp (< 30ms) từ MediaMTX qua libdatachannel,
 *       giải mã SRTP và chuyển tiếp RTP H.264 sang UDP 5600 cho QGroundControl.
 * ============================================================================
 */

#pragma once

#include <QHostAddress>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QObject>
#include <QTimer>
#include <atomic>
#include <memory>
#include <netinet/in.h>

// Forward declaration các lớp từ thư viện C++ libdatachannel
namespace rtc {
class PeerConnection;
class Track;
} // namespace rtc

class VideoRelayBridge : public QObject {
  Q_OBJECT

public:
  explicit VideoRelayBridge(QObject *parent = nullptr);
  ~VideoRelayBridge() override;

  /**
   * @brief Bắt đầu kích hoạt cầu nối WebRTC WHEP và chuyển tiếp video.
   * @param serverUrl Địa chỉ Base URL của NestJS Backend (vd:
   * http://103.253.20.32:10004)
   * @param deviceId Mã định danh duy nhất của Drone (vd: VM-DRONE-e232039...)
   * @param jwtToken Token JWT xác thực quyền sở hữu của phi công
   * @param localQgcPort Cổng UDP đích của QGroundControl (mặc định: 5600)
   */
  void startRelay(const QString &serverUrl, const QString &deviceId,
                  const QString &jwtToken, quint16 localQgcPort = 5600);

  /**
   * @brief Dừng toàn bộ phiên WebRTC và đóng các socket mạng.
   */
  void stopRelay();

  // Kiểm tra trạng thái đang stream
  bool isRunning() const { return m_isRunning; }

  // Thống kê dung lượng & gói tin nhận được
  quint64 getBytesTransferred() const { return m_totalBytesTransferred; }
  quint32 getPacketsReceived() const { return m_totalPacketsReceived; }

signals:
  // Phát ra khi trạng thái kết nối WebRTC thay đổi
  void statusChanged(bool isStreaming, const QString &statusText);

  // Phát ra định kỳ mỗi giây để cập nhật số liệu lên giao diện UI
  void statsUpdated(quint64 totalBytes, quint32 packetsPerSec);

  // Phát dòng log chi tiết vào Console Debug
  void logMessage(const QString &level, const QString &message);

private slots:
  // Slot timer 1s để tính toán bitrate và yêu cầu Keyframe định kỳ
  void onStatsTimer();

private:
  // Socket UDP thuần của hệ điều hành Linux (BSD Socket)
  // Dùng socket này để tránh lỗi Qt Thread Affinity khi Worker Thread của
  // WebRTC bắn gói tin
  int m_rawUdpSock = -1;
  struct sockaddr_in m_localQgcAddr{}; // Địa chỉ 127.0.0.1:5600

  // Quản lý HTTP POST gửi SDP Offer lên WHEP endpoint
  QNetworkAccessManager *m_httpNet;
  QTimer *m_statsTimer;

  // Đối tượng kết nối WebRTC PeerConnection và Video Track từ libdatachannel
  std::shared_ptr<rtc::PeerConnection> m_peerConnection;
  std::shared_ptr<rtc::Track> m_videoTrack;

  bool m_isRunning = false;
  bool m_offerSent = false;
  QString m_serverUrl;
  QString m_deviceId;
  QString m_jwtToken;
  quint16 m_localQgcPort = 5600;

  // Các biến đếm atomic an toàn đa luồng (Multi-threading safe)
  std::atomic<quint64> m_totalBytesTransferred{0};
  std::atomic<quint32> m_totalPacketsReceived{0};
  std::atomic<quint32> m_packetsInLastSec{0};

  // Khởi tạo PeerConnection, cấu hình STUN và đăng ký callback giải mã RTP
  void setupPeerConnection();

  // Gửi bản tin SDP Offer chuẩn RFC 8829 lên NestJS WHEP Gateway
  void sendWhepOffer(const QString &sdpOffer);
};
