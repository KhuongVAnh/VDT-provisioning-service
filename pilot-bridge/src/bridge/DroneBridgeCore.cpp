/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/bridge/DroneBridgeCore.cpp
 * MÔ TẢ: Triển khai lớp Điều Phối Trung Tâm (Facade / Orchestrator Pattern):
 *       1. Tích hợp và liên kết 3 thành phần cốt lõi:
 *          - LocalGcsServer (TCP 5760 cho QGroundControl nội bộ)
 *          - WebSocketClient (Cloud MAVLink Socket.IO Port 10004)
 *          - VideoRelayBridge (WebRTC WHEP FPV Video Port 10005)
 *       2. [DOWNLINK]: Nhận luồng MAVLink từ Cloud ➔ Chuyển tiếp tức thì vào TCP 5760.
 *       3. [UPLINK]: Nhận lệnh bay từ QGroundControl ➔ Đóng gói gửi ngược lên Cloud.
 *       4. Tính toán tốc độ truyền tải băng thông (TX/RX KB/s) mỗi giây cho thanh HUD OSD.
 * ============================================================================
 */

#include "DroneBridgeCore.h"

DroneBridgeCore::DroneBridgeCore(QObject *parent)
    : QObject(parent), m_gcsServer(new LocalGcsServer(this)),
      m_cloudClient(new WebSocketClient(this)),
      m_videoBridge(new VideoRelayBridge(this)), m_rateTimer(new QTimer(this)) {
  
  // =========================================================================
  // 1. KẾT NỐI SỰ KIỆN TỪ LOCAL GCS SERVER (CHO QGROUNDCONTROL TRÊN PORT 5760)
  // =========================================================================
  // Khi QGroundControl gửi lệnh điều khiển (Arm, Mode, Waypoint) -> Đẩy vào onDataFromGcs
  connect(m_gcsServer, &LocalGcsServer::dataReceivedFromGcs, this,
          &DroneBridgeCore::onDataFromGcs);
  
  // Khi số lượng GCS Client thay đổi -> Phát Signal cập nhật số lượng trạm trên UI
  connect(m_gcsServer, &LocalGcsServer::statsUpdated, this,
          [this](uint64_t tx, uint64_t rx, int clients) {
            Q_UNUSED(tx);
            Q_UNUSED(rx);
            emit gcsStatusChanged(clients, m_gcsServer->tcpPort());
          });
  
  // Chuyển tiếp dòng nhật ký (Log) từ GCS Server ra ngoài
  connect(m_gcsServer, &LocalGcsServer::logMessage, this,
          &DroneBridgeCore::logEvent);

  // =========================================================================
  // 2. KẾT NỐI SỰ KIỆN TỪ CLOUD SOCKET.IO GATEWAY (CỔNG 10004)
  // =========================================================================
  // [DOWNLINK]: Khi nhận byte MAVLink từ Cloud -> Chuyển tiếp vào onMavlinkFromCloud
  connect(m_cloudClient, &WebSocketClient::binaryDataReceived, this,
          &DroneBridgeCore::onMavlinkFromCloud);
  
  // Khi nhận Telemetry JSON -> Phát Signal cập nhật Mini OSD Strip và Telemetry Widget
  connect(m_cloudClient, &WebSocketClient::telemetryJsonReceived, this,
          &DroneBridgeCore::telemetryUpdated);
  
  // Trạng thái kết nối Cloud thay đổi
  connect(m_cloudClient, &WebSocketClient::connected, this, [this]() {
    emit remoteStatusChanged(true, "Cloud Gateway Connected");
  });
  connect(m_cloudClient, &WebSocketClient::disconnected, this, [this]() {
    emit remoteStatusChanged(false, "Cloud Gateway Disconnected");
  });
  connect(m_cloudClient, &WebSocketClient::logMessage, this,
          &DroneBridgeCore::logEvent);

  // =========================================================================
  // 3. KẾT NỐI SỰ KIỆN TỪ CẦU NỐI VIDEO FPV WEBRTC WHEP (CỔNG 10005)
  // =========================================================================
  connect(m_videoBridge, &VideoRelayBridge::statusChanged, this,
          &DroneBridgeCore::videoStatusChanged);
  connect(m_videoBridge, &VideoRelayBridge::statsUpdated, this,
          &DroneBridgeCore::videoStatsUpdated);
  connect(m_videoBridge, &VideoRelayBridge::logMessage, this,
          &DroneBridgeCore::logEvent);

  // =========================================================================
  // 4. TIMER ĐO TỐC ĐỘ BĂNG THÔNG MẠNG (THROUGHPUT METER)
  // =========================================================================
  connect(m_rateTimer, &QTimer::timeout, this,
          &DroneBridgeCore::onRateTimerTick);
}

DroneBridgeCore::~DroneBridgeCore() { stopBridge(); }

/**
 * @brief Khởi động toàn bộ cầu nối MAVLink điều khiển bay qua Cloud Gateway.
 * @param cloudWsUrl URL máy chủ Cloud (vd: http://103.253.20.32:10004)
 * @param deviceId Mã định danh Drone mục tiêu
 * @param authToken Token JWT xác thực phi công
 * @param gcsTcpPort Cổng TCP cho QGroundControl (mặc định: 5760)
 * @param gcsUdpPort Cổng UDP phụ trợ (mặc định: 14550)
 */
