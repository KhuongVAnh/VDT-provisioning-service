# ĐẶC TẢ KỸ THUẬT: NÂNG CẤP SBCLOUD HỖ TRỢ KẾT NỐI PHÂN QUYỀN SBSTATION (MÔ HÌNH XBLINK)

> **Tài liệu tham khảo kiến trúc & Hướng dẫn triển khai kỹ thuật**  
> **Áp dụng cho:** Hệ sinh thái Drone Cloud Telemetry (NestJS API Gateway, Golang Ingestion, Redis Pub/Sub, MediaMTX và Qt6 Pilot Bridge).

---

## 1. TỔNG QUAN VÀ MÔ HÌNH HOẠT ĐỘNG CHUẨN XBLINK

Hệ thống kết nối điều khiển phân quyền theo mô hình **XBlink 5G (XBStation / SBCloud)** được tổ chức thành 3 khối độc lập:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             1. DRONE (AIR UNIT)                                  │
│  - Pixhawk Flight Controller (ArduPilot/PX4) chạy MAVLink v2.                    │
│  - SBC Companion (Raspberry Pi/Jetson) + 4G/5G WireGuard VPN (10.13.37.X).       │
│  - Gửi Telemetry qua UDP 14551 & Stream Video Camera qua RTSP 8554.              │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            2. SBCLOUD (CLOUD BACKEND)                            │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │ A. Auth & Device Registry (NestJS + Prisma):                               │  │
│  │    - Quản lý tài khoản User (PILOT / ADMIN) & Phân quyền Drone sở hữu.     │  │
│  │    - Cấp phát JWT Access Token qua REST API.                               │  │
│  └─────────────────────────────────────┬──────────────────────────────────────┘  │
│                                        │                                         │
│  ┌─────────────────────────────────────▼──────────────────────────────────────┐  │
│  │ B. MAVLink Ingestion & Control Gateway:                                    │  │
│  │    - Go Core Ingestion: Nhận UDP từ Drone -> Bắn vào Redis Pub/Sub         │  │
│  │    - NestJS Binary WebSocket Gateway: Xác thực JWT -> Stream 2 chiều       │  │
│  └─────────────────────────────────────┬──────────────────────────────────────┘  │
│                                        │                                         │
│  ┌─────────────────────────────────────▼──────────────────────────────────────┐  │
│  │ C. MediaMTX Video Gateway (WHEP / WebRTC):                                 │  │
│  │    - Cung cấp luồng Camera trực tiếp độ trễ cực thấp (< 200ms).            │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Kênh TLS WebSocket (Binary MAVLink)
                                         │ + WebRTC Video (WHEP)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                    3. SBSTATION / PILOT BRIDGE (MÁY PHI CÔNG)                    │
│                                                                                  │
│  - Đăng nhập tài khoản phi công -> Nhận JWT Token & Danh sách Drone.            │
│  - Mở kênh WebSocket nhận MAVLink từ Cloud & mở WebRTC xem Camera.               │
│  - Mở TCP Server nội bộ tại 127.0.0.1:5760 (hoặc card mạng ảo WSL).              │
│  - Chuyển tiếp luồng MAVLink 2 chiều với QGroundControl / Mission Planner.       │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ MAVLink nội bộ (127.0.0.1:5760)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                     4. QGROUNDCONTROL / MISSION PLANNER (GỐC)                    │
│  - Kết nối TCP: 127.0.0.1:5760                                                   │
│  - Quan sát bản đồ bay, nhận HUD thời gian thực và gửi lệnh điều khiển.          │
│  - Hoàn toàn KHÔNG cần biết IP thật của VPS, không lo lộ port hay xung đột drone!│
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. HIỆN TRẠNG HỆ THỐNG VÀ KHOẢNG TRỐNG CẦN BỔ SUNG

