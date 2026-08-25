/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/bridge/DroneBridgeCore.h
 * MÔ TẢ: Lớp điều phối trung tâm (Facade/Orchestrator Pattern).
 *       Tập trung 100% vào kiến trúc Cloud MAVLink & WebRTC Video:
 *       1. LocalGcsServer (TCP 5760 cho QGroundControl)
 *       2. WebSocketClient (Socket.IO MAVLink Gateway Port 10004)
 *       3. VideoRelayBridge (WebRTC WHEP FPV Video Port 10005)
 * ============================================================================
 */

#pragma once

#include "../video/VideoRelayBridge.h"
#include "LocalGcsServer.h"
#include "TelemetryModel.h"
#include "WebSocketClient.h"
#include <QObject>
#include <QTimer>
#include <QUrl>

class DroneBridgeCore : public QObject {
  Q_OBJECT

public:
  explicit DroneBridgeCore(QObject *parent = nullptr);
  ~DroneBridgeCore() override;

  /**
   * @brief Khởi động cầu nối MAVLink điều khiển bay qua Cloud Gateway (Port
   * 10004).
   * @param cloudWsUrl URL máy chủ Cloud (vd: http://103.253.20.32:10004)
   * @param deviceId Mã định danh Drone
   * @param authToken Token JWT xác thực phi công
   * @param gcsTcpPort Cổng TCP cho QGroundControl (5760)
   * @param gcsUdpPort Cổng UDP (14550)
   */
  bool startBridge(const QString &cloudWsUrl, const QString &deviceId,
                   const QString &authToken, quint16 gcsTcpPort = 5760,
                   quint16 gcsUdpPort = 14550);

  /**
   * @brief Dừng toàn bộ cầu nối MAVLink và đóng kết nối mạng.
   */
  void stopBridge();

  // Bật/tắt cầu nối Video FPV WebRTC
  void startVideoRelay(const QString &serverUrl, const QString &deviceId,
                       const QString &token, quint16 qgcVideoPort = 5600);
  void stopVideoRelay();

  // Kiểm tra trạng thái hoạt động
  bool isActive() const { return m_isActive; }
  bool isVideoActive() const {
    return m_videoBridge && m_videoBridge->isRunning();
  }

  LocalGcsServer *gcsServer() const { return m_gcsServer; }
  WebSocketClient *cloudClient() const { return m_cloudClient; }
  VideoRelayBridge *videoBridge() const { return m_videoBridge; }

signals:
  // Phát dữ liệu Telemetry đã giải mã cho thanh OSD và Widget đồ họa
  void telemetryUpdated(const TelemetryData &data);

  // Phát sự kiện trạng thái trạm QGroundControl kết nối vào TCP 5760
  void gcsStatusChanged(int clientCount, quint16 tcpPort);

  // Phát sự kiện trạng thái kết nối lên Cloud
  void remoteStatusChanged(bool connected, const QString &info);

  // Phát sự kiện trạng thái Video FPV Stream
  void videoStatusChanged(bool isStreaming, const QString &statusText);
  void videoStatsUpdated(quint64 totalBytes, quint32 packetsPerSec);

  // Phát sự kiện băng thông truyền tải MAVLink (TX/RX KB/s)
  void throughputUpdated(double txKbps, double rxKbps, uint64_t totalTxBytes,
                         uint64_t totalRxBytes);

  // Phát dòng nhật ký tiến trình (Log Event)
  void logEvent(const QString &level, const QString &message);

private slots:
  void onMavlinkFromCloud(const QByteArray &packet);
  void onDataFromGcs(const QByteArray &data);
  void onRateTimerTick();

private:
  LocalGcsServer *m_gcsServer;     // Server phục vụ QGroundControl (Port 5760)
  WebSocketClient *m_cloudClient;  // Client kết nối Socket.IO (Port 10004)
  VideoRelayBridge *m_videoBridge; // Cầu nối Video WebRTC WHEP (Port 10005)
  QTimer *m_rateTimer;             // Timer 1s tính toán tốc độ KB/s

  bool m_isActive = false;
  uint64_t m_lastTxBytes = 0;
  uint64_t m_lastRxBytes = 0;
};
