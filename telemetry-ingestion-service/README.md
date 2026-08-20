# Dịch Vụ Thu Thập & Giải Mã MAVLink Telemetry (Go Ingestion Service)

Dịch vụ lõi hiệu năng cao (Core Ingestion Worker) được viết bằng **Golang**, chịu trách nhiệm tiếp nhận luồng dữ liệu nhị phân MAVLink v1/v2 từ toàn bộ phi đội Drone thông qua mạng VPN WireGuard, giải mã thành JSON chuẩn và đẩy tức thời vào **Redis (Hashes & Pub/Sub)**.

---

## 1. Tính Năng Nổi Bật

1. **Hiệu năng xử lý cực cao:** Lắng nghe UDP socket non-blocking, giải mã hàng chục nghìn gói tin MAVLink/giây với độ trễ < 2ms và mức tiêu thụ RAM < 25MB.
2. **Bộ giải mã MAVLink ArduPilot toàn diện:**
   - `HEARTBEAT` (#0): Nhận diện trạng thái Armed, System Status và Chế độ bay ArduPilot (STABILIZE, LOITER, GUIDED, AUTO, RTL...).
   - `GLOBAL_POSITION_INT` (#33): Tọa độ GPS vĩ độ/kinh độ, độ cao tương đối/MSL, hướng bay Heading và vận tốc mặt đất GroundSpeed.
   - `SYS_STATUS` (#1): Dung lượng pin %, điện áp Voltage (mV) và dòng điện Current (cA).
   - `ATTITUDE` (#30): Góc nghiêng 3 chiều Roll, Pitch, Yaw của phi cơ.
   - `VFR_HUD` (#74): Tốc độ gió Airspeed, tốc độ nâng hạ Climb rate và mức ga Throttle.
   - `GPS_RAW_INT` (#24): Trạng thái khóa vệ tinh (Fix 3D/RTK) và số lượng vệ tinh.
3. **Cơ chế Ánh xạ IP Thông minh (2-Layer IP Resolver):**
   - Tự động bóc tách IP VPN người gửi `10.13.37.X` từ gói tin UDP.
   - Tra cứu trong RAM cache (tốc độ nano-giây) hoặc bảng băm `drone:ip_map` trong Redis để tìm chính xác `deviceId` của Drone.
4. **Cơ chế Phát hiện Mất Tín hiệu (Heartbeat Watchdog):**
   - Quét định kỳ 2 giây/lần. Nếu Drone không gửi Heartbeat trong 5 giây, tự động chuyển `connected = false` và bắn cảnh báo ra Redis Pub/Sub.
5. **Kèm theo Công cụ Mô phỏng Drone (Drone Simulator):**
   - Tự động sinh N drone ảo bay theo quỹ đạo tròn thực tế quanh tọa độ trung tâm, mô phỏng tiêu hao pin và phát gói tin MAVLink 10Hz để kiểm thử tải toàn diện.

---

## 2. Cấu Trúc Thư Mục

```
telemetry-ingestion-service/
├── cmd/
│   ├── server/           # Entrypoint khởi chạy Go Ingestion Server
│   │   └── main.go
│   └── simulator/        # Công cụ mô phỏng nhiều Drone phát MAVLink thời gian thực
│       └── main.go
├── internal/
│   ├── config/           # Module nạp cấu hình (.env)
│   ├── mavlink/          # Bộ giải mã tin nhắn MAVLink v1/v2
│   ├── publisher/        # Module Redis Publisher (Pipeline Hashes & Pub/Sub)
│   ├── resolver/         # Bộ phân giải IP sang DeviceID (RAM + Redis)
│   └── state/            # Bộ tổng hợp và duy trì trạng thái tức thời phi đội
├── pkg/
│   └── models/           # Định nghĩa cấu trúc dữ liệu JSON TelemetryPayload
├── Dockerfile            # Multi-stage Docker build tối ưu
├── go.mod, go.sum        # Quản lý thư viện phụ thuộc (gomavlib/v3, go-redis/v9)
├── .env.example          # File mẫu biến môi trường
└── target.md             # Tài liệu đặc tả kỹ thuật & kiến trúc
```

---

## 3. Hướng Dẫn Chạy & Kiểm Thử

### Cách 1: Chạy trực tiếp bằng Go

```bash
# 1. Chạy Ingestion Server (lắng nghe UDP port 14550)
go run cmd/server/main.go

# 2. Mở một Terminal khác chạy Drone Simulator (mô phỏng 3 drone ảo)
go run cmd/simulator/main.go --drones 3 --target 127.0.0.1:14550
```

### Cách 2: Chạy Unit Tests

```bash
go test -v ./...
```

### Cách 3: Chạy bằng Docker

```bash
# Build Docker Image
docker build -t drone-telemetry-ingestion:latest .

# Chạy container
docker run -d --name drone-ingest -p 14550:14550/udp drone-telemetry-ingestion:latest
```
