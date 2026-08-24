# Hướng Dẫn Đọc Mã Nguồn Go (Code Tour)
## Drone Telemetry Ingestion & MAVLink GCS Router Core

Tài liệu này hướng dẫn bạn đọc và hiểu toàn bộ mã nguồn của **Go MAVLink Ingestion Service** theo một trình tự logic, từ lúc Drone gửi gói tin qua mạng VPN cho tới khi dữ liệu xuất hiện trên Web Dashboard và phần mềm mặt đất (QGroundControl / Mission Planner).

---

## 🗺️ Bức Tranh Tổng Thể Kiến Trúc

```
                ┌──────────────────────────────────────────────────┐
                │        [Drone Companion Computer / Pi 4]         │
                │        IP WireGuard VPN: 10.13.37.X              │
                └────────────────────────┬─────────────────────────┘
                                         │ (UDP :14551)
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│              GOLANG CORE SERVICE (telemetry-ingestion-service)                │
│                                                                               │
│  [1. MAVLink Multi-Endpoint Node] (gomavlib/v3)                               │
│      ├─ EndpointUDPServer (0.0.0.0:14551) ──► Nhận luồng từ Drone qua VPN     │
│      └─ EndpointTCPServer (0.0.0.0:10002) ──► Phục vụ QGroundControl / MP     │
│                                                                               │
│  [2. Ba luồng xử lý song song]:                                              │
│      ├─ Luồng A: Định tuyến TCP truyền thống (GCS Router 10002)               │
│      │     node.WriteFrameTo() ──► Bắn sang TCP 10002                         │
│      │                                                                        │
│      ├─ Luồng B: Xuất bản Byte nhị phân thô (Raw Binary Pub/Sub)              │
│      │     PublishRawFrame()   ──► Bắn byte thô vào channel:drone:raw:<id>    │
│      │                                                                        │
│      └─ Luồng C: Giải mã & Đồng bộ Telemetry JSON (Cloud Ingestion)           │
│            │                                                                  │
│            ▼                                                                  │
│     [extractIPFromChannel]   "Trích xuất IP nguồn 10.13.37.X"                 │
│            ▼                                                                  │
│     [internal/resolver]      "Tra cứu IP ➔ DeviceID (RAM Cache + Redis Map)"  │
│            ▼                                                                  │
│     [internal/mavlink]       "Giải mã 6 bản tin cốt lõi (#0,#33,#1,#30,#74,#24)"│
│            ▼                                                                  │
│     [internal/state]         "Tổng hợp Snapshot trạng thái an toàn đa luồng"  │
│            ▼                                                                  │
│     [internal/publisher]     "Đẩy vào Redis Pipeline (Hashes + Pub/Sub)"      │
└────────────────────────────────────────┬──────────────────────────────────────┘
                                         │ (Redis Pub/Sub :6380)
                                         ▼
                ┌──────────────────────────────────────────────────┐
                │          [NestJS Business Gateway :10004]        │
                │ • TelemetryGateway: JSON Telemetry cho Web HUD   │
                │ • MavlinkRelayGateway: Binary MAVLink cho Pilot  │
                └────────────────────────┬─────────────────────────┘
                                         │ 
                        ┌────────────────┴────────────────┐
                        ▼                                 ▼
         [Web Mission Control Dashboard]       [Pilot Bridge / QGroundControl]
         (Bản đồ GPS Leaflet + Quick HUD)     (Điều khiển bay 2 chiều 127.0.0.1:5760)
```

---

## 📖 Trình Tự Đọc Code Khuyến Nghị

### Bước 1: Điểm khởi chạy chính — `cmd/server/main.go`

👉 **Mở file:** `cmd/server/main.go`

**Chức năng chính:**
1. **Đọc cấu hình** (`config.LoadConfig()`): Cổng UDP `14551`, cổng TCP GCS `10002`, địa chỉ Redis.
2. **Khởi tạo kết nối Redis Client:** Kiểm tra kết nối liveness và quản lý lifecycle.
3. **Khởi tạo 4 module nội bộ:** `IPResolver`, `StateAggregator`, `RedisPublisher`, và gomavlib `Node`.
4. **MAVLink Multi-Endpoint Router:**
   - Mở đồng thời `EndpointUDPServer` (nhận từ Drone) và `EndpointTCPServer` (cho QGroundControl).
   - `node.WriteFrameExcept(e.Channel, e.Frame)`: Chuyển tiếp frame 2 chiều giữa Drone và QGroundControl với độ trễ nano-giây.
5. **Bộ lọc GCS Filter:** Bỏ qua các frame mang `SystemID == 255` hoặc `MAV_TYPE_GCS` từ QGroundControl để không nhận nhầm máy khách thành Drone.
6. **Heartbeat Watchdog Goroutine:** Quét mỗi 2s; nếu Drone mất tín hiệu > 5s ➔ Đánh dấu `Connected = false` và cập nhật Redis.
7. **Graceful Shutdown:** Bắt tín hiệu `SIGINT` / `SIGTERM` dọn dẹp tài nguyên trước khi tắt.

---

### Bước 2: Đọc cấu hình hệ thống — `internal/config/config.go`

👉 **Mở file:** `internal/config/config.go`

Định nghĩa `struct Config` và đọc các biến môi trường từ hệ điều hành / Docker với giá trị mặc định tối ưu:

