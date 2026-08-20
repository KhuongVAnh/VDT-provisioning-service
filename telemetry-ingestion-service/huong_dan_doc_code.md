# Hướng Dẫn Đọc Mã Nguồn Go (Code Tour)

Tài liệu này hướng dẫn bạn đọc và hiểu mã nguồn của **Go MAVLink Telemetry Ingestion Service** theo một trình tự logic nhất, từ khi gói tin MAVLink rời khỏi Drone cho đến khi dữ liệu Telemetry xuất hiện trên Web Dashboard thời gian thực. Hãy mở code trên VSCode và đi theo từng bước bên dưới.

---

## Bức Tranh Tổng Thể Trước Khi Đọc Code

```
[Drone / Pi] ──UDP 14551──► [cmd/server/main.go]
                                      │
                   ┌──────────────────┼──────────────────┐
                   ▼                  ▼                   ▼
          [resolver/]        [mavlink/decoder.go]   [state/aggregator.go]
         "IP này là ai?"    "Bản tin này nói gì?"   "Lưu vào bộ nhớ RAM"
                                                          │
                                                          ▼
                                                  [publisher/redis.go]
                                                  "Đẩy vào Redis"
                                                          │
                                         ┌────────────────┴────────────────┐
                                         ▼                                 ▼
                                  [drone:states]              [channel:drone:telemetry:all]
                                  (Key-Value Cache)              (Pub/Sub Realtime Stream)
                                         │                                 │
                                         └────────────────┬────────────────┘
                                                          ▼
                                              [NestJS TelemetryService]
                                              (Subscribe nhận sự kiện)
                                                          │
                                                          ▼
                                               [Web Dashboard (xterm.js)]
```

---

## Trình Tự Đọc Khuyến Nghị

### Bước 1: Điểm khởi chạy — Nơi mọi thứ bắt đầu

👉 **Mở file:** `cmd/server/main.go`

**Tác dụng:** Đây là **luồng chính (main goroutine)** của toàn bộ service. Đọc file này để hiểu toàn bộ kiến trúc:

1. **Đọc cấu hình** (`config.LoadConfig()`) — cổng UDP, cổng TCP GCS, địa chỉ Redis.
2. **Kết nối Redis** — dùng để lưu snapshot và publish sự kiện realtime.
3. **Khởi tạo 4 module con** — `ipResolver`, `stateAggregator`, `redisPublisher`, và `gomavlib node`.
4. **Mở 2 Endpoint đồng thời:**
   - `EndpointUDPServer` tại `0.0.0.0:14551` → nhận gói tin từ Drone qua VPN.
   - `EndpointTCPServer` tại `0.0.0.0:10002` → phục vụ QGroundControl / Mission Planner.
5. **Event Loop** (`for evt := range node.Events()`) — vòng lặp vĩnh viễn xử lý từng gói tin đến.
6. **Heartbeat Goroutine** — tiến trình nền kiểm tra Drone có mất tín hiệu không mỗi 2 giây.

> **Khái niệm cần biết:** `gomavlib.Node` là một **MAVLink Router đa điểm (Multiplexer)**. Nó tự động route bản tin 2 chiều giữa tất cả Endpoint đã đăng ký — tức là gói tin từ Drone tự chạy sang QGroundControl mà không cần viết thêm code.

---

### Bước 2: Cấu hình hệ thống — Đọc từ biến môi trường

👉 **Mở file:** `internal/config/config.go`

**Tác dụng:** Định nghĩa `struct Config` và hàm `LoadConfig()`. Toàn bộ tham số nhạy cảm đều được đọc từ biến môi trường Docker.

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `UDP_LISTEN_ADDR` | `0.0.0.0:14551` | Địa chỉ nhận gói tin UDP từ Drone |
| `TCP_GCS_PORT` | `10002` | Cổng TCP cho QGroundControl kết nối |
| `REDIS_ADDR` | `127.0.0.1:6380` | Địa chỉ Redis Server |
| `STATE_TTL_SECONDS` | `30` | Dữ liệu Drone hết hạn trong Redis sau bao nhiêu giây |

---

### Bước 3: Tra cứu "Drone nào đang gửi?" — IPResolver

👉 **Mở file:** `internal/resolver/resolver.go`

**Tác dụng:** Khi nhận được một gói tin UDP, `main.go` chỉ biết địa chỉ IP nguồn (ví dụ: `10.13.37.5`). Nhưng Dashboard cần `deviceId`. Module này giải quyết bài toán đó.

Luồng tra cứu theo thứ tự ưu tiên:

