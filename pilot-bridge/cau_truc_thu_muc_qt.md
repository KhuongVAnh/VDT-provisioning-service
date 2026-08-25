# 📐 HƯỚNG DẪN CẤU TRÚC THƯ MỤC & LÀM QUEN VỚI QT6 C++
> **Dự án:** Pilot Bridge — Cầu nối Điều khiển Trạm Mặt Đất & Video FPV cho Drone  
> **Kiến trúc:** Cloud MAVLink Socket.IO (Port 10004) & WebRTC WHEP FPV Video (Port 10005)  
> **Tài liệu dành cho:** Lập trình viên lần đầu tiếp cận C++ Qt6 và kiến trúc ứng dụng Desktop điều khiển bay.

---

## 📑 MỤC LỤC
1. [Triết lý & Cơ chế nền tảng của Qt6 C++](#1-triết-lý--cơ-chế-nền-tảng-của-qt6-c)
2. [Sơ đồ cây thư mục dự án Pilot Bridge](#2-sơ-đồ-cây-thư-mục-dự-án-pilot-bridge)
3. [Chi tiết vai trò từng thư mục & Module](#3-chi-tiết-vai-trò-từng-thư-mục--module)
4. [Mô hình phân lớp kiến trúc (Clean Desktop Architecture)](#4-mô-hình-phân-lớp-kiến-trúc-clean-desktop-architecture)
5. [Các khái niệm cốt lõi của Qt người mới bắt buộc phải biết](#5-các-khái-niệm-cốt-lõi-của-qt-người-mới-bắt-buộc-phải-biết)
6. [Các nguyên tắc vàng khi viết code C++ Qt](#6-các-nguyên-tắc-vàng-khi-viết-code-c-qt)

---

## 1. Triết lý & Cơ chế nền tảng của Qt6 C++

**Qt (phát âm là "Cute")** là một framework C++ đa nền tảng mạnh mẽ nhất thế giới hiện nay, được sử dụng trong các hệ thống trạm điều khiển mặt đất (QGroundControl, Mission Planner), phần mềm ô tô tự hành, thiết bị y tế và phần mềm điều khiển công nghiệp.

### 🌟 4 Trụ cột làm nên sức mạnh của Qt:
1. **Cơ chế Signals & Slots (Giao tiếp hướng sự kiện):** Cho phép các đối tượng (Objects) trao đổi dữ liệu với nhau một cách an toàn (Type-safe), hoàn toàn tách rời (Loose Coupling) và hỗ trợ giao tiếp an toàn xuyên Thread (Cross-Thread).
2. **Meta-Object Compiler (MOC):** Bộ tiền xử lý của Qt giúp mở rộng chuẩn C++ thuần, bổ sung tính năng Introspection, Dynamic Properties và Reflection trong thời gian thực.
3. **Cây quan hệ Đối tượng & Tự giải phóng bộ nhớ (QObject Tree Parent-Child):** Khi một đối tượng cha (Parent) bị hủy, toàn bộ các đối tượng con (Children) sẽ tự động được giải phóng bộ nhớ theo tầng (tránh rò rỉ RAM).
4. **Vòng lặp sự kiện (Event Loop):** Quản lý điều hướng sự kiện từ chuột, phím, gói tin mạng TCP/UDP và Timer mà không làm nghẽn giao diện người dùng (Non-blocking GUI).

---

## 2. Sơ đồ cây thư mục dự án Pilot Bridge

```text
pilot-bridge/
├── CMakeLists.txt              # File cấu hình biên dịch CMake (Qt6, MAVLink, libdatachannel, OpenSSL)
├── build_and_run.sh            # Script tự động tải thư viện, cấu hình và khởi chạy ứng dụng
├── README.md                   # Giới thiệu dự án, phím tắt và hướng dẫn cài đặt nhanh
├── cau_truc_thu_muc_qt.md      # Tài liệu này: Hướng dẫn cấu trúc và làm quen Qt6
├── huong_dan_doc_code.md       # Trình tự đọc hiểu logic code từ A-Z
├── 3rdparty/                   # Thư viện bên thứ ba (Third-party Dependencies)
│   ├── mavlink/                # Header-only C library cho giao thức bay MAVLink v2
│   └── libdatachannel/         # Thư viện C++ WebRTC (WHEP, ICE, DTLS, SRTP Decryption)
├── src/                        # Toàn bộ mã nguồn chính của ứng dụng
│   ├── main.cpp                # Điểm khởi chạy chương trình (Entrypoint - QApplication)
│   ├── api/                    # Tầng giao tiếp Web API (Authentication & Cloud REST API)
│   │   ├── AuthService.h
│   │   └── AuthService.cpp
│   ├── bridge/                 # Tầng cầu nối mạng & Điều phối MAVLink trung tâm
│   │   ├── TelemetryModel.h    # Khai báo Struct TelemetryData (GPS, Pin, Mode, Vận tốc)
│   │   ├── DroneBridgeCore.h   # Bộ não điều phối (Facade/Orchestrator)
│   │   ├── DroneBridgeCore.cpp
│   │   ├── LocalGcsServer.h    # Server TCP 5760 / UDP 14550 cho QGroundControl
│   │   ├── LocalGcsServer.cpp
│   │   ├── WebSocketClient.h   # Client Socket.IO kết nối Cloud Gateway Port 10004
│   │   └── WebSocketClient.cpp
│   ├── video/                  # Tầng xử lý truyền phát Video FPV thời gian thực
│   │   ├── VideoRelayBridge.h  # Cầu nối WebRTC WHEP (Port 10005) + DTLS + Bắn UDP 5600
│   │   └── VideoRelayBridge.cpp
│   └── ui/                     # Tầng giao diện người dùng (Qt Widgets UI)
│       ├── MainWindow.h        # Cửa sổ chính quản lý chuyển đổi màn hình (QStackedWidget)
│       ├── MainWindow.cpp
│       ├── LoginWidget.h       # Màn hình đăng nhập tài khoản phi công
│       ├── LoginWidget.cpp
│       ├── ControlWidget.h     # Màn hình điều khiển tác chiến FPV & Telemetry
│       ├── ControlWidget.cpp
│       ├── TelemetryWidget.h   # Widget hiển thị đồ họa thông số bay phụ trợ
│       ├── TelemetryWidget.cpp
│       ├── StyleHelper.h       # Bộ theme giao diện Dark Cyberpunk HUD
│       └── StyleHelper.cpp
└── tests/                      # Bộ kiểm thử tự động (Unit & Integration Tests)
    └── test_bridge_core.cpp    # Test luồng Downlink/Uplink MAVLink với LocalGcsServer
```

---

## 3. Chi tiết vai trò từng thư mục & Module

### 🔹 `/src/api` (Tầng Xác Thực & REST API)
* **Nhiệm vụ:** Thực hiện các yêu cầu HTTP/HTTPS lên NestJS Backend (Cổng `10004`):
  * Đăng nhập phi công qua `POST /api/v1/auth/login`.
  * Nhận Token JWT và lưu trữ an toàn trong RAM.
  * Tải danh mục phi đội Drone được gán cho người dùng qua `GET /api/v1/drones`.
* **Công nghệ:** Sử dụng `QNetworkAccessManager`, `QNetworkRequest`, `QJsonDocument`.

---

### 🔹 `/src/bridge` (Bộ Não Cầu Nối Mạng MAVLink)
* **`DroneBridgeCore`:** Đóng vai trò là **Facade / Orchestrator**. Kết nối và điều phối dữ liệu hai chiều giữa `WebSocketClient`, `LocalGcsServer` và `VideoRelayBridge`, theo dõi tốc độ truyền tải KB/s.
* **`LocalGcsServer`:** Mở cổng mạng nội bộ **TCP `5760`** và **UDP `14550`**. Đây là nơi phần mềm điều khiển trạm mặt đất **QGroundControl** hoặc **Mission Planner** kết nối vào để nhận dữ liệu bay và gửi lệnh điều khiển.
* **`WebSocketClient`:** Kết nối đến Socket.IO Gateway của NestJS (Cổng `10004`), tham gia phòng `/mavlink` của Drone được chọn để nhận byte MAVLink nhị phân thô và Telemetry JSON.
* **`TelemetryModel`:** Định nghĩa struct `TelemetryData` độc lập, an toàn kiểu dữ liệu.

---
### 🔹 `/src/video` (Cầu Nối Video FPV WebRTC)
* **`VideoRelayBridge`:** Chịu trách nhiệm toàn bộ đường truyền hình ảnh camera độ trễ siêu thấp (`< 30ms`):
  1. Sinh bản tin SDP Offer và thực hiện bắt tay WHEP qua Cổng `10004`.
  2. Sử dụng thư viện `libdatachannel` để tự động hóa đục lỗ ICE STUN và **DTLS 1.2 Handshake** trên Cổng `10005`.
  3. Nhận các gói tin SRTP đã được giải mã thành RTP thô.
  4. Sử dụng socket hệ điều hành native `::sendto` (Thread-safe) để bắn tức thì các gói tin H.264 sang cổng **UDP `5600`** của QGroundControl (Localhost/WSL).

### 🔹 `/src/ui` (Giao Diện Đồ Họa Qt Widgets)
* **`MainWindow`:** Cửa sổ chính điều hướng màn hình bằng `QStackedWidget` (chuyển đổi mượt mà giữa màn hình Login và màn hình Control).
* **`LoginWidget`:** Form đăng nhập hiện đại với hiệu ứng kiểm tra lỗi và nút điền nhanh tài khoản Demo.
* **`ControlWidget`:** Trung tâm điều khiển tác chiến bao gồm:
  * Thanh thông tin tài khoản phi công & Danh sách chọn Drone mục tiêu.
  * Card điều khiển Cầu nối MAVLink và Cầu nối Video FPV.
  * Thanh **Mini OSD Strip** tóm tắt nhanh chế độ bay, động cơ, pin, độ cao, vận tốc, vệ tinh.
  * Cửa sổ **Log Console** thời gian thực giúp theo dõi chi tiết từng bước bắt tay mạng.
* **`StyleHelper`:** Định nghĩa toàn bộ stylesheet (QSS), bảng màu Dark HUD cao cấp, bo góc viền và hiệu ứng Hover.

---

## 4. Mô hình phân lớp kiến trúc (Clean Desktop Architecture)

```text
┌────────────────────────────────────────────────────────────────────────┐
│                      1. TẦNG GIAO DIỆN (UI LAYER)                      │
│         [MainWindow]  ───  [ControlWidget]  ───  [LoginWidget]         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ ▲
     Gọi hàm trực tiếp (Call Down)  │ │ Bắn sự kiện (Signals / Emit)
                                    ▼ │
┌────────────────────────────────────────────────────────────────────────┐
│                   2. TẦNG ĐIỀU PHỐI (CORE FACADE LAYER)                │
│                            [DroneBridgeCore]                           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ ▲
     Điều phối & Quản lý vòng đời   │ │ Báo dữ liệu nhận (Telemetry/Packets)
                                    ▼ │
┌────────────────────────────────────────────────────────────────────────┐
│                3. TẦNG MẠNG & PROTOCOL (NETWORK LAYER)                 │
│   [LocalGcsServer]       [WebSocketClient]       [VideoRelayBridge]    │
│   (TCP 5760 cho QGC)     (Socket.IO Port 10004)  (WHEP Video Port 10005)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 4. TẦNG THƯ VIỆN CỐT LÕI (CORE LIBS)                   │
│   • MAVLink v2 C-Headers        • libdatachannel (WebRTC C++)          │
│   • OpenSSL (Crypto / TLS)      • Qt6 Network & WebSockets             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Các khái niệm cốt lõi của Qt người mới bắt buộc phải biết

### 1. Macro `Q_OBJECT`
Mọi class kế thừa từ `QObject` muốn sử dụng cơ chế Signals/Slots **bắt buộc** phải khai báo macro `Q_OBJECT` ở dòng đầu tiên:
```cpp
class VideoRelayBridge : public QObject {
    Q_OBJECT // Bắt buộc để MOC (Meta-Object Compiler) sinh mã nguồn phản xạ
public:
    explicit VideoRelayBridge(QObject *parent = nullptr);
...
```

### 2. Signals (Tín hiệu) & Slots (Hàm nhận tín hiệu)
* **Signal:** Được khai báo trong header (`signals:`), không cần viết thân hàm. Khi cần thông báo sự kiện, dùng từ khóa `emit`:
  ```cpp
  emit statsUpdated(totalBytes, packetsPerSec);
  ```
* **Slot:** Là hàm bình thường (hoặc Lambda C++11) dùng để xử lý dữ liệu khi Signal được phát ra:
  ```cpp
  connect(m_videoBridge, &VideoRelayBridge::statsUpdated, 
          this, &ControlWidget::onVideoStatsUpdated);
  ```

### 3. Quy tắc Thread trong Qt (Thread Affinity)
> [!WARNING]
> Trong Qt, **tuyệt đối không thao tác trực tiếp lên GUI Widgets từ các background thread** (như thread callback của thư viện WebRTC hay socket thread). Muốn cập nhật GUI từ background thread, luôn dùng cơ chế Signal-Slot hoặc `QMetaObject::invokeMethod(..., Qt::QueuedConnection)`.

---

## 6. Các nguyên tắc vàng khi viết code C++ Qt

1. **Luôn truyền `parent` cho `QObject` và `QWidget`:** Giúp hệ thống tự động dọn dẹp bộ nhớ theo cây phân cấp, tránh tình trạng rò rỉ RAM (Memory Leak).
2. **Ưu tiên sử dụng Lambda cho các kết nối ngắn:** Giúp code trực quan, dễ đọc ngay tại vị trí khởi tạo.
3. **Sử dụng Header Guards (`#pragma once`):** Ngăn chặn việc include trùng lặp header trong quá trình build.
4. **Tách biệt hoàn toàn UI và Network Logic:** Class UI (`ControlWidget`) không bao giờ tự mở socket mạng mà luôn ủy quyền cho tầng Core (`DroneBridgeCore`).
