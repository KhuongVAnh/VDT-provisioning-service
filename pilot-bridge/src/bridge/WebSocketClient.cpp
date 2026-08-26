/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/bridge/WebSocketClient.cpp
 * MÔ TẢ: Triển khai giao thức Socket.IO v4 Client trên nền WebSocket thuần (RFC 6455):
 *       1. Bắt tay Engine.IO v4 (HTTP Upgrade ➔ Gói tin Open '0' ➔ Join Namespace '40/mavlink,').
 *       2. Xác thực quyền sở hữu Drone thông qua Bearer JWT Token trong Header/Query.
 *       3. Quản lý Heartbeat Ping/Pong tự động (Server gửi '2' ➔ Client phản hồi '3').
 *       4. Tự động kết nối lại khi mất mạng với thuật toán Exponential Backoff (1s..15s).
 *       5. [DOWNLINK]: Bóc tách sự kiện 'mavlink:downlink' (dữ liệu bay từ Drone về máy trạm).
 *       6. [UPLINK]: Đóng gói sự kiện 'mavlink:uplink' (lệnh điều khiển từ trạm mặt đất lên Drone).
 * ============================================================================
 */

#include "WebSocketClient.h"
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkRequest>
#include <QUrlQuery>

WebSocketClient::WebSocketClient(QObject *parent)
    : QObject(parent), m_webSocket(new QWebSocket(
                           QString(), QWebSocketProtocol::VersionLatest, this)),
      m_reconnectTimer(new QTimer(this)) {
  // -------------------------------------------------------------------------
  // KẾT NỐI CÁC SIGNALS CỦA ĐỐI TƯỢNG QWEBSOCKET:
  // -------------------------------------------------------------------------
  connect(m_webSocket, &QWebSocket::connected, this,
          &WebSocketClient::onConnected);
  connect(m_webSocket, &QWebSocket::disconnected, this,
          &WebSocketClient::onDisconnected);
  connect(m_webSocket, &QWebSocket::binaryMessageReceived, this,
          &WebSocketClient::onBinaryMessageReceived);
  connect(m_webSocket, &QWebSocket::textMessageReceived, this,
          &WebSocketClient::onTextMessageReceived);
  connect(m_webSocket,
          QOverload<QAbstractSocket::SocketError>::of(&QWebSocket::error), this,
          &WebSocketClient::onError);

  // Cấu hình Timer một lần (SingleShot) cho tính năng Reconnect tự động
  m_reconnectTimer->setSingleShot(true);
  connect(m_reconnectTimer, &QTimer::timeout, this,
          &WebSocketClient::onReconnectTimeout);
}

WebSocketClient::~WebSocketClient() { disconnectFromServer(); }

/**
 * @brief Bắt đầu mở kết nối WebSocket tới NestJS Socket.IO Server.
 * @param url Địa chỉ Base URL của NestJS Gateway (vd: http://103.253.20.32:10004)
 * @param deviceId Mã định danh Drone mục tiêu (vd: VM-DRONE-e232039...)
 * @param authToken JWT Token xác thực quyền sở hữu phi công
 */