```
IP: 10.13.37.5
      │
      ▼ (1) Kiểm tra local RAM cache (tốc độ nano-giây, không tốn mạng)
      │     Hit? → Trả về ngay
      │
      ▼ (2) Truy vấn Redis `drone:ip_map` Hash
      │     (DeviceService của NestJS đã ghi vào đây khi Drone đăng ký)
      │     Hit? → Lưu vào RAM cache → Trả về
      │
      ▼ (3) Fallback: Tự sinh tạm "DRONE-IP-10-13-37-5"
            Lưu cache 30 giây để không spam Redis
```

> **Điểm thú vị:** `sync.Map` được dùng thay vì `map[string]string` bình thường để đảm bảo **an toàn khi nhiều goroutine đọc/ghi đồng thời (thread-safe)** mà không cần khóa (lock-free reads).

---

### Bước 4: "Bản tin MAVLink này nói gì?" — Decoder

👉 **Mở file:** `internal/mavlink/decoder.go`

**Tác dụng:** Đây là bộ giải mã (parser) các bản tin MAVLink sang dữ liệu thực tế.

| Message ID | Tên bản tin | Dữ liệu trích xuất |
|---|---|---|
| `#0` | `HEARTBEAT` | Armed/Disarmed, Flight Mode (STABILIZE, LOITER, RTL...) |
| `#33` | `GLOBAL_POSITION_INT` | Lat/Lon GPS (÷10⁷), Độ cao (mm→m), Vận tốc, Hướng bay (cdeg→deg) |
| `#1` | `SYS_STATUS` | % Pin còn lại, Điện áp (mV), Dòng điện (cA) |
| `#30` | `ATTITUDE` | Roll, Pitch, Yaw (rad→deg) |
| `#74` | `VFR_HUD` | Tốc độ gió (Airspeed), Tốc độ leo (Climb Rate), Ga (Throttle %) |
| `#24` | `GPS_RAW_INT` | Fix Type (3D/No Fix), Số vệ tinh khóa được |

> **Kiểu lập trình:** Hàm `DecodeMessage` dùng **Type Switch** (`switch m := msg.(type)`) — cách đặc trưng của Go để kiểm tra kiểu dữ liệu tại runtime và xử lý từng loại bản tin một cách an toàn.

---

### Bước 5: Lưu trữ và tổng hợp trạng thái — StateAggregator

👉 **Mở file:** `internal/state/aggregator.go`

**Tác dụng:** Module này duy trì một bảng trạng thái trong RAM (`map[deviceID]*TelemetryPayload`). Mỗi khi có gói tin mới, nó cập nhật (merge/patch) dữ liệu vào bảng và trả về bản snapshot mới nhất.

```go
// Ví dụ: HEARTBEAT đến → cập nhật Armed + FlightMode
// Sau đó GLOBAL_POSITION_INT đến → cập nhật GPS
// Payload của Drone luôn là bản "tổng hợp" đầy đủ nhất
snapshot, modified := stateAggregator.UpdateState(deviceID, e.SystemID(), remoteIP, e.Message())
```

Các hàm quan trọng:
- `UpdateState()` — Nhận gói tin mới, patch vào state, trả về snapshot an toàn.
- `CheckHeartbeats()` — Gọi mỗi 2 giây từ goroutine nền. Nếu Drone không gửi `HEARTBEAT` quá 5 giây → đánh dấu `Connected = false`.

> **Tại sao phải clone (`snapshot := *payload`):** Để tránh **race condition** — nếu trả về pointer trực tiếp, goroutine khác có thể đọc dữ liệu đang bị goroutine hiện tại ghi đè (data race).

---

### Bước 6: Đẩy dữ liệu vào Redis — RedisPublisher

👉 **Mở file:** `internal/publisher/redis.go`

**Tác dụng:** Sau khi có snapshot Telemetry mới, module này đẩy đồng thời vào **3 cấu trúc Redis** trong một lần gọi mạng duy nhất (Redis Pipeline):

```
PublishTelemetry(payload)
    │
    ├─ HSET drone:states <deviceId> <json>       → Bảng tổng trạng thái phi đội (Hash)
    ├─ SET  drone:state:<deviceId> <json> TTL30  → Cache riêng từng Drone (có thời gian sống)
    ├─ PUBLISH channel:drone:telemetry:<id> <json>   → Kênh riêng drone đó
    └─ PUBLISH channel:drone:telemetry:all <json>    → Kênh tổng hợp toàn phi đội
```

> **Tại sao dùng Pipeline:** Thay vì gửi 4 lệnh Redis = 4 lần kết nối mạng, Pipeline gom tất cả vào **1 lần roundtrip TCP duy nhất**, giảm latency đáng kể.

