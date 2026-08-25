/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/bridge/WebSocketClient.h
 * MÔ TẢ: Định nghĩa lớp WebSocketClient — kết nối tới Socket.IO MAVLink Gateway
 *       của NestJS (Cổng 10004), tham gia phòng /mavlink của Drone mục tiêu
 *       để nhận byte MAVLink nhị phân thô và dữ liệu Telemetry JSON.
 * ============================================================================
 */

#pragma once

#include "TelemetryModel.h"
#include <QByteArray>
#include <QObject>
#include <QString>
#include <QTimer>
#include <QUrl>
#include <QWebSocket>

class WebSocketClient : public QObject {
  Q_OBJECT

public:
  explicit WebSocketClient(QObject *parent = nullptr);
  ~WebSocketClient() override;

  /**
   * @brief Kết nối tới Socket.IO WebSocket Server của NestJS.
   * @param url URL máy chủ (vd: http://103.253.20.32:10004)
   * @param deviceId Mã định danh Drone cần điều khiển
   * @param authToken JWT Token xác thực quyền truy cập
   */
  void connectToServer(const QUrl &url, const QString &deviceId,
                       const QString &authToken = QString());

  /**
   * @brief Ngắt kết nối WebSocket và hủy tự động kết nối lại.
   */
  void disconnectFromServer();

  bool isConnected() const;
  QUrl serverUrl() const { return m_serverUrl; }
  QString deviceId() const { return m_deviceId; }

public slots:
  /**
   * @brief [UPLINK]: Gửi lệnh bay nhị phân thô từ QGC lên Cloud.
   */
  void sendBinaryData(const QByteArray &data);
  void sendTextMessage(const QString &message);

signals:
  void connected();
  void disconnected();

  // [DOWNLINK]: Phát byte MAVLink nhị phân thô cho LocalGcsServer
  void binaryDataReceived(const QByteArray &data);

  // Phát dữ liệu Telemetry JSON đã bóc tách cho thanh OSD
  void telemetryJsonReceived(const TelemetryData &data);

  void textMessageReceived(const QString &message);
  void logMessage(const QString &level, const QString &message);

private slots:
  void onConnected();
  void onDisconnected();
  void onBinaryMessageReceived(const QByteArray &message);
  void onTextMessageReceived(const QString &message);
  void onError(QAbstractSocket::SocketError error);
  void onReconnectTimeout();

private:
  void parseTelemetryJson(const QJsonObject &obj);

  QWebSocket *m_webSocket;
  QTimer *m_reconnectTimer; // Tự động kết nối lại khi rớt mạng
  QUrl m_serverUrl;
  QUrl m_wsEndpointUrl;
  QString m_deviceId;
  QString m_authToken;
  bool m_shouldReconnect = false;
  int m_reconnectAttempts = 0;
};
