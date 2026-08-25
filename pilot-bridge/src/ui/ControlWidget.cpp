/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/ui/ControlWidget.cpp
 * MÔ TẢ: Triển khai giao diện điều khiển tác chiến HUD, quản lý sự kiện bật/tắt
 *       MAVLink Relay (Port 5760), Video WebRTC (Port 5600) và OSD Strip.
 * ============================================================================
 */

#include "ControlWidget.h"
#include "StyleHelper.h"
#include <QApplication>
#include <QClipboard>
#include <QDateTime>
#include <QFrame>
#include <QGridLayout>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QNetworkInterface>
#include <QVBoxLayout>

ControlWidget::ControlWidget(DroneBridgeCore *bridgeCore,
                             AuthService *authService, QWidget *parent)
    : QWidget(parent), m_bridgeCore(bridgeCore), m_authService(authService) {
  setupUi();

  // =========================================================================
  // KẾT NỐI CÁC TÍN HIỆU TỪ TẦNG ĐIỀU PHỐI (DRONE BRIDGE CORE)
  // =========================================================================
  // 1. Cập nhật số lượng trạm QGroundControl đang kết nối vào cổng TCP 5760
  connect(m_bridgeCore, &DroneBridgeCore::gcsStatusChanged, this,
          &ControlWidget::onGcsStatusChanged);

  // 2. Cập nhật trạng thái và số liệu luồng Video WebRTC FPV
  connect(m_bridgeCore, &DroneBridgeCore::videoStatusChanged, this,
          &ControlWidget::onVideoStatusChanged);
  connect(m_bridgeCore, &DroneBridgeCore::videoStatsUpdated, this,
          &ControlWidget::onVideoStatsUpdated);

  // 3. Cập nhật tốc độ băng thông MAVLink (TX/RX KB/s)
  connect(m_bridgeCore, &DroneBridgeCore::throughputUpdated, this,
          &ControlWidget::onThroughputUpdated);
}

