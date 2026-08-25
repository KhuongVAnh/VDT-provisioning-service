/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/api/AuthService.cpp
 * MÔ TẢ: Triển khai logic gửi HTTP REST API tới NestJS Backend để đăng nhập,
 *       lưu trữ Access Token và đồng bộ hóa danh sách Drone.
 * ============================================================================
 */

#include "AuthService.h"
#include <QNetworkRequest>
#include <QUrl>

AuthService::AuthService(QObject *parent)
    : QObject(parent), m_netManager(new QNetworkAccessManager(this)) {}

/**
 * @brief Gửi HTTP POST JSON đăng nhập lên NestJS Backend (/api/v1/auth/login).
 */
void AuthService::login(const QString &serverUrl, const QString &email,
                        const QString &password) {
  // 1. Chuẩn hóa địa chỉ máy chủ (loại bỏ dấu '/' ở cuối và thêm http/https)
  m_serverUrl = serverUrl.trimmed();
  if (m_serverUrl.endsWith('/')) {
    m_serverUrl.chop(1);
  }
  if (!m_serverUrl.startsWith("http://") &&
      !m_serverUrl.startsWith("https://")) {
    m_serverUrl = "http://" + m_serverUrl;
  }

  emit logMessage(
      "INFO",
      QString("[AUTH] Đang gửi yêu cầu đăng nhập tới %1/api/v1/auth/login...")
          .arg(m_serverUrl));

  // 2. Thiết lập Header HTTP JSON
  QUrl loginUrl(m_serverUrl + "/api/v1/auth/login");
  QNetworkRequest request(loginUrl);
  request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");

  // 3. Đóng gói JSON Payload: { "email": "...", "password": "..." }
  QJsonObject body;
  body["email"] = email.trimmed();
  body["password"] = password;

  QByteArray postData = QJsonDocument(body).toJson(QJsonDocument::Compact);

  // 4. Gửi HTTP POST bất đồng bộ qua QNetworkAccessManager
  QNetworkReply *reply = m_netManager->post(request, postData);
  connect(reply, &QNetworkReply::finished, this,
          [this, reply]() { onLoginReplyFinished(reply); });
}

/**
 * @brief Xử lý kết quả phản hồi đăng nhập từ Cloud.
 */
void AuthService::onLoginReplyFinished(QNetworkReply *reply) {
  // Luôn dọn dẹp bộ nhớ của reply sau khi xử lý xong
  reply->deleteLater();

  // 1. Xử lý trường hợp lỗi mạng hoặc sai thông tin đăng nhập
  if (reply->error() != QNetworkReply::NoError) {
    QString errorMsg = reply->errorString();
    QByteArray responseBody = reply->readAll();
    if (!responseBody.isEmpty()) {
      QJsonDocument doc = QJsonDocument::fromJson(responseBody);
      if (doc.isObject() && doc.object().contains("message")) {
        QJsonValue msgVal = doc.object()["message"];
        if (msgVal.isString()) {
          errorMsg = msgVal.toString();
        } else if (msgVal.isArray()) {
          QStringList list;
          for (const auto &v : msgVal.toArray())
            list.append(v.toString());
          errorMsg = list.join("; ");
        }
      }
    }
    emit logMessage("ERROR",
                    QString("[AUTH] Đăng nhập thất bại: %1").arg(errorMsg));
    emit loginFailed(errorMsg);
    return;
  }

  // 2. Parse dữ liệu JSON thành công
  QByteArray responseData = reply->readAll();
  QJsonDocument doc = QJsonDocument::fromJson(responseData);
  if (!doc.isObject()) {
    emit logMessage("ERROR",
                    "[AUTH] Phản hồi từ server không đúng định dạng JSON.");
    emit loginFailed("Phản hồi từ server không đúng định dạng JSON.");
    return;
  }

  QJsonObject root = doc.object();
  // Trích xuất JWT Access Token
  m_accessToken = root["accessToken"].toString();

  // Trích xuất thông tin người dùng
  QJsonObject userObj = root["user"].toObject();
  m_currentUser.id = userObj["id"].toString();
  m_currentUser.email = userObj["email"].toString();
  m_currentUser.fullName = userObj["fullName"].toString();
  m_currentUser.role = userObj["role"].toString("PILOT");

  m_devices.clear();
  if (root.contains("assignedDevices") && root["assignedDevices"].isArray()) {
    parseDevices(root["assignedDevices"].toArray());
  }

  emit logMessage("SUCCESS",
                  QString("🔑 [AUTH] Đăng nhập thành công! Tài khoản: %1 (%2)")
                      .arg(m_currentUser.email)
                      .arg(m_currentUser.role));

  // Phát Signal thông báo đăng nhập thành công cho MainWindow
  emit loginSuccess(m_currentUser, m_devices);

  // Tự động tải danh mục Drone chi tiết từ Endpoint Dashboard
  fetchDevices();
}

