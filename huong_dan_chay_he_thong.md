# HƯỚNG DẪN VẬN HÀNH & KIỂM THỬ TOÀN DIỆN HỆ THỐNG
## Core Telemetry Ingestion (Go) + WebSockets Gateway + Web SSH + Mission Control

---

## I. TỔNG QUAN KIẾN TRÚC DỰ ÁN

Dự án bao gồm 2 module dịch vụ độc lập giao tiếp qua **Redis**:

1. **`telemetry-ingestion-service/` (Golang Core):**
   - Lắng nghe gói tin UDP binary MAVLink v1/v2 từ Drone (Port `14550`).
   - Tự động bóc tách IP VPN (`10.13.37.X`) -> Tra cứu `deviceId` trong Redis `drone:ip_map`.
   - Giải mã toàn diện: Heartbeat (ArduPilot Flight Modes), GPS Global Position, Dung lượng pin, Góc nghiêng Attitude Roll/Pitch/Yaw, VFR HUD.
   - Xuất dữ liệu vào Redis Hashes (`drone:states`) và bắn sự kiện thời gian thực qua Redis Pub/Sub (`channel:drone:telemetry:all`).
   - Kèm bộ **Drone Simulator** (`cmd/simulator/main.go`) mô phỏng nhiều drone bay theo quỹ đạo thực tế.

2. **`provisioning-api/` (NestJS Business Gateway):**
   - Cung cấp API Cấp phát Zero-Touch Provisioning (Phase 1).
   - Module **Redis**: Quản lý kết nối CRUD và kênh Subscribe Pub/Sub.
   - Module **Telemetry**: WebSocket Gateway (`/`) đẩy tọa độ, trạng thái bay tới trình duyệt Web (10Hz).
   - Module **Web SSH**: Kết nối SSH2 trực tiếp vào IP VPN `10.13.37.X:22` của Drone và bắt cầu WebSocket với `xterm.js`.
   - Giao diện **Mission Control SPA Dashboard** (`public/index.html`): Bản đồ GPS vệ tinh Leaflet, Artificial Horizon HUD, Bảng quản lý đội Drone, Ma trận 254 IP, Web SSH Terminal trực quan.

---

## II. HƯỚNG DẪN CHẠY & KIỂM THỬ TRÊN MÁY TÍNH (LOCAL DEV)

### Bước 1: Khởi chạy Redis Server bằng Docker (Port 6380)
Mở Terminal gõ lệnh:
```bash
docker run -d --name drone-redis -p 6380:6379 redis:7.4-alpine
```

---

### Bước 2: Chạy Go MAVLink Ingestion Service
Mở **Terminal 1**:
```bash
cd telemetry-ingestion-service
go run ./cmd/server/main.go
```
*Dịch vụ sẽ khởi động và lắng nghe UDP tại port `14551` (Drone) và TCP port `10002` (QGroundControl).*

---

### Bước 3: Khởi chạy NestJS API Gateway & Mission Control UI
Mở **Terminal 2**:
```bash
cd provisioning-api
npm run start:dev
```
*Server sẽ mở tại `http://localhost:10004/`.*

---

### Bước 4: Chạy Drone Simulator (Mô phỏng 3-5 Drone bay thật)
Mở **Terminal 3**:
```bash
cd telemetry-ingestion-service
go run ./cmd/simulator/main.go -drones 3 -target 127.0.0.1:14551 -redis 127.0.0.1:6380
```
*Công cụ sẽ sinh ra 3 drone ảo `DRONE-SIM-0001`, `DRONE-SIM-0002`, `DRONE-SIM-0003` với GPS bay vòng tròn quanh khu vực Hà Nội, pin tụt dần, góc nghiêng Roll/Pitch thay đổi và gửi luồng Telemetry 10Hz.*

---

### Bước 5: Mở Trình Duyệt Web Trải Nghiệm
Truy cập: **`http://localhost:10004/`**

1. **Tab Bản Đồ Tác Chiến:** Xem Drone di chuyển mượt mà trên bản đồ vệ tinh tối màu, icon xoay theo hướng bay Heading, hiển thị vết bay (Flight Trail) và bảng Quick HUD bên phải. Dropdown chỉ hiển thị các Drone đang Online thực sự.
2. **Tab Đội Drone:** Xem danh sách quản trị chi tiết, nút Khóa (Revoke), Mở khóa (Reactivate) và Xóa vĩnh viễn (Delete) với thông báo tác động rõ ràng.
3. **Tab Web SSH:** Chọn Drone hoặc gõ IP để kết nối terminal Linux dòng lệnh đen bóng và bấm nút Ngắt kết nối.
4. **Tab IP Matrix:** Xem 254 ô địa chỉ IP đổi màu theo trạng thái Online/Offline thời gian thực.

---

## III. HƯỚNG DẪN CHẠY TOÀN BỘ BẰNG DOCKER COMPOSE

Trên VPS hoặc máy chủ Production:
```bash
# Khởi chạy toàn bộ hệ sinh thái (Redis + Go Ingest + NestJS API)
docker compose up -d --build

# Xem log hoạt động
docker compose logs -f
```

---

## IV. CHẠY TỰ ĐỘNG KIỂM THỬ (AUTOMATED TESTS)

1. **Kiểm tra Unit Tests Golang (100% Pass):**
   ```bash
   cd telemetry-ingestion-service
   go test -v ./...
   ```

2. **Kiểm tra Unit Tests NestJS (48/48 Tests Pass):**
   ```bash
   cd provisioning-api
   npm test
   ```