void ControlWidget::setupUi() {
  auto *mainLayout = new QVBoxLayout(this);
  mainLayout->setContentsMargins(18, 18, 18, 18);
  mainLayout->setSpacing(14);

  // =========================================================================
  // 1. TOP HEADER & USER PROFILE BAR
  // =========================================================================
  auto *topBarLayout = new QHBoxLayout();

  auto *lblBrand = new QLabel("🚁 Pilot Bridge", this);
  lblBrand->setStyleSheet("font-size: 18px; font-weight: 800; color: #38bdf8; "
                          "letter-spacing: 1px;");
  topBarLayout->addWidget(lblBrand);

  topBarLayout->addStretch();

  m_lblUserInfo = new QLabel("👤 Đang tải thông tin...", this);
  m_lblUserInfo->setStyleSheet(
      "font-size: 13px; font-weight: 600; color: #cbd5e1; background: #1e293b; "
      "padding: 6px 12px; border-radius: 6px; border: 1px solid #334155;");
  topBarLayout->addWidget(m_lblUserInfo);

  m_btnLogout = new QPushButton("🚪 Đăng xuất", this);
  m_btnLogout->setCursor(Qt::PointingHandCursor);
  m_btnLogout->setStyleSheet(
      "font-size: 12px; font-weight: 600; padding: 6px 12px; background: "
      "rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, "
      "68, 68, 0.3); border-radius: 6px;");
  connect(m_btnLogout, &QPushButton::clicked, this, [this]() {
    if (m_bridgeCore->isActive())
      m_bridgeCore->stopBridge();
    if (m_bridgeCore->isVideoActive())
      m_bridgeCore->stopVideoRelay();
    m_authService->logout();
    emit logoutRequested();
  });
  topBarLayout->addWidget(m_btnLogout);

  mainLayout->addLayout(topBarLayout);

  // =========================================================================
  // 2. DRONE SELECTOR BAR (THANH CHỌN DRONE MỤC TIÊU)
  // =========================================================================
  auto *boxSelector = new QGroupBox("CHỌN MỤC TIÊU DRONE ĐIỀU KHIỂN", this);
  auto *layoutSelector = new QHBoxLayout(boxSelector);

  auto *lblTarget = new QLabel("Phi đội Drone sở hữu:", this);
  lblTarget->setStyleSheet(
      "font-size: 13px; font-weight: 600; color: #94a3b8;");
  layoutSelector->addWidget(lblTarget);

  m_comboDrones = new QComboBox(this);
  m_comboDrones->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
  m_comboDrones->setStyleSheet(
      "font-size: 14px; font-weight: 600; padding: 6px 12px; background: "
      "#0f172a; color: #38bdf8; border: 1px solid #38bdf8; border-radius: "
      "6px;");
  layoutSelector->addWidget(m_comboDrones);

  m_btnRefreshDrones = new QPushButton("🔄 Làm mới danh sách", this);
  m_btnRefreshDrones->setStyleSheet(
      "font-size: 12px; font-weight: 600; padding: 6px 12px; background: "
      "#1e293b; color: #cbd5e1; border: 1px solid #475569; border-radius: "
      "6px;");
  connect(m_btnRefreshDrones, &QPushButton::clicked, this,
          &ControlWidget::onBtnRefreshDevicesClicked);
  layoutSelector->addWidget(m_btnRefreshDrones);

  mainLayout->addWidget(boxSelector);

  // =========================================================================
  // 3. TWO CORE BRIDGES (CARD MAVLINK & CARD VIDEO FPV)
  // =========================================================================
  auto *bridgesLayout = new QHBoxLayout();
  bridgesLayout->setSpacing(14);

  // [CARD 1]: CẦU NỐI MAVLINK TELEMETRY (TCP 127.0.0.1:5760)
  auto *cardMavlink =
      new QGroupBox("📡 CẦU NỐI MAVLINK TELEMETRY & LỆNH BAY", this);
  auto *layoutMavlink = new QVBoxLayout(cardMavlink);
  layoutMavlink->setSpacing(10);

  auto *mavHeader = new QHBoxLayout();
  mavHeader->addWidget(new QLabel("Trạng thái:", this));
  m_lblMavlinkBadge = new QLabel("🔴 CHƯA CHẠY", this);
  m_lblMavlinkBadge->setStyleSheet(StyleHelper::getStatusBadgeStyle(false));
  mavHeader->addWidget(m_lblMavlinkBadge);
  mavHeader->addStretch();
  layoutMavlink->addLayout(mavHeader);

  m_btnToggleMavlink = new QPushButton("▶ BẬT CẦU NỐI MAVLINK", this);
  m_btnToggleMavlink->setCursor(Qt::PointingHandCursor);
  m_btnToggleMavlink->setFixedHeight(40);
  m_btnToggleMavlink->setStyleSheet(
      "QPushButton { background: qlineargradient(x1:0, y1:0, x2:1, y2:0, "
      "stop:0 #059669, stop:1 #10b981); color: #fff; font-size: 14px; "
      "font-weight: 700; border-radius: 6px; border: none; }"
      "QPushButton:hover { background: #34d399; color: #064e3b; }");
  connect(m_btnToggleMavlink, &QPushButton::clicked, this,
          &ControlWidget::onBtnToggleMavlinkClicked);
  layoutMavlink->addWidget(m_btnToggleMavlink);

  m_lblMavlinkStats = new QLabel("Tốc độ: 0.0 KB/s (TX) | 0.0 KB/s (RX)", this);
  m_lblMavlinkStats->setStyleSheet("font-size: 12px; color: #94a3b8;");
  layoutMavlink->addWidget(m_lblMavlinkStats);

  m_lblGcsClients =
      new QLabel("Trạm QGC kết nối: 0 client (TCP Port 5760)", this);
  m_lblGcsClients->setStyleSheet("font-size: 12px; color: #94a3b8;");
  layoutMavlink->addWidget(m_lblGcsClients);

  bridgesLayout->addWidget(cardMavlink);

  // [CARD 2]: CẦU NỐI VIDEO FPV STREAM (WEBRTC WHEP -> UDP 5600)
  auto *cardVideo =
      new QGroupBox("🎥 CẦU NỐI VIDEO FPV STREAM (WEBRTC WHEP)", this);
  auto *layoutVideo = new QVBoxLayout(cardVideo);
  layoutVideo->setSpacing(10);

  auto *vidHeader = new QHBoxLayout();
  vidHeader->addWidget(new QLabel("Trạng thái:", this));
  m_lblVideoBadge = new QLabel("⚪ ĐÃ TẮT VIDEO", this);
  m_lblVideoBadge->setStyleSheet(StyleHelper::getStatusBadgeStyle(false));
  vidHeader->addWidget(m_lblVideoBadge);
  vidHeader->addStretch();
  layoutVideo->addLayout(vidHeader);

  m_btnToggleVideo = new QPushButton("▶ BẬT VIDEO FPV FORWARD", this);
  m_btnToggleVideo->setCursor(Qt::PointingHandCursor);
  m_btnToggleVideo->setFixedHeight(40);
  m_btnToggleVideo->setStyleSheet(
      "QPushButton { background: qlineargradient(x1:0, y1:0, x2:1, y2:0, "
      "stop:0 #0284c7, stop:1 #0ea5e9); color: #fff; font-size: 14px; "
      "font-weight: 700; border-radius: 6px; border: none; }"
      "QPushButton:hover { background: #38bdf8; color: #0c4a6e; }");
  connect(m_btnToggleVideo, &QPushButton::clicked, this,
          &ControlWidget::onBtnToggleVideoClicked);
  layoutVideo->addWidget(m_btnToggleVideo);

  m_lblVideoStats = new QLabel("Lưu lượng: 0 KB | Tốc độ: 0 packets/s", this);
  m_lblVideoStats->setStyleSheet("font-size: 12px; color: #94a3b8;");
  layoutVideo->addWidget(m_lblVideoStats);

  m_lblVideoTarget = new QLabel("Đích chuyển tiếp: UDP 127.0.0.1:5600", this);
  m_lblVideoTarget->setStyleSheet("font-size: 12px; color: #94a3b8;");
  layoutVideo->addWidget(m_lblVideoTarget);

  bridgesLayout->addWidget(cardVideo);

  mainLayout->addLayout(bridgesLayout);

  // =========================================================================
  // 5. DEBUG & PROCESS LOG CONSOLE (CONSOLE NHẬT KÝ TIẾN TRÌNH)
  // =========================================================================
  auto *boxLog = new QGroupBox(
      "NHẬT KÝ BẮT TAY & TIẾN TRÌNH CHUYỂN TIẾP (DEBUG LOG CONSOLE)", this);
  auto *layoutLog = new QVBoxLayout(boxLog);
  layoutLog->setSpacing(8);

  auto *logToolbar = new QHBoxLayout();
  logToolbar->addWidget(new QLabel(
      "Dòng sự kiện MAVLink, Video WHEP và kết nối QGroundControl:", this));
  logToolbar->addStretch();

  m_btnCopyLog = new QPushButton("📋 Sao chép Log", this);
  m_btnCopyLog->setStyleSheet(
      "font-size: 11px; padding: 4px 8px; background: #1e293b; color: #cbd5e1; "
      "border: 1px solid #475569; border-radius: 4px;");
  connect(m_btnCopyLog, &QPushButton::clicked, this,
          &ControlWidget::onBtnCopyLogClicked);
  logToolbar->addWidget(m_btnCopyLog);

  m_btnClearLog = new QPushButton("🗑️ Xóa nhật ký", this);
  m_btnClearLog->setStyleSheet(
      "font-size: 11px; padding: 4px 8px; background: #1e293b; color: #cbd5e1; "
      "border: 1px solid #475569; border-radius: 4px;");
  connect(m_btnClearLog, &QPushButton::clicked, this,
          &ControlWidget::onBtnClearLogClicked);
  logToolbar->addWidget(m_btnClearLog);

  layoutLog->addLayout(logToolbar);

  m_logConsole = new QPlainTextEdit(this);
  m_logConsole->setReadOnly(true);
  m_logConsole->setMaximumHeight(180);
  m_logConsole->setStyleSheet(
      "QPlainTextEdit {"
      "  background: #020617;"
      "  color: #38bdf8;"
      "  font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;"
      "  font-size: 11.5px;"
      "  border: 1px solid #1e293b;"
      "  border-radius: 6px;"
      "  padding: 6px;"
      "}");
  layoutLog->addWidget(m_logConsole);

  mainLayout->addWidget(boxLog, 1);
}

