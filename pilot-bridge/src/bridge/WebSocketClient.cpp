/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/bridge/WebSocketClient.cpp
 * MÔ TẢ: Triển khai giao thức Socket.IO v4 trên nền WebSocket thuần của Qt.
 *       Xử lý Engine.IO Handshake, Namespace /mavlink, Ping/Pong Heartbeat,
 *       nhận sự kiện mavlink:downlink và phát sự kiện mavlink:uplink.
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
  // Kết nối các tín hiệu cơ bản của QWebSocket
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

  // Cấu hình Timer tự động kết nối lại khi mất mạng (Exponential Backoff)
  m_reconnectTimer->setSingleShot(true);
  connect(m_reconnectTimer, &QTimer::timeout, this,
          &WebSocketClient::onReconnectTimeout);
}

WebSocketClient::~WebSocketClient() { disconnectFromServer(); }

/**
 * @brief Bắt đầu mở kết nối WebSocket tới NestJS Socket.IO Server.
 */
void WebSocketClient::connectToServer(const QUrl &url, const QString &deviceId,
                                      const QString &authToken) {
  m_serverUrl = url;
  m_deviceId = deviceId.trimmed();
  m_authToken = authToken.trimmed();
  m_shouldReconnect = true;
  m_reconnectAttempts = 0;

  QString wsScheme =
      (url.scheme() == "https" || url.scheme() == "wss") ? "wss" : "ws";
  QString host = url.host();
  int port = url.port(10004);

  // 1. Tạo Query URL chuẩn giao thức Socket.IO Engine.IO v4 (EIO=4, transport=websocket)
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

  // 2. Gắn Header xác thực JWT
  QNetworkRequest request(m_wsEndpointUrl);
  if (!m_authToken.isEmpty()) {
    request.setRawHeader("Authorization",
                         QString("Bearer %1").arg(m_authToken).toUtf8());
    request.setRawHeader("x-drone-id", m_deviceId.toUtf8());
  }

  m_webSocket->open(request);
}

void WebSocketClient::disconnectFromServer() {
  m_shouldReconnect = false;
  m_reconnectTimer->stop();

  if (m_webSocket && m_webSocket->isValid()) {
    m_webSocket->close();
  }
}

bool WebSocketClient::isConnected() const {
  return m_webSocket && m_webSocket->isValid() &&
         (m_webSocket->state() == QAbstractSocket::ConnectedState);
}

void WebSocketClient::onConnected() {
  m_reconnectAttempts = 0;
  emit logMessage("INFO", "[MAVLink WS] Kết nối socket TCP thành công, đang "
                          "bắt tay Socket.IO Engine.IO...");
}

void WebSocketClient::onDisconnected() {
  emit logMessage("WARN", "[MAVLink WS] Đã ngắt kết nối với MAVLink Gateway.");
  emit disconnected();

  // Tự động kết nối lại nếu bị ngắt kết nối bất thường
  if (m_shouldReconnect) {
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

void WebSocketClient::onError(QAbstractSocket::SocketError error) {
  Q_UNUSED(error);
  emit logMessage("ERROR", QString("[MAVLink WS] Lỗi kết nối WebSocket: %1")
                               .arg(m_webSocket->errorString()));
}

void WebSocketClient::onBinaryMessageReceived(const QByteArray &message) {
  if (!message.isEmpty()) {
    emit binaryDataReceived(message);
  }
}

/**
 * @brief Xử lý gói tin văn bản từ Socket.IO Server (Engine.IO State Machine).
 */
void WebSocketClient::onTextMessageReceived(const QString &message) {
  emit textMessageReceived(message);

  // [BƯỚC 1]: Nhận gói tin "0..." (Engine.IO Open Handshake)
  if (message.startsWith("0")) {
    // Gửi ngay gói tin "40/mavlink," để yêu cầu tham gia namespace /mavlink
    m_webSocket->sendTextMessage("40/mavlink,");
    emit logMessage(
        "INFO", "[MAVLink WS] Đã gửi yêu cầu tham gia namespace /mavlink...");
  }
  // [BƯỚC 2]: Nhận phản hồi "40/mavlink..." (Tham gia namespace thành công)
  else if (message.startsWith("40/mavlink")) {
    emit logMessage("SUCCESS", QString("🟢 [MAVLink WS] Đã tham gia namespace "
                                       "/mavlink thành công cho Drone [%1]!")
                                   .arg(m_deviceId));
    emit connected();
  }
  // [BƯỚC 3]: Nhận gói tin Ping ("2") từ Server -> Phản hồi Pong ("3") để giữ
  // kết nối sống
  else if (message.startsWith("2")) {
    m_webSocket->sendTextMessage("3");
  }
  // [BƯỚC 4]: Bị từ chối quyền truy cập
  else if (message.startsWith("44/mavlink")) {
    emit logMessage(
        "ERROR", QString("🚫 [MAVLink WS] Gateway từ chối: %1").arg(message));
  }
  // [BƯỚC 5]: [DOWNLINK]: Nhận sự kiện mavlink:downlink (dữ liệu bay từ Drone)
  else if (message.startsWith("42/mavlink") ||
           message.contains("mavlink:downlink")) {
    int jsonStart = message.indexOf('[');
    if (jsonStart != -1) {
      QString jsonStr = message.mid(jsonStart);
      QJsonDocument doc = QJsonDocument::fromJson(jsonStr.toUtf8());
      if (doc.isArray()) {
        QJsonArray arr = doc.array();
        if (arr.size() >= 2) {
          QJsonValue val = arr[1];
          // Trường hợp 1: Dữ liệu nhị phân mã hóa Base64
          if (val.isString()) {
            QByteArray b64 = QByteArray::fromBase64(val.toString().toLatin1());
            if (!b64.isEmpty())
              emit binaryDataReceived(b64);
          }
          // Trường hợp 2: Dữ liệu là mảng các số nguyên Byte thô
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
 * @brief Parse dữ liệu JSON Telemetry sang struct TelemetryData chuẩn.
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
 * @brief [UPLINK]: Gửi lệnh bay nhị phân từ QGC lên Cloud qua sự kiện
 * mavlink:uplink.
 */
void WebSocketClient::sendBinaryData(const QByteArray &data) {
  if (isConnected() && !data.isEmpty()) {
    QJsonArray byteArr;
    for (int i = 0; i < data.size(); ++i) {
      byteArr.append(static_cast<uint8_t>(data.at(i)));
    }
    QJsonDocument doc(byteArr);
    // Đóng gói theo chuẩn Socket.IO v4 Event Emit:
    // 42/mavlink,["mavlink:uplink", [bytes...]]
    QString packet =
        QString("42/mavlink,[\"mavlink:uplink\",%1]")
            .arg(QString::fromUtf8(doc.toJson(QJsonDocument::Compact)));
    m_webSocket->sendTextMessage(packet);
  }
}

void WebSocketClient::sendTextMessage(const QString &message) {
  if (isConnected()) {
    m_webSocket->sendTextMessage(message);
  }
}