void WebSocketClient::connectToServer(const QUrl &url, const QString &deviceId,
                                      const QString &authToken) {
  m_serverUrl = url;
  m_deviceId = deviceId.trimmed();
  m_authToken = authToken.trimmed();
  m_shouldReconnect = true;
  m_reconnectAttempts = 0;

  // Xác định giao thức mã hóa: Nếu URL gốc là https -> dùng wss (TLS Encrypted)
  QString wsScheme =
      (url.scheme() == "https" || url.scheme() == "wss") ? "wss" : "ws";
  QString host = url.host();
  int port = url.port(10004);

  // -------------------------------------------------------------------------
  // BƯỚC 1: Xây dựng URL Query theo chuẩn giao thức Socket.IO / Engine.IO v4
  // Tham số bắt buộc:
  // - EIO=4: Phiên bản giao thức Engine.IO v4
  // - transport=websocket: Chỉ định nâng cấp thẳng lên WebSocket (bỏ qua HTTP Polling)
  // - token & droneId: Truyền dữ liệu xác thực cho WebSocket Guard phía Backend
  // -------------------------------------------------------------------------
  QString fullWsUrl =
      QString(
          "%1://%2:%3/socket.io/?EIO=4&transport=websocket&token=%4&droneId=%5")
          .arg(wsScheme)
          .arg(host)
          .arg(port)
          .arg(QUrl::toPercentEncoding(m_authToken).constData())
          .arg(QUrl::toPercentEncoding(m_deviceId).constData());

  m_wsEndpointUrl = QUrl(fullWsUrl);

  emit logMessage(
      "INFO",
      QString(
          "[MAVLink WS] Đang kết nối Socket.IO Gateway: %1:%2 (Drone: %3)...")
          .arg(host)
          .arg(port)
          .arg(m_deviceId));

  // -------------------------------------------------------------------------
  // BƯỚC 2: Gắn HTTP Header an ninh (Authorization Bearer & x-drone-id)
  // -------------------------------------------------------------------------
  QNetworkRequest request(m_wsEndpointUrl);
  if (!m_authToken.isEmpty()) {
    request.setRawHeader("Authorization",
                         QString("Bearer %1").arg(m_authToken).toUtf8());
    request.setRawHeader("x-drone-id", m_deviceId.toUtf8());
  }

  // Mở kết nối WebSocket (Bắt đầu bắt tay TCP + HTTP Upgrade)
  m_webSocket->open(request);
}

/**
 * @brief Chủ động ngắt kết nối và dừng cơ chế Reconnect tự động.
 */
void WebSocketClient::disconnectFromServer() {
  m_shouldReconnect = false;
  m_reconnectTimer->stop();

  if (m_webSocket && m_webSocket->isValid()) {
    m_webSocket->close();
  }
}

/**
 * @brief Kiểm tra trạng thái kết nối WebSocket hiện tại.
 */
bool WebSocketClient::isConnected() const {
  return m_webSocket && m_webSocket->isValid() &&
         (m_webSocket->state() == QAbstractSocket::ConnectedState);
}

/**
 * @brief Kích hoạt khi kết nối TCP/WebSocket tầng dưới thành công.
 */
void WebSocketClient::onConnected() {
  m_reconnectAttempts = 0;
  emit logMessage("INFO", "[MAVLink WS] Kết nối socket TCP thành công, đang "
                          "bắt tay Socket.IO Engine.IO...");
}

/**
 * @brief Xử lý sự kiện ngắt kết nối và kích hoạt thuật toán kết nối lại (Exponential Backoff).
 */
void WebSocketClient::onDisconnected() {
  emit logMessage("WARN", "[MAVLink WS] Đã ngắt kết nối với MAVLink Gateway.");
  emit disconnected();

  // Tự động kết nối lại nếu người dùng không bấm nút Dừng chủ động (m_shouldReconnect == true)
  if (m_shouldReconnect) {
    // Thuật toán lũy thừa cơ số 2: 1s, 2s, 4s, 8s... tối đa trần 15s (15000ms)
    int delayMs = qMin(1000 * (1 << m_reconnectAttempts), 15000);
    m_reconnectAttempts++;
    emit logMessage(
        "INFO",
        QString(
            "[MAVLink WS] Sẽ tự động kết nối lại sau %1 giây (Lần thử %2)...")
            .arg(delayMs / 1000.0, 0, 'f', 1)
            .arg(m_reconnectAttempts));
    m_reconnectTimer->start(delayMs);
  }
}

/**
 * @brief Timer kết nối lại kích hoạt -> Thử mở lại WebSocket kèm Header Token.
 */
void WebSocketClient::onReconnectTimeout() {
  if (!m_shouldReconnect)
    return;
  emit logMessage("INFO", QString("[MAVLink WS] Đang thử kết nối lại tới %1...")
                              .arg(m_wsEndpointUrl.toString()));

  QNetworkRequest request(m_wsEndpointUrl);
  if (!m_authToken.isEmpty()) {
    request.setRawHeader("Authorization",
                         QString("Bearer %1").arg(m_authToken).toUtf8());
    request.setRawHeader("x-drone-id", m_deviceId.toUtf8());
  }
  m_webSocket->open(request);
}

/**
 * @brief Xử lý và ghi log khi gặp lỗi Socket mạng.
 */
