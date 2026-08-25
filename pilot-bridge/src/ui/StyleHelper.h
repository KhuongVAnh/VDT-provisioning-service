/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/ui/StyleHelper.h
 * MÔ TẢ: Định nghĩa lớp tiện ích StyleHelper — Quản lý toàn bộ giao diện,
 *       bảng màu Dark HUD Cyberpunk và huy hiệu trạng thái (Status Badges).
 * ============================================================================
 */

#pragma once

#include <QString>

class StyleHelper {
public:
  /**
   * @brief Trả về chuỗi CSS toàn cục (Qt Style Sheet - QSS) cho ứng dụng.
   */
  static QString getAppStyleSheet();

  /**
   * @brief Sinh kiểu dáng cho huy hiệu trạng thái (Xanh lá / Đỏ / Xanh lam).
   * @param active Trạng thái đang kích hoạt hay dừng
   * @param type Kiểu màu ("green" cho MAVLink/Video, "cyan" cho kết nối mạng)
   */
  static QString getStatusBadgeStyle(bool active,
                                     const QString &type = "green");
};
