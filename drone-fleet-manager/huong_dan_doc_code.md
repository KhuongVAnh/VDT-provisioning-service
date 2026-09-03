# Hướng Dẫn Đọc Mã Nguồn (Code Tour)
## Hệ Thống Device Provisioning API, Telemetry Gateway & Mission Control

Tài liệu này sẽ hướng dẫn bạn cách đọc và hiểu mã nguồn của toàn bộ dự án theo một **trình tự logic nhất**, từ lúc hệ thống khởi chạy, tiếp nhận request cấp phát Drone, cho đến việc xử lý dữ liệu Telemetry MAVLink, Video Streaming độ trễ thấp và Web-SSH Terminal từ xa.

---

## 🗺️ Bản Đồ Kiến Trúc Hệ Thống

```
                                  [Drone 4G/5G Flight System]
                                               │
             ┌─────────────────────────────────┼─────────────────────────────────┐
             │ (1) Provisioning API            │ (2) Telemetry MAVLink           │ (3) RTSP/SRT Video
             ▼                                 ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────┐       ┌─────────────────────────┐
│ NestJS Provisioning API │       │ Go Ingestion Service    │       │ MediaMTX Video Server   │
│ (Port 10004 - Auth/DB)  │       │ (Port 14551 UDP / GCS)  │       │ (10.13.37.1:8554 VPN)   │
└───────────┬─────────────┘       └────────────┬────────────┘       └────────────┬────────────┘
            │                                  │                                 │
            │ WireGuard Peer Config            │ Pub/Sub `drone:telemetry:*`     │ WHEP/HLS Internal
            ▼                                  ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                       NESTJS GATEWAY & MISSION CONTROL PLATFORM                             │
│                         (Lắng nghe DUY NHẤT Port 10004 qua Internet)                        │
│                                                                                             │
│  • Provisioning (Auth/IP)   • Telemetry Gateway (WS)   • Web-SSH (xterm)   • Video Proxy    │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ HTTP / WebSockets / WHEP
                                               ▼
                              [Web Dashboard & Ground Station (QGC)]
```

---

## 📖 Trình Tự Đọc Khuyến Nghị (10 Bước)

### Bước 1: Điểm neo đầu tiên (Điểm khởi chạy ứng dụng)
Khi server bật lên, nó bắt đầu chạy từ đâu?
* 👉 **Mở file:** `src/main.ts`
* **Tác dụng:** "Cửa ngõ" khởi chạy toàn bộ server NestJS. 
  - Lắng nghe trên cổng duy nhất **10004**.
  - Cấu hình `ValidationPipe` toàn cục (chặn request rác, validate schema).
  - Bật CORS cho phép Web Dashboard kết nối.
  - Phục vụ Single-Page Application (SPA) từ thư mục `public/` qua `app.useStaticAssets`.

---

### Bước 2: Bảng mạch liên kết trung tâm (App Module)
Khung xương ghép nối tất cả các phân hệ của dự án:
* 👉 **Mở file:** `src/app.module.ts`
* **Tác dụng:** Đăng ký và nạp 10 Module chức năng:
  1. `ConfigModule`: Đọc biến môi trường `.env`.
  2. `PrismaModule`: Kết nối CSDL SQLite / LibSQL.
  3. `RedisModule`: Kết nối Redis Server (Hashes & Pub/Sub).
  4. `DeviceModule`: Quản lý thực thể và trạng thái Drone.
  5. `IpPoolModule`: Thuật toán quản lý và cấp phát IP VPN.
  6. `WireguardModule`: Giao tiếp Linux Kernel điều khiển VPN.
  7. `ProvisioningModule`: Cấp phát tự động Zero-Touch Provisioning (Phase 1).
  8. `DashboardModule`: Thống kê KPI, quản lý đội Drone và ma trận IP.
  9. `TelemetryModule`: Tiếp nhận luồng MAVLink và bắn WebSocket thời gian thực (Phase 2).
  10. `WebSshModule`: Terminal SSH trực tiếp từ trình duyệt tới Drone (Phase 4).
  11. `VideoModule`: Video Gateway proxy WebRTC WHEP / HLS qua cổng 10004 (Phase 3).

---

### Bước 3: Tầng Hạ Tầng Cơ Sở & Dịch Vụ Phụ Trợ (Core Services)
Trước khi đọc logic nghiệp vụ, hãy hiểu các công cụ nền tảng:
* 👉 **Mở file:** `src/prisma/prisma.service.ts`
  * *Tác dụng:* Quản lý kết nối Database SQLite thông qua Prisma ORM.
