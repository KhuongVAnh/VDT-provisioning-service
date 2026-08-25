/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/ui/LoginWidget.h
 * MÔ TẢ: Định nghĩa lớp LoginWidget — Form đăng nhập tài khoản phi công,
 *       hỗ trợ phím tắt điền nhanh tài khoản Demo (Admin / Pilot).
 * ============================================================================
 */

#pragma once

#include <QLabel>
#include <QLineEdit>
#include <QProgressBar>
#include <QPushButton>
#include <QWidget>

class LoginWidget : public QWidget {
  Q_OBJECT

public:
  explicit LoginWidget(QWidget *parent = nullptr);
  ~LoginWidget() override = default;

  /**
   * @brief Hiển thị dòng thông báo trạng thái dưới nút bấm.
   */
  void setStatus(const QString &message, bool isError = false);

  /**
   * @brief Bật/tắt thanh trạng thái Loading và khóa/mở nút đăng nhập.
   */
  void setLoading(bool loading);

signals:
  // Phát ra khi người dùng bấm nút Đăng nhập
  void loginSubmitted(const QString &serverUrl, const QString &email,
                      const QString &password);

private slots:
  void onBtnLoginClicked();
  void fillAdminDemo();
  void fillPilotDemo();

private:
  void setupUi();

  QLineEdit *m_editServerUrl;
  QLineEdit *m_editEmail;
  QLineEdit *m_editPassword;
  QPushButton *m_btnLogin;
  QPushButton *m_btnAdminDemo;
  QPushButton *m_btnPilotDemo;
  QLabel *m_lblStatus;
  QProgressBar *m_progressBar;
};
