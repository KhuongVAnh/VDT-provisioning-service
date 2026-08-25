/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/ui/LoginWidget.cpp
 * MÔ TẢ: Triển khai giao diện form đăng nhập và xử lý xác thực tài khoản.
 * ============================================================================
 */

#include "LoginWidget.h"
#include <QFrame>
#include <QGridLayout>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QVBoxLayout>

LoginWidget::LoginWidget(QWidget *parent) : QWidget(parent) { setupUi(); }

void LoginWidget::setupUi() {
  auto *mainLayout = new QVBoxLayout(this);
  mainLayout->setAlignment(Qt::AlignCenter);
  mainLayout->setContentsMargins(40, 40, 40, 40);

  // =========================================================================
  // KHUNG THẺ ĐĂNG NHẬP TRUNG TÂM (CARD FRAME)
  // =========================================================================
  auto *cardFrame = new QFrame(this);
  cardFrame->setObjectName("loginCard");
  cardFrame->setFixedWidth(520);
  cardFrame->setStyleSheet("#loginCard {"
                           "  background: qlineargradient(x1:0, y1:0, x2:1, "
                           "y2:1, stop:0 #0f172a, stop:1 #1e293b);"
                           "  border: 1px solid rgba(56, 189, 248, 0.3);"
                           "  border-radius: 16px;"
                           "  padding: 30px;"
                           "}");

  auto *cardLayout = new QVBoxLayout(cardFrame);
  cardLayout->setSpacing(18);

  // 1. Logo thương hiệu & Tiêu đề
  auto *lblLogo = new QLabel("🚁 Pilot Bridge", this);
  lblLogo->setAlignment(Qt::AlignCenter);
  lblLogo->setStyleSheet("font-size: 22px; font-weight: 800; color: #38bdf8; "
                         "letter-spacing: 1.5px;");
  cardLayout->addWidget(lblLogo);

  auto *lblSubtitle = new QLabel(
      "Trạm Cầu Nối Phân Quyền MAVLink & Video FPV cho QGroundControl", this);
  lblSubtitle->setAlignment(Qt::AlignCenter);
  lblSubtitle->setWordWrap(true);
  lblSubtitle->setStyleSheet(
      "font-size: 13px; color: #94a3b8; margin-bottom: 8px;");
  cardLayout->addWidget(lblSubtitle);

  // 2. Các ô nhập liệu (Server URL, Email, Password)
  auto *formLayout = new QGridLayout();
  formLayout->setVerticalSpacing(14);
  formLayout->setHorizontalSpacing(10);

  auto makeLabel = [this](const QString &text) {
    auto *lbl = new QLabel(text, this);
    lbl->setStyleSheet("font-size: 13px; font-weight: 600; color: #cbd5e1;");
    return lbl;
  };

  m_editServerUrl = new QLineEdit("http://103.253.20.32:10004", this);
  m_editServerUrl->setPlaceholderText("http://<IP_VPS>:10004");

  m_editEmail = new QLineEdit("admin@gmail.com", this);
  m_editEmail->setPlaceholderText("pilot@gmail.com");

  m_editPassword = new QLineEdit("admin", this);
  m_editPassword->setEchoMode(QLineEdit::Password);
  m_editPassword->setPlaceholderText("Nhập mật khẩu");

  int row = 0;
  formLayout->addWidget(makeLabel("🌐 Địa chỉ Server Cloud:"), row, 0);
  formLayout->addWidget(m_editServerUrl, row++, 1);

  formLayout->addWidget(makeLabel("✉️ Email Phi công:"), row, 0);
  formLayout->addWidget(m_editEmail, row++, 1);

  formLayout->addWidget(makeLabel("🔒 Mật khẩu:"), row, 0);
  formLayout->addWidget(m_editPassword, row++, 1);

  cardLayout->addLayout(formLayout);

  // 3. Thanh trạng thái & Progress bar hiệu ứng chờ
  m_lblStatus = new QLabel("", this);
  m_lblStatus->setAlignment(Qt::AlignCenter);
  m_lblStatus->setWordWrap(true);
  m_lblStatus->setStyleSheet("font-size: 12px; color: #94a3b8;");
  cardLayout->addWidget(m_lblStatus);

  m_progressBar = new QProgressBar(this);
  m_progressBar->setRange(0, 0);
  m_progressBar->setTextVisible(false);
  m_progressBar->setFixedHeight(4);
  m_progressBar->setStyleSheet(
      "QProgressBar::chunk { background: #38bdf8; border-radius: 2px; }");
  m_progressBar->hide();
  cardLayout->addWidget(m_progressBar);

  // 4. Nút Đăng nhập chính
  m_btnLogin = new QPushButton("🚀 ĐĂNG NHẬP VÀO HỆ THỐNG", this);
  m_btnLogin->setCursor(Qt::PointingHandCursor);
  m_btnLogin->setFixedHeight(44);
  m_btnLogin->setStyleSheet(
      "QPushButton {"
      "  background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #0284c7, "
      "stop:1 #0ea5e9);"
      "  color: #ffffff; font-size: 15px; font-weight: 700; border-radius: "
      "8px; border: none;"
      "}"
      "QPushButton:hover { background: #38bdf8; color: #0f172a; }"
      "QPushButton:pressed { background: #0369a1; }"
      "QPushButton:disabled { background: #334155; color: #64748b; }");
  connect(m_btnLogin, &QPushButton::clicked, this,
          &LoginWidget::onBtnLoginClicked);
  cardLayout->addWidget(m_btnLogin);

  // 5. Nút điền nhanh tài khoản Demo
  auto *demoLayout = new QHBoxLayout();
  m_btnAdminDemo = new QPushButton("🔑 Điền Admin (admin@gmail.com)", this);
  m_btnAdminDemo->setStyleSheet(
      "font-size: 11px; padding: 4px 8px; background: rgba(56, 189, 248, 0.1); "
      "border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; color: "
      "#38bdf8;");
  connect(m_btnAdminDemo, &QPushButton::clicked, this,
          &LoginWidget::fillAdminDemo);

  m_btnPilotDemo = new QPushButton("✈️ Điền Pilot (pilot@gmail.com)", this);
  m_btnPilotDemo->setStyleSheet(
      "font-size: 11px; padding: 4px 8px; background: rgba(16, 185, 129, 0.1); "
      "border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; color: "
      "#34d399;");
  connect(m_btnPilotDemo, &QPushButton::clicked, this,
          &LoginWidget::fillPilotDemo);

  demoLayout->addWidget(m_btnAdminDemo);
  demoLayout->addWidget(m_btnPilotDemo);
  cardLayout->addLayout(demoLayout);

  mainLayout->addWidget(cardFrame);
}

