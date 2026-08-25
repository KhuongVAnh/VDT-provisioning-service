/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/main.cpp
 * MÔ TẢ: Điểm khởi chạy chính (Entrypoint) của toàn bộ ứng dụng C++ Qt6.
 * ============================================================================
 */

#include "ui/MainWindow.h"
#include <QApplication>
#include <iostream>

int main(int argc, char *argv[]) {
  // 1. Khởi tạo đối tượng ứng dụng Qt GUI (QApplication)
  // Quản lý vòng lặp sự kiện (Event Loop), cấu hình hệ điều hành và render cửa
  // sổ.
  QApplication app(argc, argv);

  // 2. Thiết lập metadata thông tin ứng dụng
  app.setApplicationName("Pilot Bridge");
  app.setApplicationVersion("1.0.0");
  app.setOrganizationName("Antigravity UAV Systems");

  // 3. Khởi tạo cửa sổ chính (MainWindow)
  // MainWindow chứa bộ chuyển đổi màn hình QStackedWidget (LoginWidget <->
  // ControlWidget)
  MainWindow window;

  // 4. Hiển thị cửa sổ giao diện lên màn hình
  window.show();

  // 5. Bắt đầu vòng lặp sự kiện chính của Qt (Main Event Loop)
  // Hàm này sẽ block và lắng nghe các sự kiện (chuột, phím, timer, socket mạng)
  // cho đến khi người dùng đóng ứng dụng (exit code 0).
  return app.exec();
}
