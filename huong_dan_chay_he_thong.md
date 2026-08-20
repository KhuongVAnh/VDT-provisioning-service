# HƯỚNG DẪN VẬN HÀNH & KIỂM THỬ TOÀN DIỆN HỆ THỐNG
## Core Telemetry Ingestion (Go) + WebSockets Gateway + Web SSH + Mission Control

---

## I. SO SÁNH CHẠY DỰ ÁN TRÊN WINDOWS (DOCKER) VÀ VPS (UBUNTU)

| Đặc tính | Trên Ubuntu VPS (Production) | Trên Windows (Local Docker Test) |
|---|---|---|
| **File Compose** | `docker-compose.yml` (`network_mode: host`) | `docker-compose.local.yml` (Bridge Mode) |
| **Nhận MAVLink từ Drone** | UDP `0.0.0.0:14551` qua WireGuard (`10.13.37.X`) | UDP `127.0.0.1:14551` (từ Simulator/Drone thật) |
| **QGroundControl kết nối** | TCP `IP_VPS:10002` | TCP `127.0.0.1:10002` |
| **Web Dashboard** | `http://IP_VPS:10004/` | `http://localhost:10004/` |
| **Phân giải định danh Drone** | Tra cứu Redis theo IP VPN `10.13.37.X` | Tra cứu Redis theo cả `drone:ip_map` & `drone:sys_map` |

---

## II. HƯỚNG DẪN CHẠY TRÊN WINDOWS BẰNG DOCKER

### Bước 1: Khởi chạy toàn bộ hệ thống bằng Docker Compose
Mở PowerShell tại thư mục gốc dự án:
```powershell
docker compose -f docker-compose.local.yml up -d --build
```

Lệnh trên sẽ tự động dựng và chạy 3 container:
1. **`drone-redis`** (Cổng 6380): Broker Cache & Pub/Sub.
2. **`drone-telemetry-ingestion`** (Cổng UDP 14551 & TCP 10002): Bộ giải mã MAVLink & GCS Router.
3. **`drone-provisioning-api`** (Cổng 10004): Web Dashboard & WebSocket Gateway.

---

### Bước 2: Chạy bộ giả lập phi đội Drone (Simulator)
Mở cửa sổ PowerShell mới:
```powershell
cd telemetry-ingestion-service
go run ./cmd/simulator/main.go -drones 3 -target 127.0.0.1:14551 -redis 127.0.0.1:6380
```

> **Cơ chế hoạt động:**
> - Simulator sẽ tự sinh ra 3 drone ảo (`DRONE-SIM-0001`, `DRONE-SIM-0002`, `DRONE-SIM-0003`) với SystemID (1, 2, 3) và IP ảo (`10.13.37.2`, `10.13.37.3`, `10.13.37.4`).
> - Drone ảo bay vòng tròn quanh khu vực Hà Nội (HUST Campus), pin tụt dần theo thời gian, góc nghiêng Roll/Pitch thay đổi khi vào cua và phát luồng Telemetry 10Hz vào hệ thống Ingestion.

---

### Bước 3: Mở Web Dashboard giám sát tác chiến
Truy cập trình duyệt: **`http://localhost:10004/`**

1. **Tab Bản Đồ Tác Chiến:**
   - 3 Drone ảo sẽ xuất hiện trên bản đồ vệ tinh tối màu Leaflet với icon xoay theo góc hướng bay thực tế.
   - Vết bay (Flight Trail) hiển thị quỹ đạo bay tròn.
   - Quick HUD bên phải hiển thị chi tiết: % Pin, Độ cao (m), Tốc độ (m/s), Heading (°), Artificial Horizon 3D.
2. **Tab Đội Drone:**
   - Xem bảng danh sách Drone đang phát sóng thời gian thực.
   - Có thể thực hiện các thao tác: Khóa (Revoke), Mở khóa (Reactivate), Xóa vĩnh viễn (Delete).

---

### Bước 4: Kết nối QGroundControl trên máy Windows (Tuỳ chọn)
Nếu bạn có cài phần mềm **QGroundControl** hoặc **Mission Planner** trên Windows:
1. Mở QGroundControl ➔ **Application Settings** ➔ **Comm Links** ➔ **Add**.
2. Thiết lập:
   - **Type:** `TCP`
   - **Host Address:** `127.0.0.1`
   - **Port:** `10002`
3. Bấm **Connect**.
➔ QGroundControl sẽ nhận trực tiếp luồng bay từ 3 Drone ảo thông qua Ingestion Router và hiển thị máy bay trên bản đồ QGroundControl!

---

## III. HƯỚNG DẪN TRIỂN KHAI LÊN VPS (UBUNTU LINUX)

Trên VPS Ubuntu thật:
```bash
# 1. Clone source code về VPS
git clone <repo_url>
cd provisioning_service

# 2. Khởi chạy toàn bộ hệ thống bằng docker-compose.yml
docker compose up -d --build

# 3. Xem log thời gian thực
docker compose logs -f
```

---

## IV. CHẠY KIỂM THỬ TỰ ĐỘNG (AUTOMATED TESTS)

```bash
# Kiểm tra Go Ingestion Service
cd telemetry-ingestion-service
go test -v ./...

# Kiểm tra NestJS API Gateway
cd ../provisioning-api
npm test
```
