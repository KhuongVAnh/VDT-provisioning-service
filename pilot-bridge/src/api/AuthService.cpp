/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/api/AuthService.cpp
 * MÔ TẢ: Triển khai logic gọi HTTP/HTTPS REST API lên NestJS Backend:
 *       1. Gửi thông tin đăng nhập (Email + Mật khẩu) lên /api/v1/auth/login.
 *       2. Nhận JWT Token (Bearer) và trích xuất thông tin UserProfile.
 *       3. Tự động gọi endpoint /api/v1/dashboard/devices để tải danh sách Drone
 *          được gán quyền điều khiển cho tài khoản phi công.
 *       4. Quản lý vòng đời Token trong RAM và xử lý đăng xuất an toàn.
 * ============================================================================
 */

#include "AuthService.h"
#include <QNetworkRequest>
#include <QUrl>

AuthService::AuthService(QObject *parent)
    : QObject(parent), m_netManager(new QNetworkAccessManager(this)) {
  // m_netManager: Quản lý hàng đợi HTTP Requests bất đồng bộ của Qt (Non-blocking I/O).
  // Đặt parent là 'this' để tự động giải phóng bộ nhớ khi AuthService bị hủy.
}

/**
 * @brief Gửi HTTP POST JSON đăng nhập lên NestJS Backend (/api/v1/auth/login).
 * @param serverUrl Địa chỉ máy chủ (vd: "http://103.253.20.32:10004" hoặc "localhost:10004")
 * @param email Địa chỉ email của phi công
 * @param password Mật khẩu tài khoản
 */
void AuthService::login(const QString &serverUrl, const QString &email,
                        const QString &password) {
  // -------------------------------------------------------------------------
  // BƯỚC 1: Chuẩn hóa Base URL của máy chủ
  // - Loại bỏ khoảng trắng thừa hai đầu bằng .trimmed()
  // - Loại bỏ dấu gạch chéo '/' ở cuối URL nếu có
  // - Tự động bổ sung scheme "http://" nếu người dùng chỉ nhập IP:Port
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // BƯỚC 2: Xây dựng Request HTTP và cấu hình Header JSON
  // -------------------------------------------------------------------------
  QUrl loginUrl(m_serverUrl + "/api/v1/auth/login");
  QNetworkRequest request(loginUrl);
  // Khai báo kiểu nội dung gửi lên là JSON để NestJS Body Parser xử lý
  request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");

  // -------------------------------------------------------------------------
  // BƯỚC 3: Đóng gói JSON Payload: { "email": "...", "password": "..." }
  // -------------------------------------------------------------------------
  QJsonObject body;
  body["email"] = email.trimmed();
  body["password"] = password;

  // Chuyển đối tượng QJsonObject thành mảng byte QByteArray định dạng Compact (không thụt lề thừa)
  QByteArray postData = QJsonDocument(body).toJson(QJsonDocument::Compact);

  // -------------------------------------------------------------------------
  // BƯỚC 4: Thực hiện gửi HTTP POST bất đồng bộ qua QNetworkAccessManager
  // - Hàm post() trả về ngay một con trỏ QNetworkReply và không làm treo GUI (Non-blocking).
  // - Khi server phản hồi xong (hoặc lỗi), Signal &QNetworkReply::finished sẽ kích hoạt callback.
  // -------------------------------------------------------------------------
  QNetworkReply *reply = m_netManager->post(request, postData);
  connect(reply, &QNetworkReply::finished, this,
          [this, reply]() { onLoginReplyFinished(reply); });
}

/**
 * @brief Xử lý kết quả phản hồi đăng nhập từ Cloud.
 * @param reply Đối tượng chứa phản hồi từ server
 */
