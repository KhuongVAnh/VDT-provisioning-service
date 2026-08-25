/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/bridge/LocalGcsServer.h
 * MÔ TẢ: Định nghĩa lớp LocalGcsServer — mở cổng TCP 5760 (và UDP 14550)
 *       nội bộ để phần mềm trạm mặt đất QGroundControl hoặc Mission Planner
 *       kết nối vào nhận luồng MAVLink và gửi lệnh bay Uplink.
 * ============================================================================
 */

#pragma once

#include <QHostAddress>
#include <QList>
#include <QObject>
#include <QString>
#include <QTcpServer>
#include <QTcpSocket>
#include <QUdpSocket>
#include <cstdint>

class LocalGcsServer : public QObject {
  Q_OBJECT

public:
  explicit LocalGcsServer(QObject *parent = nullptr);
  ~LocalGcsServer() override;

  /**
   * @brief Mở cổng lắng nghe TCP và UDP cho QGroundControl.
   * @param tcpPort Cổng TCP (mặc định 5760 theo chuẩn MAVLink GCS)
   * @param udpPort Cổng UDP (mặc định 14550)
   */
  bool startServer(quint16 tcpPort = 5760, quint16 udpPort = 14550);

  /**
   * @brief Dừng server và ngắt toàn bộ kết nối của QGroundControl.
   */
  void stopServer();

  // Các hàm getter kiểm tra trạng thái
  bool isListening() const { return m_tcpServer && m_tcpServer->isListening(); }
  quint16 tcpPort() const { return m_tcpPort; }
  quint16 udpPort() const { return m_udpPort; }
  int activeClientsCount() const { return m_clients.size(); }
  uint64_t bytesSent() const { return m_bytesSent; }
  uint64_t bytesReceived() const { return m_bytesReceived; }
  QHostAddress lastConnectedAddress() const;

public slots:
  /**
   * @brief [DOWNLINK]: Bắn gói tin byte nhị phân MAVLink sang QGroundControl.
   */
  void sendDataToGcs(const QByteArray &data);

signals:
  // [UPLINK]: Phát ra khi QGroundControl gửi lệnh điều khiển bay lên Bridge
  void dataReceivedFromGcs(const QByteArray &data);

  // Phát sự kiện trạm QGC kết nối / ngắt kết nối
  void clientConnected(const QString &clientInfo);
  void clientDisconnected(const QString &clientInfo);

  // Phát sự kiện thống kê số byte truyền nhận
  void statsUpdated(uint64_t bytesTx, uint64_t bytesRx, int activeClients);

  // Phát dòng log vào Console Debug
  void logMessage(const QString &level, const QString &message);

private slots:
  void onNewTcpConnection();
  void onTcpSocketReadyRead();
  void onTcpSocketDisconnected();
  void onUdpSocketReadyRead();

private:
  QTcpServer *m_tcpServer;       // Server TCP lắng nghe trên 0.0.0.0:5760
  QUdpSocket *m_udpSocket;       // Socket UDP lắng nghe trên 0.0.0.0:14550
  QList<QTcpSocket *> m_clients; // Danh sách các client QGC đang kết nối

  quint16 m_tcpPort = 5760;
  quint16 m_udpPort = 14550;

  // Lưu vết địa chỉ IP/Port của client UDP gần nhất
  QHostAddress m_lastUdpSenderAddress;
  quint16 m_lastUdpSenderPort = 0;

  uint64_t m_bytesSent = 0;
  uint64_t m_bytesReceived = 0;
};