/**
 * @brief Xử lý khi nhấn nút Đăng nhập: Kiểm tra hợp lệ và phát Signal.
 */
void LoginWidget::onBtnLoginClicked() {
  QString server = m_editServerUrl->text().trimmed();
  QString email = m_editEmail->text().trimmed();
  QString pass = m_editPassword->text();

  if (server.isEmpty() || email.isEmpty() || pass.isEmpty()) {
    setStatus("Vui lòng nhập đầy đủ URL Server, Email và Mật khẩu.", true);
    return;
  }

  setLoading(true);
  setStatus("Đang xác thực thông tin đăng nhập...", false);
  // Phát Signal lên MainWindow để gọi AuthService::login
  emit loginSubmitted(server, email, pass);
}

void LoginWidget::fillAdminDemo() {
  m_editEmail->setText("admin@gmail.com");
  m_editPassword->setText("admin");
  setStatus("Đã điền tài khoản Quản trị viên Demo.", false);
}

void LoginWidget::fillPilotDemo() {
  m_editEmail->setText("pilot@gmail.com");
  m_editPassword->setText("123456");
  setStatus("Đã điền tài khoản Phi công Demo.", false);
}

void LoginWidget::setStatus(const QString &message, bool isError) {
  m_lblStatus->setText(message);
  if (isError) {
    m_lblStatus->setStyleSheet(
        "font-size: 12px; color: #f87171; font-weight: 600;");
  } else {
    m_lblStatus->setStyleSheet("font-size: 12px; color: #94a3b8;");
  }
}

void LoginWidget::setLoading(bool loading) {
  m_btnLogin->setEnabled(!loading);
  m_editServerUrl->setEnabled(!loading);
  m_editEmail->setEnabled(!loading);
  m_editPassword->setEnabled(!loading);
  m_progressBar->setVisible(loading);
}