| Biến môi trường | Mặc định | Tác dụng |
|---|---|---|
| `UDP_LISTEN_ADDR` | `0.0.0.0:14551` | Cổng UDP lắng nghe gói tin từ Drone qua WireGuard VPN |
| `TCP_GCS_PORT` | `10002` | Cổng TCP cho trạm mặt đất QGroundControl / Mission Planner |
| `REDIS_ADDR` | `127.0.0.1:6380` | Địa chỉ Redis Broker (chạy cổng 6380 để tránh xung đột) |
| `STATE_TTL_SECONDS` | `30` | Thời gian sống (TTL) của trạng thái tức thời từng Drone |

---

### Bước 3: Phân giải IP sang Device ID — `internal/resolver/resolver.go`

👉 **Mở file:** `internal/resolver/resolver.go`

Gói tin UDP chỉ mang IP nguồn (`10.13.37.X`), module này xác định `deviceId` duy nhất của Drone theo cơ chế 3 tầng:

1. **Tầng 1 (In-Memory Cache - `sync.Map`):** Tra cứu trong RAM cục bộ (tốc độ nano-giây, lock-free).
2. **Tầng 2 (Redis Hash `drone:ip_map`):** Truy vấn bảng ánh xạ được NestJS đồng bộ khi Drone đăng ký.
3. **Tầng 3 (Fallback An Toàn):** Tự động sinh ID tạm `DRONE-IP-10-13-37-X` (cache 30s) giúp hệ thống không bao giờ bị drop gói tin.

---

### Bước 4: Giải mã gói tin MAVLink — `internal/mavlink/decoder.go`

👉 **Mở file:** `internal/mavlink/decoder.go`

Bộ giải mã sử dụng Go *Type Switch* để bóc tách 6 bản tin MAVLink cốt lõi:

| Message ID | Tên bản tin | Dữ liệu trích xuất |
|---|---|---|
| `#0` | `HEARTBEAT` | Trạng thái động cơ (Armed), Flight Mode ArduPilot (GUIDED, RTL, AUTO, LOITER...), Đánh dấu `Connected = true`. |
| `#33` | `GLOBAL_POSITION_INT` | GPS Lat/Lon (÷10⁷), Độ cao tương đối / MSL (mm ➔ m), Vận tốc Ground Speed, Góc hướng Heading. |
| `#24` | `GPS_RAW_INT` | Trạng thái Fix vệ tinh, Số lượng vệ tinh, Tọa độ GPS thô, Độ cao MSL, Vận tốc thô (dự phòng khi chưa có #33). |
| `#1` | `SYS_STATUS` | Dung lượng pin %, Điện áp Voltage (mV), Dòng tiêu thụ Current (cA). |
| `#30` | `ATTITUDE` | Góc nghiêng 3 chiều: Roll (lắc ngang), Pitch (chúc ngóc), Yaw (hướng xoay) đổi từ rad ➔ độ. |
| `#74` | `VFR_HUD` | Tốc độ gió Airspeed (m/s), Tốc độ nâng Climb Rate (m/s), Mức ga Throttle %. |

---

### Bước 5: Tổng hợp trạng thái phi đội — `internal/state/aggregator.go`

👉 **Mở file:** `internal/state/aggregator.go`

Duy trì bảng trạng thái trong RAM (`map[deviceID]*TelemetryPayload`):
* Dùng `sync.RWMutex` bảo vệ tài nguyên an toàn đa luồng.
* Cơ chế **Safe Clone** (`snapshot := *payload`): Trả về bản sao giá trị để luồng phát Redis không gây Data Race với luồng Ingest.
* Hàm `CheckHeartbeats(5s)`: Quét và phát hiện các Drone bị mất tín hiệu kết nối.

---

### Bước 6: Xuất bản dữ liệu Redis Pipeline — `internal/publisher/redis.go`

👉 **Mở file:** `internal/publisher/redis.go`

Gom tất cả 4 thao tác Redis vào **1 Redis Pipeline duy nhất** (1 TCP Network Roundtrip):
1. `HSET drone:states <deviceId> <json>`: Lưu snapshot phi đội vào Hash.
2. `SET drone:state:<deviceId> <json> EX 30`: Cache trạng thái kèm TTL 30s.
3. `PUBLISH channel:drone:telemetry:<deviceId> <json>`: Bắn sự kiện vào kênh riêng của Drone.
4. `PUBLISH channel:drone:telemetry:all <json>`: Bắn sự kiện vào kênh tổng hợp (cho NestJS WebSocket Gateway).

---

### Bước 7: Công cụ giả lập bay — `cmd/simulator/main.go`

👉 **Mở file:** `cmd/simulator/main.go`

Giả lập N Drone ảo bay vòng tròn quanh khu vực Hà Nội (HUST Campus):
* **Luồng 10Hz (100ms):** Bắn bản tin GPS `#33`, Attitude `#30` (nghiêng khi vào cua), VFR HUD `#74`.
* **Luồng 1Hz (1s):** Bắn bản tin Heartbeat `#0`, Pin SysStatus `#1` (tụt pin dần), GPS Raw `#24`.
* Tự động đăng ký ánh xạ IP vào Redis `drone:ip_map`.

---

## 🧪 Chạy Kiểm Thử Tự Động (Unit Tests)

```bash
# Chạy toàn bộ Unit Tests với kết quả chi tiết
go test -v ./...
```
