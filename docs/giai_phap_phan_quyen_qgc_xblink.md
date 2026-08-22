# KIẾN TRÚC PHÂN QUYỀN VÀ ĐIỀU KHIỂN DRONE QUA QGROUNDCONTROL (MÔ HÌNH XBLINK 5G)

Tài liệu này lưu trữ chi tiết **Giải pháp kỹ thuật chuẩn công nghiệp** (tham khảo từ kiến trúc thương mại của **XBlink 5G / XBStation**) để phân quyền người dùng và cách ly điều khiển qua QGroundControl / Mission Planner cho hệ thống Cloud Telemetry.

---

## 1. Vấn đề cốt lõi & Mục tiêu

### Vấn đề:
* **QGroundControl (QGC)** và **Mission Planner (MP)** là các trạm điều khiển mặt đất (GCS) mã nguồn mở tiêu chuẩn. Giao thức MAVLink qua TCP/UDP **không hỗ trợ cơ chế xác thực danh tính (JWT/Auth)**.
* Nếu Cloud mở một cổng TCP/UDP chung (ví dụ `0.0.0.0:10002`), bất kỳ ai kết nối vào đều sẽ **nhìn thấy tất cả Drone của tất cả người dùng khác**, đồng thời có nguy cơ gửi nhầm lệnh can thiệp và cướp quyền điều khiển.

### Mục tiêu:
* Người dùng đăng ký/đăng nhập tài khoản cá nhân.
* **Chỉ xem và điều khiển đúng các Drone thuộc quyền sở hữu của mình.**
* Không cần chỉnh sửa mã nguồn của QGroundControl (sử dụng bản QGC gốc của ArduPilot/PX4).

---

## 2. Kiến trúc tổng thể (Mô hình Pilot Bridge)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             DRONE FLIGHT SYSTEM                                  │
│  [Pixhawk / ArduPilot] ──(UART Telem)──► [Companion PC + 4G/5G WireGuard VPN]    │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ UDP MAVLink (10.13.37.X)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             CLOUD BACKEND PLATFORM                               │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │ 1. Telemetry Ingestion Engine (Golang Core)                              │   │
│   │    - Nhận MAVLink từ IP VPN 10.13.37.X -> Bóc tách Telemetry             │   │
│   │    - Bắn stream dữ liệu thô vào kênh Redis Pub/Sub: `drone:stream:<devId>`│   │
│   └────────────────────────────────────┬─────────────────────────────────────┘   │
│                                        │                                         │
│   ┌────────────────────────────────────▼─────────────────────────────────────┐   │
│   │ 2. API & Control Gateway (NestJS + WebSockets)                           │   │
│   │    - Xác thực JWT Token của User.                                        │   │
│   │    - Kiểm tra quyền sở hữu: User A chỉ được subscribe `drone:DRONE_A`.   │   │
│   │    - Nhận lệnh điều khiển MAVLink từ User A -> Chuyển tiếp xuống Drone A.│   │
│   └────────────────────────────────────┬─────────────────────────────────────┘   │
└────────────────────────────────────────┼─────────────────────────────────────────┘
                                         │ Kênh bảo mật WebSocket / TLS (Kèm JWT)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                       GROUND STATION (MÁY TÍNH PHI CÔNG)                         │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │ 3. Pilot Bridge Client (`drone-pilot-bridge.exe`)                        │   │
│   │    - Phi công đăng nhập Email/Password.                                  │   │
│   │    - Nhận stream MAVLink của Drone từ Cloud -> Bắn vào 127.0.0.1:5760    │   │
│   │    - Nhận lệnh từ 127.0.0.1:5760 -> Bắn ngược lên Cloud.                 │   │
│   └────────────────────────────────────┬─────────────────────────────────────┘   │
│                                        │ TCP/UDP MAVLink (Mạng nội bộ Localhost) │
│                                        ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │ 4. QGroundControl / Mission Planner (Gốc)                                │   │
│   │    - Kết nối Comm Links: TCP Server Address: 127.0.0.1, Port: 5760       │   │
│   │    - Chỉ hiển thị và điều khiển duy nhất Drone của phi công!             │   │
│   └──────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Thiết kế chi tiết từng thành phần

### 3.1. Thiết kế Cơ sở dữ liệu (Prisma Schema)

Cập nhật `schema.prisma` để thêm thực thể `User` và quan hệ sở hữu `Device`:

