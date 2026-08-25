/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/ui/MainWindow.cpp
 * MÔ TẢ: Triển khai logic điều hướng màn hình và kết nối tín hiệu giữa UI và
 * Core.
 * ============================================================================
 */

#include "MainWindow.h"
#include "StyleHelper.h"

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent), m_authService(new AuthService(this)),
      m_bridgeCore(new DroneBridgeCore(this)) {
  setupUi();

  // =========================================================================
  // 1. KẾT NỐI TÍN HIỆU XÁC THỰC TÀI KHOẢN (AUTH SERVICE)
  // =========================================================================
  // Khi người dùng bấm Đăng nhập tại LoginWidget -> Gửi sang AuthService
  connect(m_loginWidget, &LoginWidget::loginSubmitted, this,
          &MainWindow::onLoginSubmitted);

  // Khi đăng nhập thành công -> Cập nhật thông tin và chuyển sang ControlWidget
  connect(m_authService, &AuthService::loginSuccess, this,
          &MainWindow::onLoginSuccess);

  // Khi đăng nhập thất bại -> Hiển thị thông báo lỗi tại LoginWidget
  connect(m_authService, &AuthService::loginFailed, this,
          &MainWindow::onLoginFailed);

  // Khi danh sách Drone được làm mới -> Đồng bộ sang ControlWidget
  connect(m_authService, &AuthService::devicesUpdated, this,
          [this](const QList<DroneInfo> &devices) {
            m_controlWidget->updateUserData(m_authService->getCurrentUser(),
                                            devices);
          });

  // Đẩy dòng log xác thực vào Console Debug
  connect(m_authService, &AuthService::logMessage, this,
          &MainWindow::onLogEvent);

  // =========================================================================
  // 2. KẾT NỐI SỰ KIỆN ĐĂNG XUẤT
  // =========================================================================
  connect(m_controlWidget, &ControlWidget::logoutRequested, this,
          &MainWindow::onLogout);

  // =========================================================================
  // 3. KẾT NỐI SỰ KIỆN LOG TỪ TẦNG ĐIỀU PHỐI (DRONE BRIDGE CORE)
  // =========================================================================
  connect(m_bridgeCore, &DroneBridgeCore::logEvent, this,
          &MainWindow::onLogEvent);
}

void MainWindow::setupUi() {
  setWindowTitle("Pilot Bridge - BVLOS Ground Station Relay (Qt6)");
  resize(980, 720);
  setStyleSheet(StyleHelper::getAppStyleSheet());

  // Khởi tạo QStackedWidget làm widget trung tâm
  m_stackedWidget = new QStackedWidget(this);

  m_loginWidget = new LoginWidget(this);
  m_controlWidget = new ControlWidget(m_bridgeCore, m_authService, this);

  // Thêm các màn hình vào stack
  m_stackedWidget->addWidget(m_loginWidget);   // Index 0: Màn hình Đăng nhập
  m_stackedWidget->addWidget(m_controlWidget); // Index 1: Màn hình Điều khiển

  setCentralWidget(m_stackedWidget);
  m_stackedWidget->setCurrentIndex(0); // Mặc định hiển thị màn hình Đăng nhập
}

void MainWindow::onLoginSubmitted(const QString &serverUrl,
                                  const QString &email,
                                  const QString &password) {
  m_controlWidget->appendLog(
      "INFO", QString("[AUTH] Bắt đầu đăng nhập tới %1 với tài khoản %2...")
                  .arg(serverUrl, email));
  m_authService->login(serverUrl, email, password);
}

void MainWindow::onLoginSuccess(const UserProfile &user,
                                const QList<DroneInfo> &devices) {
  m_loginWidget->setLoading(false);
  m_loginWidget->setStatus("", false);

  // Nạp dữ liệu phi công và danh sách Drone vào giao diện điều khiển
  m_controlWidget->updateUserData(user, devices);
  m_controlWidget->appendLog("SUCCESS",
                             QString("🎉 Đăng nhập thành công! Chuyển sang màn "
                                     "hình điều khiển phi đội (%1 Drone).")
                                 .arg(devices.size()));

  // Chuyển sang Màn hình Điều khiển tác chiến (Index 1)
  m_stackedWidget->setCurrentIndex(1);
}

void MainWindow::onLoginFailed(const QString &errorMessage) {
  m_loginWidget->setLoading(false);
  m_loginWidget->setStatus("Lỗi: " + errorMessage, true);
  m_controlWidget->appendLog("ERROR",
                             "[AUTH] Đăng nhập thất bại: " + errorMessage);
}

void MainWindow::onLogout() {
  m_loginWidget->setLoading(false);
  m_loginWidget->setStatus("Đã đăng xuất.", false);
  // Quay trở lại Màn hình Đăng nhập (Index 0)
  m_stackedWidget->setCurrentIndex(0);
}

void MainWindow::onLogEvent(const QString &level, const QString &message) {
  if (m_controlWidget) {
    m_controlWidget->appendLog(level, message);
  }
}