void ControlWidget::updateUserData(const UserProfile &user,
                                   const QList<DroneInfo> &devices) {
  m_lblUserInfo->setText(
      QString("👤 %1 (%2 | Vai trò: %3)")
          .arg(user.fullName.isEmpty() ? user.email : user.fullName)
          .arg(user.email)
          .arg(user.role));

  m_comboDrones->clear();
  for (const auto &d : devices) {
    QString text = QString("🚁 %1 — %2 (IP: %3)")
                       .arg(d.deviceId)
                       .arg(d.hardwareModel)
                       .arg(d.vpnIp.isEmpty() ? "10.13.37.X" : d.vpnIp);
    m_comboDrones->addItem(text, d.deviceId);
  }

  if (devices.isEmpty()) {
    m_comboDrones->addItem("⚠️ Không tìm thấy Drone nào được gán cho tài khoản",
                           "");
  }

  // Tự động kích hoạt Cầu nối MAVLink cho Drone đầu tiên để QGroundControl kết
  // nối được ngay lập tức
  if (!m_bridgeCore->isActive() && !devices.isEmpty()) {
    QString firstDeviceId = devices.first().deviceId;
    QString serverUrl = m_authService->getServerUrl();
    QString token = m_authService->getAccessToken();

    bool ok = m_bridgeCore->startBridge(serverUrl, firstDeviceId, token);
    updateMavlinkUiState(ok);

    appendLog("INFO", QString("💡 [HƯỚNG DẪN KẾT NỐI QGROUNDCONTROL]:"));
    appendLog("INFO", QString("   • Type          : TCP"));
    appendLog("INFO", QString("   • Server Address: 127.0.0.1"));
    appendLog("INFO", QString("   • Port          : 5760"));
  }
}