bool DroneBridgeCore::startBridge(const QString &cloudWsUrl,
                                  const QString &deviceId,
                                  const QString &authToken, quint16 gcsTcpPort,
                                  quint16 gcsUdpPort) {
  // Dọn dẹp các phiên kết nối cũ nếu có
  stopBridge();

  emit logEvent("INFO", "🚀 Khởi động Pilot Bridge Core...");

  // -------------------------------------------------------------------------
  // BƯỚC 1: Khởi động Local GCS Server (Mở TCP 0.0.0.0:5760 cho QGroundControl)
  // -------------------------------------------------------------------------
  if (!m_gcsServer->startServer(gcsTcpPort, gcsUdpPort)) {
    emit logEvent(
        "ERROR", QString("Không thể khởi động Local GCS Server tại TCP port %1")
                     .arg(gcsTcpPort));
    return false;
  }

  // -------------------------------------------------------------------------
  // BƯỚC 2: Kết nối tới Cloud MAVLink Gateway qua WebSocket Socket.IO (Port 10004)
  // -------------------------------------------------------------------------
  emit logEvent("INFO",
                QString("Kết nối tới Cloud MAVLink Gateway %1 (Drone: %2)...")
                    .arg(cloudWsUrl)
                    .arg(deviceId));
  m_cloudClient->connectToServer(QUrl(cloudWsUrl), deviceId, authToken);

  m_isActive = true;
  m_lastTxBytes = 0;
  m_lastRxBytes = 0;
  
  // Bắt đầu tính toán băng thông mỗi 1000ms (1 giây)
  m_rateTimer->start(1000);

  return true;
}

/**
 * @brief Dừng toàn bộ cầu nối MAVLink, Video và đóng các socket mạng an toàn.
 */
void DroneBridgeCore::stopBridge() {
  if (!m_isActive)
    return;

  m_isActive = false;
  m_rateTimer->stop();

  // Dừng tất cả các module con
  m_gcsServer->stopServer();
  m_cloudClient->disconnectFromServer();
  m_videoBridge->stopRelay();

  emit remoteStatusChanged(false, "Đã dừng");
  emit gcsStatusChanged(0, 0);
  emit logEvent("INFO", "⏹ Đã dừng toàn bộ Cầu nối Pilot Bridge.");
}

/**
 * @brief Kích hoạt luồng Video FPV WebRTC WHEP độc lập.
 */
void DroneBridgeCore::startVideoRelay(const QString &serverUrl,
                                      const QString &deviceId,
                                      const QString &token,
                                      quint16 qgcVideoPort) {
  if (m_videoBridge) {
    m_videoBridge->startRelay(serverUrl, deviceId, token, qgcVideoPort);
  }
}

/**
 * @brief Dừng luồng Video FPV WebRTC độc lập.
 */
void DroneBridgeCore::stopVideoRelay() {
  if (m_videoBridge) {
    m_videoBridge->stopRelay();
  }
}

/**
 * @brief [DOWNLINK]: Nhận mảng byte MAVLink từ Cloud WebSocket ➔ Chuyển tiếp vào QGroundControl qua TCP 5760.
 * @param packet Mảng byte nhị phân gói tin MAVLink từ Drone
 */
void DroneBridgeCore::onMavlinkFromCloud(const QByteArray &packet) {
  if (!m_isActive)
    return;
  // Bắn trực tiếp mảng byte vào TCP Socket của QGroundControl
  m_gcsServer->sendDataToGcs(packet);
}

/**
 * @brief [UPLINK]: Nhận lệnh điều khiển từ QGroundControl (TCP 5760) ➔ Gửi ngược lên Cloud Gateway qua WebSocket.
 * @param data Mảng byte nhị phân lệnh điều khiển từ QGC
 */
void DroneBridgeCore::onDataFromGcs(const QByteArray &data) {
  if (!m_isActive)
    return;
  // Đóng gói mảng byte và gửi qua sự kiện 'mavlink:uplink'
  m_cloudClient->sendBinaryData(data);
}

/**
 * @brief Tính toán tốc độ truyền tải băng thông (TX/RX KB/s) mỗi giây.
 */
void DroneBridgeCore::onRateTimerTick() {
  if (!m_isActive)
    return;

  uint64_t currentTx = m_gcsServer->bytesSent();
  uint64_t currentRx = m_gcsServer->bytesReceived();

  // Công thức: (Số byte chênh lệch trong 1s * 8 bit) / 1000 = kbps (Kilobits per second)
  double txKbps = (currentTx - m_lastTxBytes) * 8.0 / 1000.0;
  double rxKbps = (currentRx - m_lastRxBytes) * 8.0 / 1000.0;

  m_lastTxBytes = currentTx;
  m_lastRxBytes = currentRx;

  // Phát Signal cập nhật số liệu lên giao diện HUD
  emit throughputUpdated(txKbps, rxKbps, currentTx, currentRx);
}

