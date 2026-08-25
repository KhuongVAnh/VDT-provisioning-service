/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/api/AuthService.h
 * MÔ TẢ: Định nghĩa lớp dịch vụ xác thực tài khoản phi công và truy vấn
 *       danh sách phi đội Drone từ NestJS Provisioning API (Cổng 10004).
 * ============================================================================
 */

#pragma once

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QList>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QObject>
#include <QString>

// Cấu trúc dữ liệu chứa thông tin hồ sơ tài khoản phi công
struct UserProfile {
  QString id;
  QString email;
  QString fullName;
  QString role; // "PILOT" hoặc "ADMIN"
};

// Cấu trúc dữ liệu chứa thông tin một Drone trong phi đội
struct DroneInfo {
  QString id;
  QString deviceId;      // Mã định danh duy nhất (vd: VM-DRONE-e232039...)
  QString hardwareModel; // Dòng phần cứng (vd: Quadcopter X500, Hexacopter)
  QString vpnIp;         // Địa chỉ IP trong mạng WireGuard (vd: 10.13.37.4)
  QString status;        // "ACTIVE", "MAINTENANCE", "OFFLINE"
  bool isOnline = false; // Trạng thái đang trực tuyến
};

class AuthService : public QObject {
  Q_OBJECT

public:
  explicit AuthService(QObject *parent = nullptr);
  ~AuthService() override = default;

  /**
   * @brief Gửi yêu cầu đăng nhập bằng Email & Mật khẩu lên Cloud.
   * @param serverUrl Địa chỉ máy chủ (vd: http://103.253.20.32:10004)
   * @param email Email tài khoản phi công
   * @param password Mật khẩu
   */
  void login(const QString &serverUrl, const QString &email,
             const QString &password);

  /**
   * @brief Tải lại danh mục Drone được gán quyền cho tài khoản hiện tại.
   */
  void fetchDevices();

  /**
   * @brief Đăng xuất tài khoản và xóa sạch Access Token khỏi RAM.
   */
  void logout();

  // Các hàm getter kiểm tra trạng thái
  bool isLoggedIn() const { return !m_accessToken.isEmpty(); }
  QString getAccessToken() const { return m_accessToken; }
  QString getServerUrl() const { return m_serverUrl; }
  UserProfile getCurrentUser() const { return m_currentUser; }
  QList<DroneInfo> getDevices() const { return m_devices; }

signals:
  // Phát ra khi đăng nhập thành công và nạp xong danh sách phi đội
  void loginSuccess(const UserProfile &user, const QList<DroneInfo> &devices);

  // Phát ra khi đăng nhập thất bại (sai mật khẩu, lỗi mạng...)
  void loginFailed(const QString &errorMessage);

  // Phát ra khi danh mục Drone được làm mới
  void devicesUpdated(const QList<DroneInfo> &devices);

  // Phát ra khi người dùng đăng xuất
  void loggedOut();

  // Phát dòng log vào Console Debug
  void logMessage(const QString &level, const QString &message);

private slots:
  void onLoginReplyFinished(QNetworkReply *reply);
  void onFetchDevicesReplyFinished(QNetworkReply *reply);

private:
  QNetworkAccessManager *m_netManager; // Quản lý kết nối HTTP Async của Qt
  QString m_serverUrl;
  QString m_accessToken; // JWT Bearer Token
  UserProfile m_currentUser;
  QList<DroneInfo> m_devices;

  void parseDevices(const QJsonArray &arr);
};
