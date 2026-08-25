/**
 * ============================================================================
 * DỰ ÁN: Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone
 * FILE: src/ui/StyleHelper.cpp
 * MÔ TẢ: Triển khai stylesheet giao diện Dark HUD cao cấp cho Qt Widgets.
 * ============================================================================
 */

#include "StyleHelper.h"

/**
 * @brief Định nghĩa toàn bộ stylesheet (QSS) cho toàn ứng dụng.
 */
QString StyleHelper::getAppStyleSheet() {
  return R"(
        QMainWindow {
            background-color: #0f172a;
            color: #f8fafc;
        }

        QWidget {
            color: #f1f5f9;
            font-family: 'Segoe UI', 'Ubuntu', sans-serif;
            font-size: 13px;
        }

        QGroupBox {
            font-weight: bold;
            font-size: 13px;
            border: 1px solid #334155;
            border-radius: 8px;
            margin-top: 12px;
            padding-top: 14px;
            background-color: #1e293b;
        }

        QGroupBox::title {
            subcontrol-origin: margin;
            subcontrol-position: top left;
            left: 12px;
            padding: 0 6px;
            color: #38bdf8;
        }

        QLabel {
            color: #cbd5e1;
        }

        QLineEdit, QComboBox, QSpinBox {
            background-color: #0f172a;
            border: 1px solid #475569;
            border-radius: 6px;
            padding: 6px 10px;
            color: #ffffff;
            selection-background-color: #0284c7;
        }

        QLineEdit:focus, QComboBox:focus, QSpinBox:focus {
            border: 1px solid #38bdf8;
            background-color: #131d33;
        }

        QPushButton {
            background-color: #0284c7;
            color: #ffffff;
            font-weight: bold;
            border-radius: 6px;
            padding: 8px 16px;
            border: none;
        }

        QPushButton:hover {
            background-color: #0369a1;
        }

        QPushButton:pressed {
            background-color: #075985;
        }

        QPushButton#btnStart {
            background-color: #10b981;
            font-size: 14px;
            padding: 10px 20px;
        }

        QPushButton#btnStart:hover {
            background-color: #059669;
        }

        QPushButton#btnStop {
            background-color: #ef4444;
            font-size: 14px;
            padding: 10px 20px;
        }

        QPushButton#btnStop:hover {
            background-color: #dc2626;
        }

        QPlainTextEdit {
            background-color: #090d16;
            color: #a7f3d0;
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 12px;
            border: 1px solid #334155;
            border-radius: 6px;
            padding: 6px;
        }

        QScrollBar:vertical {
            background: #1e293b;
            width: 10px;
            margin: 0px;
            border-radius: 5px;
        }

        QScrollBar::handle:vertical {
            background: #475569;
            min-height: 20px;
            border-radius: 5px;
        }

        QScrollBar::handle:vertical:hover {
            background: #64748b;
        }

        QProgressBar {
            border: 1px solid #334155;
            border-radius: 4px;
            text-align: center;
            color: #ffffff;
            background-color: #0f172a;
            font-weight: bold;
        }

        QProgressBar::chunk {
            background-color: #10b981;
            border-radius: 3px;
        }
    )";
}

/**
 * @brief Định nghĩa màu sắc và viền cho Status Badge (Đang chạy / Đã dừng).
 */
QString StyleHelper::getStatusBadgeStyle(bool active, const QString &type) {
  if (active) {
    if (type == "green") {
      return "background-color: #064e3b; color: #34d399; border: 1px solid "
             "#059669; border-radius: 12px; padding: 3px 10px; font-weight: "
             "bold;";
    } else if (type == "cyan") {
      return "background-color: #082f49; color: #38bdf8; border: 1px solid "
             "#0284c7; border-radius: 12px; padding: 3px 10px; font-weight: "
             "bold;";
    }
  }
  return "background-color: #450a0a; color: #f87171; border: 1px solid "
         "#dc2626; border-radius: 12px; padding: 3px 10px; font-weight: bold;";
}