void AuthService::onLoginReplyFinished(QNetworkReply *reply) {
  // QUAN TRỌNG: deleteLater() đưa đối tượng reply vào hàng đợi hủy của Qt Event Loop,
  // tránh rò rỉ bộ nhớ RAM sau mỗi request HTTP mà không gây crash do xóa sớm.
  reply->deleteLater();

  // -------------------------------------------------------------------------
  // TRƯỜNG HỢP 1: Xử lý lỗi mạng hoặc lỗi xác thực từ Server (HTTP 4xx / 5xx)
  // -------------------------------------------------------------------------
  if (reply->error() != QNetworkReply::NoError) {
    QString errorMsg = reply->errorString();
    QByteArray responseBody = reply->readAll();
    
    // Nếu NestJS trả về thông báo lỗi chi tiết dạng JSON (ví dụ: { "message": "Sai mật khẩu" })
    if (!responseBody.isEmpty()) {
      QJsonDocument doc = QJsonDocument::fromJson(responseBody);
      if (doc.isObject() && doc.object().contains("message")) {
        QJsonValue msgVal = doc.object()["message"];
        if (msgVal.isString()) {
          errorMsg = msgVal.toString();
        } else if (msgVal.isArray()) {
          // Trường hợp ValidationPipe trả về mảng các lỗi validation
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

  // -------------------------------------------------------------------------
  // TRƯỜNG HỢP 2: Đăng nhập thành công (HTTP 200/201 OK) -> Parse dữ liệu JSON
  // -------------------------------------------------------------------------
  QByteArray responseData = reply->readAll();
  QJsonDocument doc = QJsonDocument::fromJson(responseData);
  if (!doc.isObject()) {
    emit logMessage("ERROR",
                    "[AUTH] Phản hồi từ server không đúng định dạng JSON.");
    emit loginFailed("Phản hồi từ server không đúng định dạng JSON.");
    return;
  }

  QJsonObject root = doc.object();
  
  // 1. Trích xuất và lưu Access Token JWT (dùng để xác thực WebSocket & WebRTC sau này)
  m_accessToken = root["accessToken"].toString();

  // 2. Trích xuất thông tin hồ sơ người dùng (UserProfile)
  QJsonObject userObj = root["user"].toObject();
  m_currentUser.id = userObj["id"].toString();
  m_currentUser.email = userObj["email"].toString();
  m_currentUser.fullName = userObj["fullName"].toString();
  m_currentUser.role = userObj["role"].toString("PILOT");

  // 3. Nếu server gửi kèm danh sách Drone đã gán trong assignedDevices
  m_devices.clear();
  if (root.contains("assignedDevices") && root["assignedDevices"].isArray()) {
    parseDevices(root["assignedDevices"].toArray());
  }

  emit logMessage("SUCCESS",
                  QString("🔑 [AUTH] Đăng nhập thành công! Tài khoản: %1 (%2)")
                      .arg(m_currentUser.email)
                      .arg(m_currentUser.role));

  // Phát Signal thông báo đăng nhập thành công cho MainWindow chuyển màn hình
  emit loginSuccess(m_currentUser, m_devices);

  // 4. Tự động gọi tiếp endpoint Dashboard để cập nhật danh mục Drone mới nhất
  fetchDevices();
}

/**
 * @brief Gửi HTTP GET để tải toàn bộ danh mục Drone phi công sở hữu.
 * Endpoint: GET /api/v1/dashboard/devices với Bearer JWT Header.
 */
void AuthService::fetchDevices() {
  // Nếu chưa có Token JWT thì không thể thực hiện request có bảo mật
  if (m_accessToken.isEmpty())
    return;

  emit logMessage("INFO", "[AUTH] Đang làm mới danh mục Drone từ server...");

  // Endpoint chuẩn của NestJS Gateway DashboardController
  QString endpoint = m_serverUrl + "/api/v1/dashboard/devices";

  QUrl url(endpoint);
  QNetworkRequest request(url);
  
  // Gắn Bearer Token JWT vào HTTP Header "Authorization" để Guard phía NestJS kiểm tra
  request.setRawHeader("Authorization",
                       QString("Bearer %1").arg(m_accessToken).toUtf8());

  // Thực hiện HTTP GET bất đồng bộ
  QNetworkReply *reply = m_netManager->get(request);
  connect(reply, &QNetworkReply::finished, this,
          [this, reply]() { onFetchDevicesReplyFinished(reply); });
}

/**
 * @brief Xử lý kết quả trả về của danh mục Drone từ Dashboard Endpoint.
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

  // Hỗ trợ cả 2 định dạng trả về: Mảng JSON thuần [...] hoặc Object bọc { "data": [...] }
  QJsonArray arr;
  if (doc.isArray()) {
    arr = doc.array();
  } else if (doc.isObject() && doc.object().contains("data") &&
             doc.object()["data"].isArray()) {
    arr = doc.object()["data"].toArray();
  }

  // Parse danh sách Drone vào m_devices và phát Signal cập nhật ComboBox trên UI
  parseDevices(arr);
  emit logMessage(
      "SUCCESS",
      QString("🚁 [AUTH] Đã cập nhật thành công %1 Drone vào phi đội.")
          .arg(m_devices.size()));
  emit devicesUpdated(m_devices);
}

/**
 * @brief Chuyển đổi mảng JSON thành danh sách struct DroneInfo an toàn kiểu dữ liệu.
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
 * @brief Đăng xuất và xóa sạch Token khỏi bộ nhớ RAM để đảm bảo an toàn.
 */
void AuthService::logout() {
  m_accessToken.clear();
  m_currentUser = UserProfile();
  m_devices.clear();
  emit logMessage("INFO", "[AUTH] Đã đăng xuất khỏi tài khoản.");
  emit loggedOut();
}

