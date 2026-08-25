# 🚁 Pilot Bridge (Qt6 C++)

Ứng dụng Cầu nối Phân quyền Dữ liệu Bay & Video FPV (Pilot Telemetry & Video Bridge) cho trạm điều khiển mặt đất **QGroundControl** (QGC) và **Mission Planner**, được xây dựng theo mô hình kiến trúc chuẩn **XBlink 5G / SBStation**.

---

## 🌟 Tính Năng Cốt Lõi

1. **🔐 1. Màn Hình Đăng Nhập & Xác Thực (Login Screen):**
   * Đăng nhập tài khoản phi công qua REST API `POST /api/v1/auth/login` của Cloud.
   * Nhận **JWT Access Token** và tự động tải danh sách Drone thuộc quyền sở hữu của tài khoản (`assignedDevices`).
   * Hỗ trợ nút điền nhanh tài khoản Admin / Pilot Demo.

2. **📡 2. Cầu Nối MAVLink Telemetry & Lệnh Bay 2 Chiều (MAVLink Relay):**
   * Mở **TCP Server nội bộ tại `127.0.0.1:5760`** cho QGroundControl.
   * Kết nối **Binary WebSocket `/mavlink?token=...&droneId=...`** tới Cloud Gateway.
   * Chuyển tiếp 2 chiều:
     * *Downlink:* Nhận MAVLink v2 từ Cloud $\rightarrow$ Ghi vào `127.0.0.1:5760`.
     * *Uplink:* Nhận lệnh bay từ QGroundControl $\rightarrow$ Đẩy lên Cloud $\rightarrow$ Bắn UDP xuống Drone (`10.13.37.X:14550`).

3. **🎥 3. Cầu Nối Video FPV Stream Siêu Tốc (WHEP $\rightarrow$ UDP QGC Relay):**
   * Bắt tay **WebRTC WHEP (Port 10004)** có xác thực JWT Token với Cloud.
   * Tiếp nhận các gói tin Video **RTP H.264** độ trễ siêu tốc `< 30ms`.
   * Chuyển tiếp trực tiếp bằng UDP socket vào **`127.0.0.1:5600`** (cổng nhận Video chuẩn của QGroundControl).
   * **Zero-Transcoding:** Không tiêu tốn CPU máy tính, QGC tự động giải mã GPU và hiển thị video FPV trực tiếp trên bản đồ bay!

4. **📟 4. Màn Hình Debug & Nhật Ký Tiến Trình Thời Gian Thực (Process Console):**
   * Theo dõi từng bước bắt tay: HTTP Login, WebSocket Connect, Video WHEP Handshake, QGC Connect/Disconnect.
   * Báo cáo lưu lượng byte truyền nhận (Throughput TX/RX, Packets/s).
   * Hỗ trợ nút Sao chép Log và Xóa nhật ký.

---

## 🚀 Hướng Dẫn Biên Dịch & Khởi Chạy

### Cách 1: Chạy nhanh bằng script (Khuyên dùng)
```bash
cd pilot-bridge
./build_and_run.sh
```

### Cách 2: Biên dịch thủ công với CMake & Ninja
```bash
cd pilot-bridge
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)

# Khởi chạy ứng dụng
./build/pilot_bridge
```

---

## 🧭 Hướng Dẫn Kết Nối Với QGroundControl

1. **Khởi chạy ứng dụng `pilot_bridge`:**
   * Nhập URL Server (ví dụ `http://103.253.20.32:10004`), Email và Mật khẩu $\rightarrow$ Bấm **Đăng nhập**.
   * Chọn con Drone muốn điều khiển từ danh sách.
   * Bấm **▶ BẬT CẦU NỐI MAVLINK** và **▶ BẬT VIDEO FPV FORWARD**.

2. **Mở QGroundControl:**
   * **Cài đặt Telemetry Bay:**
     * Vào *Application Settings* ➔ *Comm Links* ➔ *Add*:
     * **Type:** `TCP` | **Server Address:** `127.0.0.1` | **Port:** `5760` $\rightarrow$ Bấm **Connect**.
   * **Cài đặt Video FPV:**
     * Vào *Application Settings* ➔ *Video*:
     * **Video Source:** `UDP h.264 Video Stream` | **UDP Port:** `5600`.

3. **Kết quả:**
   * QGroundControl tự động nhận toàn bộ dữ liệu bay thời gian thực và hiển thị luồng Camera FPV trực tiếp trên màn hình!

---

## 📁 Cấu Trúc Mã Nguồn

```
pilot-bridge/
├── CMakeLists.txt              # Cấu hình dự án Qt6 C++
├── build_and_run.sh            # Script biên dịch & chạy nhanh
├── README.md                   # Hướng dẫn sử dụng
├── 3rdparty/
│   └── mavlink/                # Header MAVLink v2 chính thức (C-library)
└── src/
    ├── main.cpp                # Điểm khởi chạy Qt Application
    ├── api/
    │   ├── AuthService.h       # Module xác thực REST API (POST /auth/login)
    │   └── AuthService.cpp
    ├── video/
    │   ├── VideoRelayBridge.h  # Cầu nối Video WHEP -> UDP 127.0.0.1:5600
    │   └── VideoRelayBridge.cpp
    ├── bridge/
    │   ├── LocalGcsServer.h    # TCP Server 127.0.0.1:5760 cho QGroundControl
    │   ├── LocalGcsServer.cpp
    │   ├── WebSocketClient.h   # Socket.IO v4 Binary Client (/mavlink)
    │   ├── WebSocketClient.cpp
    │   ├── DroneBridgeCore.h   # Bộ điều phối trung tâm
    │   └── DroneBridgeCore.cpp
    ├── simulator/
    │   ├── DroneSimulator.h    # Bộ sinh telemetry MAVLink v2
    │   └── DroneSimulator.cpp
    └── ui/
        ├── StyleHelper.h       # Theme Dark Mode QSS hiện đại
        ├── StyleHelper.cpp
        ├── LoginWidget.h       # Màn hình 1: Đăng nhập & Xác thực
        ├── LoginWidget.cpp
        ├── ControlWidget.h     # Màn hình 2: Điều khiển, Bật/Tắt Relay & Debug Log
        ├── ControlWidget.cpp
        ├── MainWindow.h        # Container QStackedWidget
        └── MainWindow.cpp
```
