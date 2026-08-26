/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/bridge/LocalGcsServer.cpp
 * MÔ TẢ: Triển khai TCP Server nội bộ (mặc định Port 5760) và UDP Socket (Port 14550):
 *       1. Chấp nhận kết nối TCP từ phần mềm điều khiển trạm mặt đất QGroundControl
 *          hoặc Mission Planner chạy trên máy trạm (Localhost/WSL).
 *       2. [UPLINK]: Lắng nghe lệnh bay từ QGC (Arm, Đổi mode, Waypoints) và chuyển
 *          tiếp cho DroneBridgeCore để gửi lên Cloud.
 *       3. [DOWNLINK]: Nhận mảng byte MAVLink từ Cloud và bắn đồng loạt sang tất cả
 *          các Client QGC đang kết nối.
 *       4. Quản lý danh sách kết nối đa điểm (Multi-clients) và tính toán lưu lượng TX/RX.
 * ============================================================================
 */

#include "LocalGcsServer.h"

LocalGcsServer::LocalGcsServer(QObject *parent)
    : QObject(parent), m_tcpServer(new QTcpServer(this)),
      m_udpSocket(new QUdpSocket(this)) {
  // 1. Lắng nghe tín hiệu khi có trạm QGroundControl mới kết nối TCP vào Port 5760
  connect(m_tcpServer, &QTcpServer::newConnection, this,
          &LocalGcsServer::onNewTcpConnection);
  // 2. Lắng nghe tín hiệu khi có gói tin UDP gửi tới cổng 14550 (cho các GCS dùng UDP)
  connect(m_udpSocket, &QUdpSocket::readyRead, this,
          &LocalGcsServer::onUdpSocketReadyRead);
}

LocalGcsServer::~LocalGcsServer() { stopServer(); }

/**
 * @brief Bắt đầu mở cổng lắng nghe TCP (và tùy chọn UDP).
 * @param tcpPort Cổng TCP cho QGroundControl (mặc định 5760)
 * @param udpPort Cổng UDP phụ trợ (mặc định 14550)
 */
