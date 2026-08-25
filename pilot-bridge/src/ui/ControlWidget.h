/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/ui/ControlWidget.h
 * MÔ TẢ: Định nghĩa lớp ControlWidget — Màn hình điều khiển tác chiến chính.
 *       Bao gồm:
 *       - Thanh chọn Drone mục tiêu
 *       - Nút điều khiển bật/tắt Cầu nối MAVLink (TCP 5760)
 *       - Nút điều khiển bật/tắt Cầu nối Video WebRTC FPV (UDP 5600)
 *       - Thanh Mini OSD Strip hiển thị thông số bay nhanh
 *       - Console Debug hiển thị log thời gian thực
 * ============================================================================
 */

#pragma once

#include "../api/AuthService.h"
#include "../bridge/DroneBridgeCore.h"
#include <QComboBox>
#include <QLabel>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QWidget>

class ControlWidget : public QWidget {
  Q_OBJECT

public:
  explicit ControlWidget(DroneBridgeCore *bridgeCore, AuthService *authService,
                         QWidget *parent = nullptr);
  ~ControlWidget() override = default;

  /**
   * @brief Nạp dữ liệu hồ sơ người dùng và danh mục phi đội Drone.
   */
  void updateUserData(const UserProfile &user, const QList<DroneInfo> &devices);

  /**
   * @brief Ghi một dòng log có timestamp vào Console Debug.
   */
  void appendLog(const QString &level, const QString &message);

signals:
  // Phát ra khi phi công nhấn nút "Đăng xuất"
  void logoutRequested();

private slots:
  void onBtnToggleMavlinkClicked();
  void onBtnToggleVideoClicked();
  void onBtnRefreshDevicesClicked();
  void onBtnClearLogClicked();
  void onBtnCopyLogClicked();
  void onGcsStatusChanged(int clientCount, quint16 tcpPort);
  void onVideoStatusChanged(bool isStreaming, const QString &statusText);
  void onVideoStatsUpdated(quint64 totalBytes, quint32 packetsPerSec);
  void onThroughputUpdated(double txKbps, double rxKbps, uint64_t totalTxBytes,
                           uint64_t totalRxBytes);

private:
  void setupUi();
  void updateMavlinkUiState(bool isRunning);
  void updateVideoUiState(bool isRunning);
  QString getSelectedDeviceId() const;

  DroneBridgeCore *m_bridgeCore;
  AuthService *m_authService;

  // Các thành phần giao diện Top Bar
  QLabel *m_lblUserInfo;
  QPushButton *m_btnLogout;

  // Thanh chọn Drone
  QComboBox *m_comboDrones;
  QPushButton *m_btnRefreshDrones;

  // Card điều khiển MAVLink Relay
  QLabel *m_lblMavlinkBadge;
  QPushButton *m_btnToggleMavlink;
  QLabel *m_lblMavlinkStats;
  QLabel *m_lblGcsClients;

  // Card điều khiển Video FPV WebRTC
  QLabel *m_lblVideoBadge;
  QPushButton *m_btnToggleVideo;
  QLabel *m_lblVideoStats;
  QLabel *m_lblVideoTarget;

  // Console Debug Log

  // Console Debug Log
  QPlainTextEdit *m_logConsole;
  QPushButton *m_btnClearLog;
  QPushButton *m_btnCopyLog;
};