> **NestJS nhận dữ liệu từ đâu:** `TelemetryService` trong NestJS subscribe kênh `channel:drone:telemetry:all` và tự động nhận real-time mỗi khi Go publish vào đây.

---

### Bước 7: Mô hình dữ liệu — TelemetryPayload

👉 **Mở file:** `pkg/models/` (xem file trong thư mục này)

**Tác dụng:** Định nghĩa `struct TelemetryPayload` — cấu trúc JSON thống nhất được cả Go (ghi vào Redis) và NestJS (đọc từ Redis rồi đẩy xuống WebSocket) sử dụng chung.

---

### Bước 8: Công cụ kiểm thử — Drone Simulator

👉 **Mở file:** `cmd/simulator/main.go`

**Tác dụng:** Đây là **phần mềm giả lập phi đội Drone** dùng để test mà không cần phần cứng thật. Nó tạo ra N Drone ảo bay theo quỹ đạo tròn quanh khu vực ĐH Bách Khoa Hà Nội.

```bash
go run ./cmd/simulator/ \
  -drones 5                  # Số Drone ảo (mặc định 3)
  -target 127.0.0.1:14551   # Địa chỉ gửi đến
  -redis  127.0.0.1:6380    # Redis để đồng bộ IP Map
```

Mỗi Drone ảo gửi 2 loại gói tin:
- **10Hz** (100ms): GPS, Attitude, VFR HUD — dữ liệu thay đổi nhanh.
- **1Hz** (1s): Heartbeat, SysStatus, GPS Raw — dữ liệu thay đổi chậm.

---

## Sơ Đồ Cây Thư Mục

```
telemetry-ingestion-service/
│
├── cmd/
│   ├── server/main.go        ← Điểm khởi chạy Production Server
│   └── simulator/main.go     ← Công cụ giả lập Drone để test
│
├── internal/                  ← Package nội bộ, không expose ra ngoài
│   ├── config/
│   │   └── config.go         ← Đọc cấu hình từ biến môi trường
│   ├── mavlink/
│   │   ├── decoder.go        ← Giải mã các bản tin MAVLink → dữ liệu thực tế
│   │   └── decoder_test.go   ← Unit test bộ giải mã
│   ├── publisher/
│   │   └── redis.go          ← Ghi snapshot và Pub/Sub sự kiện vào Redis
│   ├── resolver/
│   │   ├── resolver.go       ← Tra cứu IP VPN → DeviceID (RAM + Redis cache)
│   │   └── resolver_test.go  ← Unit test bộ phân giải IP
│   └── state/
│       ├── aggregator.go     ← Bộ nhớ RAM tổng hợp trạng thái phi đội
│       └── aggregator_test.go← Unit test StateAggregator
│
├── pkg/                       ← Package có thể dùng chung với code khác
│   └── models/               ← Định nghĩa struct TelemetryPayload (schema JSON)
│
├── Dockerfile                 ← Build image Docker 2 giai đoạn (multi-stage)
├── go.mod                     ← Khai báo module và dependencies
└── .env.example               ← Mẫu cấu hình biến môi trường
```

---

## Chạy Unit Test

```bash
# Chạy toàn bộ test
go test ./...

# Chạy test với kiểm tra race condition
go test -race ./...

# Chạy test với output chi tiết từng module
go test -v ./internal/mavlink/...
go test -v ./internal/resolver/...
go test -v ./internal/state/...
```

---

## Các Khái Niệm Go Xuất Hiện Trong Code Này

| Khái niệm | Nơi dùng | Giải thích ngắn |
|---|---|---|
| `goroutine` | `main.go` (Heartbeat, Shutdown) | Luồng nhẹ chạy song song, dùng `go func(){}()` |
| `channel` | `sigChan` | Đường ống giao tiếp giữa các goroutine |
| `sync.RWMutex` | `aggregator.go` | Khóa đọc/ghi an toàn: nhiều goroutine đọc đồng thời, chỉ 1 goroutine ghi |
| `sync.Map` | `resolver.go` | Map thread-safe, không cần khóa thủ công |
| `Type Switch` | `decoder.go` | Kiểm tra kiểu interface tại runtime |
| `defer` | Mọi nơi | Đảm bảo luôn được gọi khi hàm kết thúc (dọn dẹp tài nguyên) |
| `Pipeline` | `redis.go` | Gom nhiều lệnh Redis thành 1 lần gửi mạng |
| `struct copy` | `aggregator.go` | Clone an toàn để tránh race condition |

---

*Ghi chú: Tất cả các file có đuôi `_test.go` là file test tự động, chạy bằng lệnh `go test ./...`.*