QString ControlWidget::getSelectedDeviceId() const {
  return m_comboDrones->currentData().toString();
}

void ControlWidget::onBtnToggleMavlinkClicked() {
  if (m_bridgeCore->isActive()) {
    m_bridgeCore->stopBridge();
    updateMavlinkUiState(false);
  } else {
    QString deviceId = getSelectedDeviceId();
    if (deviceId.isEmpty()) {
      appendLog(
          "ERROR",
          "Vui lòng chọn Drone từ danh sách trước khi bật MAVLink Relay!");
      return;
    }

    QString serverUrl = m_authService->getServerUrl();
    QString token = m_authService->getAccessToken();

    bool ok = m_bridgeCore->startBridge(serverUrl, deviceId, token);
    updateMavlinkUiState(ok);
  }
}

void ControlWidget::onBtnToggleVideoClicked() {
  if (m_bridgeCore->isVideoActive()) {
    m_bridgeCore->stopVideoRelay();
    updateVideoUiState(false);
  } else {
    QString deviceId = getSelectedDeviceId();
    if (deviceId.isEmpty()) {
      appendLog("ERROR",
                "Vui lòng chọn Drone từ danh sách trước khi bật Video FPV!");
      return;
    }

    QString serverUrl = m_authService->getServerUrl();
    QString token = m_authService->getAccessToken();

    m_bridgeCore->startVideoRelay(serverUrl, deviceId, token, 5600);
    updateVideoUiState(true);
  }
}

void ControlWidget::onBtnRefreshDevicesClicked() {
  m_authService->fetchDevices();
}

void ControlWidget::onBtnClearLogClicked() { m_logConsole->clear(); }

void ControlWidget::onBtnCopyLogClicked() {
  QApplication::clipboard()->setText(m_logConsole->toPlainText());
  appendLog("INFO", "Đã sao chép toàn bộ nhật ký vào Clipboard.");
}