bool LocalGcsServer::startServer(quint16 tcpPort, quint16 udpPort) {
  m_tcpPort = tcpPort;
  m_udpPort = udpPort;

  // -------------------------------------------------------------------------
  // BƯỚC 1: Lắng nghe TCP trên QHostAddress::Any (0.0.0.0:5760)
  // - Cho phép cả ứng dụng trên Windows (qua WSL2 vEthernet) và Linux localhost kết nối vào.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // BƯỚC 2: Lắng nghe UDP (Tùy chọn nếu GCS cấu hình giao thức UDP 14550)
  // -------------------------------------------------------------------------
  if (m_udpPort > 0) {
    if (m_udpSocket->state() != QAbstractSocket::UnconnectedState) {
      m_udpSocket->close();
    }
    // Bind với flag ShareAddress & ReuseAddressHint để tránh xung đột cổng
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

/**
 * @brief Lấy địa chỉ IP của Client QGC kết nối gần nhất (hỗ trợ hiển thị Debug).
 */
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
 * @brief Đóng server, ngắt toàn bộ kết nối của QGC và dọn dẹp bộ nhớ an toàn.
 */
void LocalGcsServer::stopServer() {
  // 1. Ngắt kết nối và giải phóng toàn bộ TCP Socket clients
  for (QTcpSocket *client : m_clients) {
    if (client) {
      client->disconnect(this);
      client->disconnectFromHost();
      client->deleteLater();
    }
  }
  m_clients.clear();

  // 2. Đóng TCP Server lắng nghe
  if (m_tcpServer && m_tcpServer->isListening()) {
    m_tcpServer->close();
    emit logMessage("INFO", "[GCS Server] Đã đóng TCP Server.");
  }

  // 3. Đóng UDP Socket
  if (m_udpSocket->isOpen()) {
    m_udpSocket->close();
  }

  emit statsUpdated(m_bytesSent, m_bytesReceived, 0);
}

/**
 * @brief Xử lý khi QGroundControl kết nối thành công vào cổng TCP 5760.
 * Hàm này được kích hoạt tự động bởi Signal &QTcpServer::newConnection.
 */
void LocalGcsServer::onNewTcpConnection() {
  while (m_tcpServer->hasPendingConnections()) {
    // Trích xuất socket của client vừa kết nối
    QTcpSocket *clientSocket = m_tcpServer->nextPendingConnection();
    if (!clientSocket)
      continue;

    QString peerInfo = QString("%1:%2")
                           .arg(clientSocket->peerAddress().toString())
                           .arg(clientSocket->peerPort());
    m_clients.append(clientSocket);

    // -----------------------------------------------------------------------
    // GẮN LISTENER CHO TỪNG CLIENT SOCKET:
    // - readyRead: Khi QGC gửi gói tin lệnh bay (Uplink)
    // - disconnected: Khi QGC đóng kết nối hoặc thoát ứng dụng
    // -----------------------------------------------------------------------
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
 * @brief [UPLINK]: Đọc lệnh điều khiển bay từ QGroundControl gửi lên qua TCP 5760.
 * Luồng đi: QGroundControl ➔ LocalGcsServer ➔ DroneBridgeCore ➔ WebSocketClient ➔ Cloud.
 */
void LocalGcsServer::onTcpSocketReadyRead() {
  QTcpSocket *socket = qobject_cast<QTcpSocket *>(sender());
  if (!socket)
    return;

  // Đọc toàn bộ byte MAVLink nhị phân trong buffer nhận
  QByteArray data = socket->readAll();
  if (data.isEmpty())
    return;

  m_bytesReceived += static_cast<uint64_t>(data.size());
  
  // Bắn Signal phát dữ liệu lệnh cho DroneBridgeCore điều phối gửi lên Cloud Gateway
  emit dataReceivedFromGcs(data);
  emit statsUpdated(m_bytesSent, m_bytesReceived, m_clients.size());
}

/**
 * @brief Xử lý khi trạm QGroundControl ngắt kết nối khỏi TCP Server.
 */
void LocalGcsServer::onTcpSocketDisconnected() {
  QTcpSocket *socket = qobject_cast<QTcpSocket *>(sender());
  if (!socket)
    return;

  QString peerInfo = QString("%1:%2")
                         .arg(socket->peerAddress().toString())
                         .arg(socket->peerPort());
  // Loại bỏ socket khỏi danh sách quản lý
  m_clients.removeOne(socket);
  // Đưa socket vào hàng đợi giải phóng bộ nhớ an toàn
  socket->deleteLater();

  emit logMessage(
      "WARN", QString("🔌 [QGroundControl] Đã ngắt kết nối: %1").arg(peerInfo));
  emit clientDisconnected(peerInfo);
  emit statsUpdated(m_bytesSent, m_bytesReceived, m_clients.size());
}

/**
 * @brief [UPLINK]: Đọc gói tin từ QGC gửi qua cổng UDP 14550 (nếu dùng chế độ UDP).
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
      // Ghi nhớ địa chỉ và cổng gửi gần nhất để có thể phản hồi downlink về đúng địa chỉ này
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
 * Luồng đi: Cloud Gateway ➔ WebSocketClient ➔ DroneBridgeCore ➔ sendDataToGcs() ➔ QGC TCP 5760.
 * @param data Mảng byte nhị phân MAVLink v2 thô nhận từ Drone
 */
void LocalGcsServer::sendDataToGcs(const QByteArray &data) {
  if (data.isEmpty())
    return;

  // -------------------------------------------------------------------------
  // 1. Duyệt và ghi dữ liệu tới tất cả các TCP Clients (QGC đang kết nối)
  // -------------------------------------------------------------------------
  for (QTcpSocket *client : m_clients) {
    if (client && client->state() == QAbstractSocket::ConnectedState) {
      client->write(data);
      // flush() để đẩy dữ liệu ra socket ngay lập tức, giảm độ trễ điều khiển
      client->flush();
    }
  }

  // -------------------------------------------------------------------------
  // 2. Nếu có UDP client từng gửi gói tin tới cổng 14550, chuyển tiếp qua UDP
  // -------------------------------------------------------------------------
  if (!m_lastUdpSenderAddress.isNull() && m_lastUdpSenderPort > 0) {
    m_udpSocket->writeDatagram(data, m_lastUdpSenderAddress,
                               m_lastUdpSenderPort);
  }

  m_bytesSent += static_cast<uint64_t>(data.size());
  emit statsUpdated(m_bytesSent, m_bytesReceived, m_clients.size());
}