* 👉 **Mở file:** `src/redis/redis.service.ts`
  * *Tác dụng:* Quản lý 2 kết nối Redis riêng biệt: 1 client thường cho Hashes/Cache và 1 subscriber chuyên dụng cho kênh Pub/Sub.
* 👉 **Mở file:** `src/ip-pool/ip-pool.service.ts`
  * *Tác dụng:* Thuật toán cấp phát IP thông minh: Tự động quét và tìm IP nhỏ nhất còn trống trong dải `10.13.37.2` – `10.13.37.254`, tính toán tỷ lệ lấp đầy của Pool.
* 👉 **Mở file:** `src/wireguard/wireguard.service.ts`
  * *Tác dụng:* Giao tiếp trực tiếp với Linux Kernel: Sinh keypair WireGuard (`wg genkey`), nạp/xóa peer (`wg set wg0 peer ...`), và bóc tách dữ liệu thống kê từ lệnh `wg show wg0 dump`.

---

### Bước 4: Module Quản Lý Thiết Bị (Device Module)
Nơi quản lý dữ liệu và vòng đời thực thể Drone:
* 👉 **Mở file:** `src/device/device.service.ts`
* **Tác dụng:** Đóng gói toàn bộ thao tác CRUD với bảng `Device`: Tìm kiếm thiết bị, tạo mới, cập nhật Public Key (Key Rotation), khóa thiết bị (`revokeDevice`), mở khóa (`reActivateDevice`), xóa vĩnh viễn và giải phóng IP an toàn.

---

### Bước 5: Module Cấp Phát Tự Động (Trái tim của dự án - Provisioning Module)
Luồng chính khi Drone lần đầu khởi động hoặc cài đặt lại:
* 👉 **Mở file:** `src/provisioning/provisioning.controller.ts`
  * *Tác dụng:* Khai báo endpoint `POST /api/v1/provisioning/register`.
* 👉 **Mở file:** `src/provisioning/dto/register-device.dto.ts`
  * *Tác dụng:* Chặn request thiếu `deviceId`, `provisionToken` hoặc sai định dạng.
* 👉 **Mở file:** `src/provisioning/provisioning.service.ts`
  * *Tác dụng:* **Logic cấp phát Zero-Touch 4 bước:**
    1. Xác thực token an toàn bằng thuật toán chống tấn công thời gian (`crypto.timingSafeEqual`).
    2. Nếu Drone đã tồn tại: Thực hiện **Key Rotation** (cấp lại cấu hình VPN với Private Key mới).
    3. Nếu Drone mới: Tự động cấp IP nhỏ nhất $\rightarrow$ sinh cặp khóa WireGuard $\rightarrow$ nạp Peer vào Linux Kernel $\rightarrow$ lưu CSDL.
    4. Tự động khôi phục toàn bộ Peer vào Kernel khi server khởi động (`onModuleInit`).

---

### Bước 6: Module Telemetry Stream & WebSocket Gateway (Telemetry Module)
Cách hệ thống truyền dữ liệu bay MAVLink độ trễ < 100ms lên Web Dashboard:
* 👉 **Mở file:** `src/telemetry/telemetry.service.ts`
  * *Tác dụng:* Đăng ký (Subscribe) kênh Redis Pub/Sub `channel:drone:telemetry:all` từ Go Ingestion Service đẩy sang; duy trì bộ nhớ đệm RAM và chuẩn hóa dữ liệu bay.
* 👉 **Mở file:** `src/telemetry/telemetry.gateway.ts`
  * *Tác dụng:* WebSocket Gateway: Quản lý Client kết nối và đăng ký phòng `drone:<deviceId>`, phát dữ liệu bay thời gian thực xuống trình duyệt.
* 👉 **Mở file:** `src/telemetry/telemetry.controller.ts`
  * *Tác dụng:* Cung cấp REST API lấy nhanh snapshot dữ liệu bay hiện tại của Drone.

---

### Bước 7: Module Video Gateway Tập Trung (Video Module)
Giải pháp truyền hình ảnh Ultra-Low Latency (< 200ms) qua cổng duy nhất 10004:
* 👉 **Mở file:** `src/video/video.controller.ts`
  * *Tác dụng:* Cung cấp các endpoint:
    - `GET /api/v1/video/:deviceId/stream-info`: Lấy thông tin các luồng.
    - `POST/PATCH/DELETE /api/v1/video/:deviceId/whep`: Proxy bắt tay SDP WebRTC WHEP.
    - `GET /api/v1/video/:deviceId/index.m3u8`: Proxy luồng HLS cho thiết bị di động.
