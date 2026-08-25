/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/bridge/LocalGcsServer.cpp
 * MÔ TẢ: Triển khai TCP Server (Port 5760) và UDP Socket (Port 14550) nội bộ.
 *       Tiếp nhận kết nối từ QGroundControl (Localhost) và chuyển tiếp MAVLink hai chiều.
 * ============================================================================
 */

#include "LocalGcsServer.h"

LocalGcsServer::LocalGcsServer(QObject *parent)
    : QObject(parent), m_tcpServer(new QTcpServer(this)),
      m_udpSocket(new QUdpSocket(this)) {
  // Kết nối sự kiện khi có kết nối TCP mới từ QGroundControl
  connect(m_tcpServer, &QTcpServer::newConnection, this,
          &LocalGcsServer::onNewTcpConnection);
  // Kết nối sự kiện khi có gói tin UDP gửi tới cổng 14550
  connect(m_udpSocket, &QUdpSocket::readyRead, this,
          &LocalGcsServer::onUdpSocketReadyRead);
}

LocalGcsServer::~LocalGcsServer() { stopServer(); }

/**
 * @brief Bắt đầu mở cổng lắng nghe TCP/UDP.
 */
bool LocalGcsServer::startServer(quint16 tcpPort, quint16 udpPort) {
  m_tcpPort = tcpPort;
  m_udpPort = udpPort;

  // 1. Lắng nghe TCP trên QHostAddress::Any (0.0.0.0:5760) cho QGroundControl nội bộ
  if (!m_tcpServer->listen(QHostAddress::Any, m_tcpPort)) {
    emit logMessage("ERROR",
                    QString("[GCS Server] Không thể mở cổng TCP %1: %2")
                        .arg(m_tcpPort)
                        .arg(m_tcpServer->errorString()));
    return false;
  }

  emit logMessage("SUCCESS",
                  QString("[GCS Server] ✅ TCP Server đang lắng nghe tại "
                          "0.0.0.0:%1 (Sẵn sàng cho QGroundControl)")
                      .arg(m_tcpPort));

  // 2. Lắng nghe UDP (Tùy chọn cho các trạm GCS dùng giao thức UDP)
  if (m_udpPort > 0) {
    if (m_udpSocket->state() != QAbstractSocket::UnconnectedState) {
      m_udpSocket->close();
    }
    if (m_udpSocket->bind(QHostAddress::Any, m_udpPort,
                          QUdpSocket::ShareAddress |
                              QUdpSocket::ReuseAddressHint)) {
      emit logMessage(
          "INFO",
          QString("[GCS Server] UDP Socket đang lắng nghe tại 0.0.0.0:%1")
              .arg(m_udpPort));
    }
  }

  emit statsUpdated(m_bytesSent, m_bytesReceived, m_clients.size());
  return true;
}

QHostAddress LocalGcsServer::lastConnectedAddress() const {
  if (!m_clients.isEmpty()) {
    for (auto it = m_clients.rbegin(); it != m_clients.rend(); ++it) {
      if (*it && (*it)->state() == QAbstractSocket::ConnectedState) {
        QHostAddress addr = (*it)->peerAddress();
        bool ok = false;
        quint32 ipv4 = addr.toIPv4Address(&ok);
        if (ok) {
          return QHostAddress(ipv4);
        }
        return addr;
      }
    }
  }
  return QHostAddress::Null;
}

/**
 * @brief Đóng server và giải phóng toàn bộ client đang kết nối.
 */
void LocalGcsServer::stopServer() {
  for (QTcpSocket *client : m_clients) {
    if (client) {
      client->disconnect(this);
      client->disconnectFromHost();
      client->deleteLater();
    }
  }
  m_clients.clear();

  if (m_tcpServer && m_tcpServer->isListening()) {
    m_tcpServer->close();
    emit logMessage("INFO", "[GCS Server] Đã đóng TCP Server.");
  }

  if (m_udpSocket->isOpen()) {
    m_udpSocket->close();
  }

  emit statsUpdated(m_bytesSent, m_bytesReceived, 0);
}

/**
 * @brief Xử lý khi QGroundControl kết nối thành công vào cổng TCP 5760.
 */