/**
 * @brief Gửi HTTP GET để tải toàn bộ danh mục Drone phi công sở hữu.
 */
void AuthService::fetchDevices() {
  if (m_accessToken.isEmpty())
    return;

  emit logMessage("INFO", "[AUTH] Đang làm mới danh mục Drone từ server...");

  // Endpoint chuẩn của NestJS Gateway DashboardController
  QString endpoint = m_serverUrl + "/api/v1/dashboard/devices";

  QUrl url(endpoint);
  QNetworkRequest request(url);
  // Gắn Bearer Token JWT vào Header xác thực
  request.setRawHeader("Authorization",
                       QString("Bearer %1").arg(m_accessToken).toUtf8());

  QNetworkReply *reply = m_netManager->get(request);
  connect(reply, &QNetworkReply::finished, this,
          [this, reply]() { onFetchDevicesReplyFinished(reply); });
}

/**
 * @brief Xử lý kết quả trả về của danh mục Drone.
 */
void AuthService::onFetchDevicesReplyFinished(QNetworkReply *reply) {
  reply->deleteLater();

  if (reply->error() != QNetworkReply::NoError) {
    emit logMessage("WARN", QString("[AUTH] Không thể tải danh mục Drone: %1")
                                .arg(reply->errorString()));
    return;
  }

  QByteArray data = reply->readAll();
  QJsonDocument doc = QJsonDocument::fromJson(data);

  QJsonArray arr;
  if (doc.isArray()) {
    arr = doc.array();
  } else if (doc.isObject() && doc.object().contains("data") &&
             doc.object()["data"].isArray()) {
    arr = doc.object()["data"].toArray();
  }

  // Parse danh sách Drone vào m_devices
  parseDevices(arr);
  emit logMessage(
      "SUCCESS",
      QString("🚁 [AUTH] Đã cập nhật thành công %1 Drone vào phi đội.")
          .arg(m_devices.size()));
  emit devicesUpdated(m_devices);
}

/**
 * @brief Chuyển đổi mảng JSON thành danh sách struct DroneInfo.
 */
void AuthService::parseDevices(const QJsonArray &arr) {
  m_devices.clear();
  for (const auto &val : arr) {
    QJsonObject obj = val.toObject();
    DroneInfo d;
    d.id = obj["id"].toString();
    d.deviceId = obj["deviceId"].toString();
    d.hardwareModel = obj["hardwareModel"].toString("Drone System");
    d.vpnIp = obj["vpnIp"].toString("");
    d.status = obj["status"].toString("ACTIVE");
    d.isOnline = obj["isOnline"].toBool(false);
    m_devices.append(d);
  }
}

/**
 * @brief Đăng xuất và xóa sạch Token khỏi bộ nhớ RAM.
 */
void AuthService::logout() {
  m_accessToken.clear();
  m_currentUser = UserProfile();
  m_devices.clear();
  emit logMessage("INFO", "[AUTH] Đã đăng xuất khỏi tài khoản.");
  emit loggedOut();
}