| Thành phần | Hiện trạng trong Codebase | Khoảng trống cần nâng cấp theo chuẩn XBlink |
| :--- | :--- | :--- |
| **Cơ sở dữ liệu (Prisma)** | Đã có bảng `Device` (Provisioning, VPN IP, Public Key). | Chưa có bảng `User` và chưa có quan hệ sở hữu (`userId -> Device`). |
| **Xác thực (Auth Module)** | Chỉ có Secret Token phục vụ provisioning thiết bị xuất xưởng. | Chưa có module đăng ký, đăng nhập, JWT cấp phát cho phi công. |
| **Truyền tải MAVLink** | • Go Service mở TCP Server `10002` (công khai).<br>• NestJS phát JSON Telemetry cho Web. | Cần bổ sung **Binary WebSocket Gateway** hỗ trợ xác thực JWT và phân quyền điều khiển theo từng `deviceId`. |
| **Điều khiển Uplink (Lệnh từ GCS)** | Go service router chuyển tiếp gói tin GCS TCP xuống UDP Drone. | Cần chuyển tiếp lệnh Uplink từ WebSocket phân quyền xuống IP VPN `10.13.37.X:14550`. |
| **Video Streaming** | Đã tích hợp MediaMTX native + module `video/` qua WHEP. | Thêm kiểm tra JWT Token trước khi cho phép xem video của Drone. |

---

## 3. CHI TIẾT CÁC CẤU HÌNH & TÍNH NĂNG CẦN BỔ SUNG TRÊN CLOUD

### 3.1. Cập nhật Cơ sở dữ liệu (`prisma/schema.prisma`)

Bổ sung thực thể `User` với 2 vai trò `ADMIN` và `PILOT`, liên kết quan hệ 1-N với `Device`:

```prisma
enum Role {
  ADMIN   // Quản trị viên: toàn quyền xem và điều khiển toàn bộ phi đội
  PILOT   // Phi công: chỉ xem và điều khiển các Drone thuộc quyền sở hữu
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
  
  // Khóa ngoại liên kết người sở hữu Drone:
  userId        String?
  owner         User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  lastSeen      DateTime @default(now())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

---

### 3.2. Xây dựng Module Xác thực & REST API (`AuthModule`)

Cần bổ sung module `src/auth/` trong NestJS:

1. **`POST /api/v1/auth/register` (Tạo tài khoản phi công):**
   * **Body:** `{ "email": "pilot@gmail.com", "password": "...", "fullName": "Phi công A" }`
   * Mã hóa mật khẩu bằng `bcrypt`.

2. **`POST /api/v1/auth/login` (Đăng nhập cho SBStation / Web):**
   * **Body:** `{ "email": "pilot@gmail.com", "password": "..." }`
   * **Response:**
     ```json
     {
       "statusCode": 200,
       "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
       "user": {
         "id": "usr-uuid-1234",
         "email": "pilot@gmail.com",
         "fullName": "Phi công A",
         "role": "PILOT"
       },
       "assignedDevices": [
         {
           "deviceId": "DRONE-0001",
           "hardwareModel": "Hexacopter X6",
           "status": "ACTIVE",
           "vpnIp": "10.13.37.2"
         }
       ]
     }
     ```

3. **`GET /api/v1/user/devices` (Lấy danh sách Drone của tôi):**
   * Bảo vệ bằng `JwtAuthGuard`. Trả về danh sách Drone thuộc quyền sở hữu của `req.user.id`.

---

### 3.3. Xây dựng Gateway MAVLink Nhị phân Phân quyền (`MavlinkRelayGateway`)

Cần xây dựng một WebSocket Gateway chuyên dụng truyền tải dữ liệu nhị phân (Binary MAVLink v2) tại đường dẫn:
```text
ws://<IP_VPS>:10004/mavlink
```

#### A. Cơ chế Xác thực & Phân quyền (Handshake Auth Guard):
* Khi Client (SBStation / Pilot Bridge) kết nối, Client gửi thông số xác thực qua Query Parameters hoặc Headers:
  ```text
  ws://<IP_VPS>:10004/mavlink?token=<JWT_ACCESS_TOKEN>&droneId=DRONE-0001
  ```
* Gateway thực hiện:
  1. Giải mã JWT lấy `userId` và `role`.
  2. Kiểm tra DB: nếu `role != ADMIN`, kiểm tra xem `Device.deviceId = 'DRONE-0001'` có `userId = req.user.id` hay không.
  3. **Nếu không khớp: Ngắt kết nối ngay (HTTP 403 Forbidden).**

#### B. Chiều Downlink (Drone $\rightarrow$ Cloud $\rightarrow$ SBStation):
1. Dịch vụ Go Ingestion khi nhận UDP từ Drone `DRONE-0001` sẽ xuất bản (publish) toàn bộ byte thô vào Redis Pub/Sub:
   * **Kênh Redis:** `drone:raw:stream:DRONE-0001`
2. NestJS Gateway lắng nghe kênh Redis trên và bắn thẳng gói tin nhị phân (`Buffer`) tới WebSocket của client SBStation tương ứng.

#### C. Chiều Uplink (QGroundControl $\rightarrow$ SBStation $\rightarrow$ Cloud $\rightarrow$ Drone):
1. Phi công gửi lệnh từ QGroundControl (Arm, Disarm, Bay tự động, Upload Waypoints) $\rightarrow$ SBStation chuyển tiếp byte nhị phân lên WebSocket.
2. Gateway nhận byte nhị phân từ WebSocket $\rightarrow$ Tra cứu địa chỉ VPN IP của Drone (`10.13.37.X`) $\rightarrow$ Gửi UDP socket tới `10.13.37.X:14550` (cổng lắng nghe của MAVLink router / MAVProxy trên Companion SBC của Drone).

---

### 3.4. Bảo mật Kênh Video WebRTC (WHEP Token Guard)

* Kênh Video WHEP tại `/api/v1/video/:deviceId/whep`:
* Kiểm tra `Bearer JWT Token` trước khi tạo phiên WebRTC SDP Offer/Answer với MediaMTX nội bộ.
* Đảm bảo phi công chỉ xem được camera của đúng Drone mình sở hữu.

---

## 4. BẢNG TỔNG HỢP CÁC BIẾN MÔI TRƯỜNG CLOUD CẦN THIẾT

Cập nhật trong file `.env` của hệ thống:

```ini
# === CẤU HÌNH JWT AUTH ===
JWT_SECRET="ANTIGRAVITY_PILOT_SECRET_KEY_2026"
JWT_EXPIRES_IN="7d"