void ControlWidget::updateMavlinkUiState(bool isRunning) {
  if (isRunning) {
    m_lblMavlinkBadge->setText("🟢 ĐANG HOẠT ĐỘNG");
    m_lblMavlinkBadge->setStyleSheet(
        StyleHelper::getStatusBadgeStyle(true, "green"));
    m_btnToggleMavlink->setText("⏹ DỪNG CẦU NỐI MAVLINK");
    m_btnToggleMavlink->setStyleSheet(
        "QPushButton { background: #dc2626; color: #fff; font-size: 14px; "
        "font-weight: 700; border-radius: 6px; border: none; } "
        "QPushButton:hover { background: #ef4444; }");
    m_comboDrones->setEnabled(false);
  } else {
    m_lblMavlinkBadge->setText("🔴 ĐÃ DỪNG");
    m_lblMavlinkBadge->setStyleSheet(StyleHelper::getStatusBadgeStyle(false));
    m_btnToggleMavlink->setText("▶ BẬT CẦU NỐI MAVLINK");
    m_btnToggleMavlink->setStyleSheet(
        "QPushButton { background: qlineargradient(x1:0, y1:0, x2:1, y2:0, "
        "stop:0 #059669, stop:1 #10b981); color: #fff; font-size: 14px; "
        "font-weight: 700; border-radius: 6px; border: none; } "
        "QPushButton:hover { background: #34d399; color: #064e3b; }");
    m_comboDrones->setEnabled(!m_bridgeCore->isVideoActive());
  }
}

void ControlWidget::updateVideoUiState(bool isRunning) {
  if (isRunning) {
    m_lblVideoBadge->setText("🟢 ĐANG STREAM VIDEO");
    m_lblVideoBadge->setStyleSheet(
        StyleHelper::getStatusBadgeStyle(true, "green"));
    m_btnToggleVideo->setText("⏹ DỪNG VIDEO FPV");
    m_btnToggleVideo->setStyleSheet(
        "QPushButton { background: #dc2626; color: #fff; font-size: 14px; "
        "font-weight: 700; border-radius: 6px; border: none; } "
        "QPushButton:hover { background: #ef4444; }");
  } else {
    m_lblVideoBadge->setText("⚪ ĐÃ TẮT VIDEO");
    m_lblVideoBadge->setStyleSheet(StyleHelper::getStatusBadgeStyle(false));
    m_btnToggleVideo->setText("▶ BẬT VIDEO FPV FORWARD");
    m_btnToggleVideo->setStyleSheet(
        "QPushButton { background: qlineargradient(x1:0, y1:0, x2:1, y2:0, "
        "stop:0 #0284c7, stop:1 #0ea5e9); color: #fff; font-size: 14px; "
        "font-weight: 700; border-radius: 6px; border: none; } "
        "QPushButton:hover { background: #38bdf8; color: #0c4a6e; }");
  }
}

void ControlWidget::onGcsStatusChanged(int clientCount, quint16 tcpPort) {
  m_lblGcsClients->setText(QString("Trạm QGC kết nối: %1 client (TCP Port %2)")
                               .arg(clientCount)
                               .arg(tcpPort));
  if (clientCount > 0) {
    m_lblGcsClients->setStyleSheet(
        "font-size: 12px; font-weight: 700; color: #4ade80;");
  } else {
    m_lblGcsClients->setStyleSheet("font-size: 12px; color: #94a3b8;");
  }
}

void ControlWidget::onVideoStatusChanged(bool isStreaming,
                                         const QString &statusText) {
  updateVideoUiState(isStreaming);
  m_lblVideoTarget->setText(
      QString("Đích chuyển tiếp: UDP 127.0.0.1:5600 (%1)").arg(statusText));
}

void ControlWidget::onVideoStatsUpdated(quint64 totalBytes,
                                        quint32 packetsPerSec) {
  m_lblVideoStats->setText(QString("Lưu lượng: %1 KB | Tốc độ: %2 packets/s")
                               .arg(totalBytes / 1024)
                               .arg(packetsPerSec));
}

void ControlWidget::onThroughputUpdated(double txKbps, double rxKbps,
                                        uint64_t totalTxBytes,
                                        uint64_t totalRxBytes) {
  m_lblMavlinkStats->setText(
      QString("Tốc độ: %1 KB/s (TX) | %2 KB/s (RX) | Tổng: %3 KB")
          .arg(txKbps / 8.0, 0, 'f', 1)
          .arg(rxKbps / 8.0, 0, 'f', 1)
          .arg((totalTxBytes + totalRxBytes) / 1024));
}

void ControlWidget::appendLog(const QString &level, const QString &message) {
  QString timeStr = QDateTime::currentDateTime().toString("hh:mm:ss.zzz");
  QString logLine =
      QString("[%1] [%2] %3").arg(timeStr).arg(level).arg(message);
  m_logConsole->appendPlainText(logLine);
}