void WebSocketClient::onError(QAbstractSocket::SocketError error) {
  Q_UNUSED(error);
  emit logMessage("ERROR", QString("[MAVLink WS] Lỗi kết nối WebSocket: %1")
                               .arg(m_webSocket->errorString()));
}

/**
 * @brief Nhận khung dữ liệu nhị phân (Binary Frame) trực tiếp nếu Backend gửi nhị phân thuần.
 */
void WebSocketClient::onBinaryMessageReceived(const QByteArray &message) {
  if (!message.isEmpty()) {
    emit binaryDataReceived(message);
  }
}

/**
 * @brief Máy trạng thái xử lý giao thức Socket.IO v4 (Engine.IO State Machine).
 * 
 * BẢNG MÃ GÓI TIN ENGINE.IO & SOCKET.IO:
 * ----------------------------------------------------------------------------
 * | Tiền tố | Giao thức  | Ý nghĩa                                            |
 * | :---    | :---       | :---                                               |
 * | "0"     | Engine.IO  | Open Handshake (Server gửi sid, pingInterval...)  |
 * | "2"     | Engine.IO  | Ping từ Server                                     |
 * | "3"     | Engine.IO  | Pong từ Client phản hồi                            |
 * | "40"    | Socket.IO  | CONNECT (Yêu cầu tham gia Namespace)               |
 * | "42"    | Socket.IO  | EVENT (Truyền nhận dữ liệu Downlink/Uplink)         |
 * | "44"    | Socket.IO  | CONNECT_ERROR (Từ chối kết nối / Lỗi xác thực)     |
 * ----------------------------------------------------------------------------
 */
void WebSocketClient::onTextMessageReceived(const QString &message) {
  emit textMessageReceived(message);

  // -------------------------------------------------------------------------
  // [BƯỚC 1]: Nhận gói tin "0..." (Engine.IO Open Handshake từ NestJS)
  // -------------------------------------------------------------------------
  if (message.startsWith("0")) {
    // Ngay lập tức gửi gói tin "40/mavlink," để yêu cầu tham gia namespace /mavlink của Drone
    m_webSocket->sendTextMessage("40/mavlink,");
    emit logMessage(
        "INFO", "[MAVLink WS] Đã gửi yêu cầu tham gia namespace /mavlink...");
  }
  // -------------------------------------------------------------------------
  // [BƯỚC 2]: Nhận phản hồi "40/mavlink..." (Server chấp thuận tham gia Room Drone)
  // -------------------------------------------------------------------------
  else if (message.startsWith("40/mavlink")) {
    emit logMessage("SUCCESS", QString("🟢 [MAVLink WS] Đã tham gia namespace "
                                       "/mavlink thành công cho Drone [%1]!")
                                   .arg(m_deviceId));
    emit connected();
  }
  // -------------------------------------------------------------------------
  // [BƯỚC 3]: Cơ chế Heartbeat: Nhận Ping ("2") từ Server -> Phản hồi Pong ("3")
  // Giúp giữ kết nối luôn sống qua các Router/Firewall NAT
  // -------------------------------------------------------------------------
  else if (message.startsWith("2")) {
    m_webSocket->sendTextMessage("3");
  }
  // -------------------------------------------------------------------------
  // [BƯỚC 4]: Server từ chối kết nối (Sai JWT Token hoặc không có quyền sở hữu Drone)
  // -------------------------------------------------------------------------
  else if (message.startsWith("44/mavlink")) {
    emit logMessage(
        "ERROR", QString("🚫 [MAVLink WS] Gateway từ chối: %1").arg(message));
  }
  // -------------------------------------------------------------------------
  // [BƯỚC 5]: [DOWNLINK]: Nhận sự kiện 'mavlink:downlink' chứa dữ liệu bay từ Drone
  // Định dạng gói tin: 42/mavlink,["mavlink:downlink", <Payload>]
  // -------------------------------------------------------------------------
  else if (message.startsWith("42/mavlink") ||
           message.contains("mavlink:downlink")) {
    // Tìm vị trí mở đầu mảng JSON '['
    int jsonStart = message.indexOf('[');
    if (jsonStart != -1) {
      QString jsonStr = message.mid(jsonStart);
      QJsonDocument doc = QJsonDocument::fromJson(jsonStr.toUtf8());
      if (doc.isArray()) {
        QJsonArray arr = doc.array();
        if (arr.size() >= 2) {
          QJsonValue val = arr[1];
          // Trường hợp 1: Dữ liệu MAVLink nhị phân mã hóa chuỗi Base64
          if (val.isString()) {
            QByteArray b64 = QByteArray::fromBase64(val.toString().toLatin1());
            if (!b64.isEmpty())
              emit binaryDataReceived(b64);
          }
          // Trường hợp 2: Dữ liệu là mảng các số nguyên Byte thô [253, 14, 0, ...]
          else if (val.isArray()) {
            QByteArray rawBytes;
            for (const auto &byteVal : val.toArray()) {
              rawBytes.append(static_cast<char>(byteVal.toInt()));
            }
            if (!rawBytes.isEmpty())
              emit binaryDataReceived(rawBytes);
          }
        }
      }
    }
  }
}

