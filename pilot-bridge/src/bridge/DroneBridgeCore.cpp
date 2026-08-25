/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/bridge/DroneBridgeCore.cpp
 * MÔ TẢ: Triển khai logic điều phối MAVLink hai chiều (Downlink/Uplink)
 *       giữa Cloud MAVLink Gateway (Port 10004) và QGroundControl (Port 5760).
 * ============================================================================
 */

#include "DroneBridgeCore.h"

DroneBridgeCore::DroneBridgeCore(QObject *parent)
    : QObject(parent), m_gcsServer(new LocalGcsServer(this)),
      m_cloudClient(new WebSocketClient(this)),
      m_videoBridge(new VideoRelayBridge(this)), m_rateTimer(new QTimer(this)) {
  // =========================================================================
  // 1. KẾT NỐI SỰ KIỆN GCS SERVER (CHO QGROUNDCONTROL TRÊN PORT 5760)
  // =========================================================================
  // Khi QGroundControl gửi dữ liệu điều khiển lên -> Nhận tại onDataFromGcs
  connect(m_gcsServer, &LocalGcsServer::dataReceivedFromGcs, this,
          &DroneBridgeCore::onDataFromGcs);
  connect(m_gcsServer, &LocalGcsServer::statsUpdated, this,
          [this](uint64_t tx, uint64_t rx, int clients) {
            Q_UNUSED(tx);
            Q_UNUSED(rx);
            emit gcsStatusChanged(clients, m_gcsServer->tcpPort());
          });
  connect(m_gcsServer, &LocalGcsServer::logMessage, this,
          &DroneBridgeCore::logEvent);

  // =========================================================================
  // 2. KẾT NỐI CLOUD SOCKET.IO GATEWAY (CỔNG 10004)
  // =========================================================================
  // Khi nhận gói tin MAVLink nhị phân từ Cloud -> Chuyển tiếp vào
  // onMavlinkFromCloud
  connect(m_cloudClient, &WebSocketClient::binaryDataReceived, this,
          &DroneBridgeCore::onMavlinkFromCloud);
  // Khi nhận Telemetry JSON -> Phát Signal cập nhật OSD Strip
  connect(m_cloudClient, &WebSocketClient::telemetryJsonReceived, this,
          &DroneBridgeCore::telemetryUpdated);
  connect(m_cloudClient, &WebSocketClient::connected, this, [this]() {
    emit remoteStatusChanged(true, "Cloud Gateway Connected");
  });
  connect(m_cloudClient, &WebSocketClient::disconnected, this, [this]() {
    emit remoteStatusChanged(false, "Cloud Gateway Disconnected");
  });
  connect(m_cloudClient, &WebSocketClient::logMessage, this,
          &DroneBridgeCore::logEvent);

  // =========================================================================
  // 3. KẾT NỐI CẦU NỐI VIDEO FPV WEBRTC WHEP (CỔNG 10005)
  // =========================================================================
  connect(m_videoBridge, &VideoRelayBridge::statusChanged, this,
          &DroneBridgeCore::videoStatusChanged);
  connect(m_videoBridge, &VideoRelayBridge::statsUpdated, this,
          &DroneBridgeCore::videoStatsUpdated);
  connect(m_videoBridge, &VideoRelayBridge::logMessage, this,
          &DroneBridgeCore::logEvent);

  // =========================================================================
  // 4. TIMER ĐO TỐC ĐỘ BĂNG THÔNG MẠNG (THROUGHPUT)
  // =========================================================================
  connect(m_rateTimer, &QTimer::timeout, this,
          &DroneBridgeCore::onRateTimerTick);
}

DroneBridgeCore::~DroneBridgeCore() { stopBridge(); }

bool DroneBridgeCore::startBridge(const QString &cloudWsUrl,
                                  const QString &deviceId,
                                  const QString &authToken, quint16 gcsTcpPort,
                                  quint16 gcsUdpPort) {
  stopBridge();

  emit logEvent("INFO", "🚀 Khởi động Pilot Bridge Core...");

  // 1. Khởi động Local GCS Server (Mở TCP 0.0.0.0:5760 cho QGroundControl)
  if (!m_gcsServer->startServer(gcsTcpPort, gcsUdpPort)) {
    emit logEvent(
        "ERROR", QString("Không thể khởi động Local GCS Server tại TCP port %1")
                     .arg(gcsTcpPort));
    return false;
  }

  // 2. Kết nối tới Cloud MAVLink Gateway qua WebSocket Socket.IO (Port 10004)
  emit logEvent("INFO",
                QString("Kết nối tới Cloud MAVLink Gateway %1 (Drone: %2)...")
                    .arg(cloudWsUrl)
                    .arg(deviceId));
  m_cloudClient->connectToServer(QUrl(cloudWsUrl), deviceId, authToken);

  m_isActive = true;
  m_lastTxBytes = 0;
  m_lastRxBytes = 0;
  m_rateTimer->start(1000);

  return true;
}

void DroneBridgeCore::stopBridge() {
  if (!m_isActive)
    return;

  m_isActive = false;
  m_rateTimer->stop();

  // Dừng tất cả các client và server
  m_gcsServer->stopServer();
  m_cloudClient->disconnectFromServer();
  m_videoBridge->stopRelay();

  emit remoteStatusChanged(false, "Đã dừng");
  emit gcsStatusChanged(0, 0);
  emit logEvent("INFO", "⏹ Đã dừng toàn bộ Cầu nối Pilot Bridge.");
}

void DroneBridgeCore::startVideoRelay(const QString &serverUrl,
                                      const QString &deviceId,
                                      const QString &token,
                                      quint16 qgcVideoPort) {
  if (m_videoBridge) {
    m_videoBridge->startRelay(serverUrl, deviceId, token, qgcVideoPort);
  }
}

void DroneBridgeCore::stopVideoRelay() {
  if (m_videoBridge) {
    m_videoBridge->stopRelay();
  }
}

// [DOWNLINK]: Nhận MAVLink từ Cloud WebSocket -> Chuyển tiếp vào QGroundControl
// qua TCP 5760
void DroneBridgeCore::onMavlinkFromCloud(const QByteArray &packet) {
  if (!m_isActive)
    return;
  m_gcsServer->sendDataToGcs(packet);
}

// [UPLINK]: Nhận lệnh điều khiển từ QGroundControl -> Gửi ngược lên Cloud
// Gateway qua WebSocket
void DroneBridgeCore::onDataFromGcs(const QByteArray &data) {
  if (!m_isActive)
    return;
  m_cloudClient->sendBinaryData(data);
}

// Tính toán băng thông truyền nhận (KB/s) mỗi giây
void DroneBridgeCore::onRateTimerTick() {
  if (!m_isActive)
    return;

  uint64_t currentTx = m_gcsServer->bytesSent();
  uint64_t currentRx = m_gcsServer->bytesReceived();

  double txKbps = (currentTx - m_lastTxBytes) * 8.0 / 1000.0;
  double rxKbps = (currentRx - m_lastRxBytes) * 8.0 / 1000.0;

  m_lastTxBytes = currentTx;
  m_lastRxBytes = currentRx;

  emit throughputUpdated(txKbps, rxKbps, currentTx, currentRx);
}