void LocalGcsServer::onNewTcpConnection() {
  while (m_tcpServer->hasPendingConnections()) {
    QTcpSocket *clientSocket = m_tcpServer->nextPendingConnection();
    if (!clientSocket)
      continue;

    QString peerInfo = QString("%1:%2")
                           .arg(clientSocket->peerAddress().toString())
                           .arg(clientSocket->peerPort());
    m_clients.append(clientSocket);

    // Lắng nghe dữ liệu gửi lên từ QGC và sự kiện ngắt kết nối
    connect(clientSocket, &QTcpSocket::readyRead, this,
            &LocalGcsServer::onTcpSocketReadyRead);
    connect(clientSocket, &QTcpSocket::disconnected, this,
            &LocalGcsServer::onTcpSocketDisconnected);

    emit logMessage("CONNECTED",
                    QString("🎮 [QGroundControl] Đã kết nối thành công từ %1!")
                        .arg(peerInfo));
    emit clientConnected(peerInfo);
    emit statsUpdated(m_bytesSent, m_bytesReceived, m_clients.size());
  }
}

/**
 * @brief [UPLINK]: Đọc lệnh điều khiển bay từ QGroundControl gửi lên qua TCP.
 */
void LocalGcsServer::onTcpSocketReadyRead() {
  QTcpSocket *socket = qobject_cast<QTcpSocket *>(sender());
  if (!socket)
    return;

  QByteArray data = socket->readAll();
  if (data.isEmpty())
    return;

  m_bytesReceived += static_cast<uint64_t>(data.size());
  // Phát Signal chuyển tiếp lệnh lên DroneBridgeCore -> Cloud
  emit dataReceivedFromGcs(data);
  emit statsUpdated(m_bytesSent, m_bytesReceived, m_clients.size());
}

/**
 * @brief Xử lý khi QGroundControl ngắt kết nối.
 */
void LocalGcsServer::onTcpSocketDisconnected() {
  QTcpSocket *socket = qobject_cast<QTcpSocket *>(sender());
  if (!socket)
    return;

  QString peerInfo = QString("%1:%2")
                         .arg(socket->peerAddress().toString())
                         .arg(socket->peerPort());
  m_clients.removeOne(socket);
  socket->deleteLater();

  emit logMessage(
      "WARN", QString("🔌 [QGroundControl] Đã ngắt kết nối: %1").arg(peerInfo));
  emit clientDisconnected(peerInfo);
  emit statsUpdated(m_bytesSent, m_bytesReceived, m_clients.size());
}

/**
 * @brief [UPLINK]: Đọc gói tin từ QGC gửi qua cổng UDP 14550 (nếu có).
 */
void LocalGcsServer::onUdpSocketReadyRead() {
  while (m_udpSocket->hasPendingDatagrams()) {
    QByteArray datagram;
    datagram.resize(static_cast<int>(m_udpSocket->pendingDatagramSize()));
    QHostAddress senderAddr;
    quint16 senderPort = 0;

    m_udpSocket->readDatagram(datagram.data(), datagram.size(), &senderAddr,
                              &senderPort);
    if (!datagram.isEmpty()) {
      m_lastUdpSenderAddress = senderAddr;
      m_lastUdpSenderPort = senderPort;
      m_bytesReceived += static_cast<uint64_t>(datagram.size());
      emit dataReceivedFromGcs(datagram);
      emit statsUpdated(m_bytesSent, m_bytesReceived, m_clients.size());
    }
  }
}

/**
 * @brief [DOWNLINK]: Bắn gói tin byte nhị phân MAVLink sang QGroundControl.
 */
void LocalGcsServer::sendDataToGcs(const QByteArray &data) {
  if (data.isEmpty())
    return;

  // 1. Gửi tới tất cả các TCP Clients (QGroundControl đang kết nối vào Port
  // 5760)
  for (QTcpSocket *client : m_clients) {
    if (client && client->state() == QAbstractSocket::ConnectedState) {
      client->write(data);
      client->flush();
    }
  }

  // 2. Nếu có UDP client từng gửi gói tin tới cổng 14550, gửi phản hồi
  if (!m_lastUdpSenderAddress.isNull() && m_lastUdpSenderPort > 0) {
    m_udpSocket->writeDatagram(data, m_lastUdpSenderAddress,
                               m_lastUdpSenderPort);
  }

  m_bytesSent += static_cast<uint64_t>(data.size());
  emit statsUpdated(m_bytesSent, m_bytesReceived, m_clients.size());
}
