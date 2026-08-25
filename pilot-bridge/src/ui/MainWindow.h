/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/ui/MainWindow.h
 * MÔ TẢ: Cửa sổ giao diện chính (QMainWindow).
 *       Sử dụng QStackedWidget để chuyển đổi qua lại giữa:
 *       - Màn hình 1: LoginWidget (Đăng nhập phi công)
 *       - Màn hình 2: ControlWidget (Trung tâm điều khiển bay & Video FPV)
 * ============================================================================
 */

#pragma once

#include "../api/AuthService.h"
#include "../bridge/DroneBridgeCore.h"
#include "ControlWidget.h"
#include "LoginWidget.h"
#include <QMainWindow>
#include <QStackedWidget>

class MainWindow : public QMainWindow {
  Q_OBJECT

public:
  explicit MainWindow(QWidget *parent = nullptr);
  ~MainWindow() override = default;

private slots:
  // Xử lý khi người dùng nhấn nút "Đăng nhập" tại LoginWidget
  void onLoginSubmitted(const QString &serverUrl, const QString &email,
                        const QString &password);

  // Xử lý khi đăng nhập thành công -> Chuyển sang ControlWidget
  void onLoginSuccess(const UserProfile &user, const QList<DroneInfo> &devices);

  // Xử lý khi đăng nhập thất bại
  void onLoginFailed(const QString &errorMessage);

  // Xử lý khi người dùng nhấn "Đăng xuất" tại ControlWidget
  void onLogout();

  // Chuyển tiếp log từ các module vào Console Debug của ControlWidget
  void onLogEvent(const QString &level, const QString &message);

private:
  void setupUi();

  AuthService *m_authService;    // Dịch vụ xác thực tài khoản
  DroneBridgeCore *m_bridgeCore; // Bộ não điều phối trung tâm

  QStackedWidget *m_stackedWidget; // Widget xếp chồng chuyển đổi màn hình
  LoginWidget *m_loginWidget;      // Màn hình 1
  ControlWidget *m_controlWidget;  // Màn hình 2
};