* 👉 **Mở file:** `src/video/video.service.ts`
  * *Tác dụng:* Chuyển tiếp (Reverse Proxy) yêu cầu WHEP/HLS sang MediaMTX nội bộ (`127.0.0.1:8889` / `8888`), đảm bảo **không mở cổng thô ra Internet**.
* 👉 **Mở file:** `src/video/video.gateway.ts`
  * *Tác dụng:* WebSocket hỗ trợ theo dõi trạng thái luồng video theo từng Drone.

---

### Bước 8: Module Web-Based SSH Terminal (Web-SSH Module)
Mở dòng lệnh trực tiếp vào Drone từ trình duyệt Web không cần mở cổng 22 ra Internet:
* 👉 **Mở file:** `src/web-ssh/web-ssh.service.ts`
  * *Tác dụng:* Sử dụng thư viện `ssh2` để mở kết nối SSH bảo mật vào thẳng địa chỉ IP VPN `10.13.37.X:22` của Drone, khởi tạo Pseudo-Terminal (PTY) `xterm-256color`.
* 👉 **Mở file:** `src/web-ssh/web-ssh.gateway.ts`
  * *Tác dụng:* WebSocket kết nối với thư viện `xterm.js` trên Web, truyền nhận phím bấm và kết quả dòng lệnh hai chiều thời gian thực.

---

### Bước 9: Module Dashboard Quản Trị & Mission Control (Dashboard Module)
Tổng hợp toàn bộ sức mạnh hệ thống phục vụ giao diện người dùng:
* 👉 **Mở file:** `src/dashboard/dashboard.service.ts`
  * *Tác dụng:* Tổng hợp số liệu KPI, tính toán trực tiếp lưu lượng mạng thực tế (Rx/Tx bytes), trạng thái Online (dựa vào WireGuard Handshake), sinh ma trận 254 ô địa chỉ IP Pool, xử lý Khóa/Mở Khóa/Xóa thiết bị.
* 👉 **Mở file:** `src/dashboard/dashboard.controller.ts`
  * *Tác dụng:* REST API phục vụ UI: `/api/v1/dashboard/stats`, `/api/v1/dashboard/devices`, `/api/v1/dashboard/ip-pool`.

---

### Bước 10: Giao Diện Web SPA & Phía Drone Companion Computer
* 👉 **Mở file:** `public/index.html`
  * *Tác dụng:* Giao diện Single-Page Application chuẩn Dark Mode tích hợp đầy đủ:
    - **Bản đồ vệ tinh GPS thời gian thực (Leaflet)** theo dõi quỹ đạo bay.
    - **Đồng hồ đo góc nghiêng HUD (Artificial Horizon)** hiển thị Roll/Pitch/Yaw.
    - **Trình phát Video WebRTC WHEP / HLS** độ trễ cực thấp (< 200ms).
    - **Cửa sổ Web Terminal SSH (xterm.js)** thao tác trực tiếp trên Drone.
    - **Ma trận 254 ô IP Pool** trực quan và biểu đồ băng thông thời gian thực.
* 👉 **Mở file:** `scripts/onboard-agent.sh`
  * *Tác dụng:* Script chạy trên Raspberry Pi: Quét phần cứng, gọi API cấp phát, nhận cấu hình WireGuard và tự động kết nối VPN an toàn.
* 👉 **Mở file:** `scripts/drone_stream_adaptive.sh`
  * *Tác dụng:* Script nén và truyền Video H.264 phần cứng (V4L2/GStreamer), tích hợp cơ chế **Dynamic Adaptive Bitrate 4 tầng** tự động điều chỉnh theo chất lượng sóng 4G/5G.
* 👉 **Mở thư mục:** `../telemetry-ingestion-service/`
  * *Tác dụng:* Microservice viết bằng **Golang** siêu nhẹ, tiếp nhận MAVLink qua UDP (cổng 14551), định tuyến sang QGroundControl (cổng 10002) và đẩy Telemetry vào Redis Pub/Sub.

---

## 🧪 Kiểm Thử Tự Động (Unit Testing)
Mỗi module đều đi kèm file kiểm thử tự động `*.spec.ts`. Bạn có thể chạy kiểm tra độ ổn định của toàn bộ hệ thống bằng lệnh:
```bash
npm test
```
Hoặc kiểm tra độ bao phủ mã nguồn (Coverage):
```bash
npm run test:cov
```