/**
 * @brief Chuyển đổi JSON Telemetry thành struct TelemetryData an toàn kiểu dữ liệu.
 */
void WebSocketClient::parseTelemetryJson(const QJsonObject &obj) {
  TelemetryData t;
  t.deviceId = obj["deviceId"].toString(m_deviceId);
  t.latitude = obj["lat"].toDouble(obj["latitude"].toDouble());
  t.longitude = obj["lon"].toDouble(obj["longitude"].toDouble());
  t.altitudeRel = static_cast<float>(
      obj["altRel"].toDouble(obj["altitudeRel"].toDouble(0.0)));
  t.altitudeMsl = static_cast<float>(obj["altMsl"].toDouble(
      obj["altitudeMsl"].toDouble(t.altitudeRel + 10.0)));
  t.speedMs = static_cast<float>(
      obj["groundSpeed"].toDouble(obj["speed"].toDouble(0.0)));
  t.headingDeg = static_cast<float>(
      obj["headingDeg"].toDouble(obj["heading"].toDouble(0.0)));
  t.rollRad = static_cast<float>(obj["rollRad"].toDouble(0.0));
  t.pitchRad = static_cast<float>(obj["pitchRad"].toDouble(0.0));
  t.yawRad = static_cast<float>(obj["yawRad"].toDouble(0.0));
  t.batteryPct = static_cast<uint8_t>(
      obj["batteryRemaining"].toInt(obj["batteryPct"].toInt(100)));
  t.batteryVoltageMv =
      static_cast<uint16_t>(obj["batteryVoltage"].toDouble(15.4) * 1000.0);
  t.satellites = static_cast<uint8_t>(
      obj["satellitesVisible"].toInt(obj["satellites"].toInt(18)));
  t.isArmed = obj["armed"].toBool(obj["isArmed"].toBool(true));
  t.flightModeName = obj["flightMode"].toString("GUIDED");

  emit telemetryJsonReceived(t);
}

/**
 * @brief [UPLINK]: Gửi lệnh bay nhị phân từ QGroundControl lên Cloud qua sự kiện mavlink:uplink.
 * @param data Mảng byte MAVLink lệnh điều khiển do QGC gửi vào cổng TCP 5760
 */
void WebSocketClient::sendBinaryData(const QByteArray &data) {
  if (isConnected() && !data.isEmpty()) {
    // Chuyển mảng byte nhị phân thành mảng số nguyên JSON [byte_0, byte_1, ...]
    QJsonArray byteArr;
    for (int i = 0; i < data.size(); ++i) {
      byteArr.append(static_cast<uint8_t>(data.at(i)));
    }
    QJsonDocument doc(byteArr);
    
    // Đóng gói theo chuẩn Socket.IO v4 Event Emit:
    // Cú pháp: 42/mavlink,["mavlink:uplink", [bytes...]]
    QString packet =
        QString("42/mavlink,[\"mavlink:uplink\",%1]")
            .arg(QString::fromUtf8(doc.toJson(QJsonDocument::Compact)));
    m_webSocket->sendTextMessage(packet);
  }
}

/**
 * @brief Gửi thông điệp văn bản thô qua kênh WebSocket.
 */
void WebSocketClient::sendTextMessage(const QString &message) {
  if (isConnected()) {
    m_webSocket->sendTextMessage(message);
  }
}