# === CẤU HÌNH CỔNG DỊCH VỤ ===
PORT=10004
VPS_PUBLIC_IP="103.253.20.32"

# === REDIS PUBSUB CHO STREAM MAVLINK RAW ===
REDIS_ADDR="127.0.0.1:6380"
REDIS_RAW_STREAM_PREFIX="drone:raw:stream:"

# === MẠNG VPN NỘI BỘ DRONE ===
VPN_SUBNET_PREFIX="10.13.37."
DRONE_UPLINK_UDP_PORT=14550
```

---

## 5. LỘ TRÌNH TRIỂN KHAI THEO GIAI ĐOẠN

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ GIAI ĐOẠN 1: AUTHENTICATION & DATABASE SCHEMA (NestJS + Prisma)             │
│  [x] Viết Schema User & Device ownership.                                   │
│  [ ] Triển khai AuthService, JwtStrategy, Password hashing.                │
│  [ ] Cung cấp REST API Login/Register & Quản lý danh sách Drone cá nhân.    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ GIAI ĐOẠN 2: BINARY MAVLINK RELAY GATEWAY (NestJS + Go + Redis Pub/Sub)     │
│  [x] Go Ingestion xuất bản raw MAVLink byte thô vào channel:drone:raw:*     │
│  [x] Xây dựng MavlinkRelayGateway trên NestJS (namespace /mavlink).         │
│  [x] Lắng nghe Redis Pub/Sub đẩy byte MAVLink Downlink theo Device ID.      │
│  [x] Triển khai UDP Socket chuyển tiếp lệnh Uplink xuống 10.13.37.X:14550.   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ GIAI ĐOẠN 3: NÂNG CẤP GIAO DIỆN PILOT BRIDGE (Qt6 C++)                      │
│  [x] Đã hoàn thiện Core TCP Server cho QGroundControl (127.0.0.1:5760).     │
│  [ ] Bổ sung kết nối WebSocket namespace /mavlink?droneId=... vào Pilot.    │
│  [ ] Thêm Form Đăng nhập Email/Password trên màn hình App Qt.               │
│  [ ] Tự động lấy danh sách Drone sau đăng nhập vào ComboBox.                │
│  [ ] Tích hợp Player Video WebRTC (GStreamer/FFmpeg) trực tiếp trên App.    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. KẾT LUẬN

Khi hoàn thiện các cấu hình trên:
1. **Phía Server (Cloud):** Đạt tiêu chuẩn phân quyền công nghiệp tương đương **SBCloud / XBStation**, bảo vệ tuyệt đối an toàn bay và cách ly hoàn toàn giữa các khách hàng / phi công.
2. **Phía Khách hàng (Phi công):** Trải nghiệm đơn giản, mượt mà: Chỉ cần mở App Pilot Bridge $\rightarrow$ Đăng nhập $\rightarrow$ Bật QGroundControl bay ngay mà không cần cấu hình mạng phức tạp.