```prisma
enum Role {
  ADMIN   // Xem và điều khiển toàn bộ phi đội
  PILOT   // Chỉ xem và điều khiển drone của chính mình
}

model User {
  id           String    @id @default(uuid())
  email        String    @unique
  passwordHash String
  fullName     String?
  role         Role      @default(PILOT)
  devices      Device[]  // Danh sách Drone do User sở hữu
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}

model Device {
  id            String   @id @default(uuid())
  deviceId      String   @unique
  hardwareModel String
  vpnIp         String?  @unique
  vpnPublicKey  String
  status        String   @default("PENDING") // PENDING, ACTIVE, REVOKED
  
  // Khóa ngoại liên kết người sở hữu
  userId        String?
  owner         User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  lastSeen      DateTime @default(now())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

---

### 3.2. Thiết kế Gateway phân quyền trên Cloud (NestJS / Go)

1. **Xác thực kết nối (Authentication):**
   * Client kết nối WebSocket gửi kèm header: `Authorization: Bearer <JWT_ACCESS_TOKEN>`.
   * Gateway giải mã JWT để lấy `userId`.

2. **Kiểm tra quyền sở hữu (Authorization Check):**
   * Khi Client yêu cầu mở luồng MAVLink cho `deviceId`:
     * Gateway truy vấn DB: `SELECT id FROM Device WHERE deviceId = :deviceId AND userId = :userId`.
     * Nếu không khớp: **Từ chối kết nối ngay lập tức.**

3. **Điều hướng dữ liệu 2 chiều (Bidirectional Proxying):**
   * **Chiều Downlink (Drone $\rightarrow$ QGC):**
     * Drone gửi MAVLink lên Ingestion Service $\rightarrow$ Đẩy vào Redis $\rightarrow$ Gateway bắn qua WebSocket cho `drone-pilot-bridge`.
   * **Chiều Uplink (QGC $\rightarrow$ Drone):**
     * Lệnh điều khiển (Arm, Disarm, Takeoff, Giao nhiệm vụ Waypoints) từ QGC gửi lên WebSocket $\rightarrow$ Gateway chuyển tiếp trực tiếp tới địa chỉ IP VPN của Drone (`10.13.37.X:14550`).

---

### 3.3. Thiết kế Ứng dụng Client Proxy (`drone-pilot-bridge`)

Ứng dụng nhẹ (viết bằng Go hoặc Electron), đóng gói thành 1 file chạy duy nhất (`drone-pilot-bridge.exe`):

#### Luồng hoạt động:
1. Người dùng chạy chương trình và nhập thông tin đăng nhập:
   ```bash
   drone-pilot-bridge.exe --server="https://cloud.mydrone.com" --email="pilot@gmail.com" --password="secretpassword"
   ```
2. Ứng dụng gọi REST API `POST /api/v1/auth/login` để lấy JWT Token và danh sách các Drone của tài khoản.
3. Ứng dụng kết nối WebSocket tới Server kèm JWT Token và gửi yêu cầu kết nối tới Drone được chọn.
4. Mở một **TCP Server tại `127.0.0.1:5760`** trên máy tính cá nhân.
5. Thực hiện làm cầu nối 2 chiều:
   * Mọi byte dữ liệu từ WebSocket $\rightarrow$ Ghi vào `127.0.0.1:5760`.
   * Mọi byte dữ liệu nhận từ `127.0.0.1:5760` (từ QGC) $\rightarrow$ Gửi lên WebSocket.

---

## 4. Hướng dẫn sử dụng cho Phi công (End-User Guide)

1. **Bước 1:** Mở ứng dụng `drone-pilot-bridge.exe` và đăng nhập tài khoản.
2. **Bước 2:** Chọn con Drone muốn điều khiển (ví dụ `DRONE-001`), ứng dụng thông báo:
   ```text
   [INFO] Đã kết nối thành công tới DRONE-001!
   [INFO] MAVLink TCP Server sẵn sàng tại: 127.0.0.1:5760
   ```
3. **Bước 3:** Mở **QGroundControl**:
   * Vào **Application Settings** $\rightarrow$ **Comm Links**.
   * Bấm **Add** để thêm kết nối mới:
     * **Type:** `TCP`
     * **Server Address:** `127.0.0.1`
     * **Port:** `5760`
   * Bấm **Connect**.
4. **Kết quả:** QGroundControl kết nối thành công, nhận toàn bộ thông số bay, bản đồ, HUD và có thể điều khiển bay hoàn toàn bình thường.

---

## 5. Lộ trình Triển khai (Step-by-Step Implementation Roadmap)

| Giai đoạn | Nội dung công việc | Công nghệ |
| :--- | :--- | :--- |
| **Giai đoạn 1: Auth & Database** | 1. Cập nhật `schema.prisma` thêm Model `User`.<br>2. Xây dựng `AuthModule` (Register, Login, JWT, Refresh Token).<br>3. Bảo vệ các REST API theo `userId`. | NestJS, Prisma, JWT, Bcrypt |
| **Giai đoạn 2: Control Relay Gateway** | 1. Xây dựng WebSocket Gateway truyền tải gói MAVLink nhị phân (Binary Stream).<br>2. Xác thực JWT lúc bắt tay Socket.IO.<br>3. Viết module chuyển tiếp lệnh Uplink xuống VPN IP của Drone. | NestJS / Go, Redis Pub/Sub, Gomavlib |
| **Giai đoạn 3: Xây dựng Pilot Bridge** | 1. Viết mã nguồn ứng dụng `drone-pilot-bridge` bằng Golang.<br>2. Tích hợp thư viện Socket.IO Client và TCP Server nội bộ.<br>3. Build ra file chạy `.exe` cho Windows và binary cho Linux/macOS. | Golang (Cobra CLI / Fyne GUI) |
| **Giai đoạn 4: Kiểm thử E2E** | 1. Chạy 2 Drone giả lập với 2 System ID khác nhau.<br>2. Tạo 2 tài khoản User A và User B.<br>3. Bật 2 QGroundControl trên 2 máy khác nhau và kiểm tra tính cách ly 100%. | QGroundControl, SITL Simulator |
