# TÀI LIỆU KIẾN TRÚC & TỪ ĐIỂN DỮ LIỆU REDIS
## (Luồng Ingestion Telemetry Chi Tiết Từ Drone, Đóng Gói Vào Redis, Xử Lý Phía Server Và Phân Phối Socket.IO Rooms)

---

## I. TỔNG QUAN KIẾN TRÚC & MÔ HÌNH DÒNG CHẢY DỮ LIỆU (END-TO-END DATA FLOW)

Trong hệ thống Giám sát và Quản lý Drone BVLOS tầm xa, **Redis Server** (chạy tại cổng nội bộ `6380`/`6379`) đóng vai trò là **Trục Xương Sống Bộ Nhớ Tốc Độ Cao (High-Speed In-Memory Backbone)**, kết nối 3 thành phần cốt lõi:
1. **Dịch vụ nuốt dữ liệu bay ([`telemetry-ingestion-service`](../telemetry-ingestion-service) - Golang Core):** Tiếp nhận luồng UDP MAVLink từ Drone, lọc nhiễu Deadband, gom Micro-Batching và ghi vào Redis.
2. **Cổng điều phối & API ([`provisioning-api`](../provisioning-api) - NestJS):** Đọc dữ liệu từ Redis, lưu bộ đệm L1 Cache RAM, thực hiện phân quyền và phát dữ liệu vào các phòng Socket.IO chuyên biệt.
3. **Giao diện tác chiến & Trạm điều khiển ([`Web Dashboard`](../provisioning-api/public/) & [`Pilot Bridge / QGC`](../pilot-bridge/)):** Hiển thị bản đồ 60 FPS, Cockpit HUD và điều khiển bay hai chiều.

```text
=============================================================================================================
                      SƠ ĐỒ TỔNG THỂ DÒNG CHẢY DỮ LIỆU TELEMETRY (END-TO-END DATA FLOW)
=============================================================================================================

 [🚁 DRONES / COMPANION COMPUTERS]
   │
   │  • Drone 1 (10.13.37.2) ───┐ (Gói tin UDP MAVLink v2 qua WireGuard VPN)
   │  • Drone 2 (10.13.37.3) ───┼────────────────────────────────────────┐
   │  • Drone N (10.13.37.N) ───┘                                        │
   ▼                                                                     │
┌────────────────────────────────────────────────────────────────────────▼──────────────────────────────────┐
│ 1. GOLANG INGESTION SERVICE (telemetry-ingestion-service - Port 14551 UDP)                                │
│    ├─► [UDP Receiver]          : Tiếp nhận gói MAVLink v2 từ socket UDP                                    │
│    ├─► [IP/SysID Resolver]     : Tra cứu IP nguồn 10.13.37.X -> deviceId qua drone:ip_map (< 0.1ms)       │
│    ├─► [State Aggregator (RAM)]: Gom các gói đơn lẻ thành 1 snapshot TelemetryPayload hoàn chỉnh          │
│    ├─► [Deadband Filter]       : Lọc 90% gói thừa (chỉ phát khi biến thiên GPS, Alt, Heading, Pin...)      │
│    └─► [Micro-Batch Buffer]    : Bộ đệm RAM 2,000 items -> Gom chu kỳ 20ms thực thi 1 Redis Pipeline       │
└────────────────────────────────────────┬──────────────────────────────────────────────────────────────────┘
                                         │ 1 Pipeline / 20ms (HSET + ZADD + PUBLISH)
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. REDIS IN-MEMORY BACKBONE (Port 6380)                                                                   │
│    ┌──────────────────────────────────────────────┐  ┌────────────────────────────────────────────────┐   │
│    │ 🗄️ CẤU TRÚC LƯU TRỮ TRẠNG THÁI               │  │ 📢 KÊNH SỰ KIỆN THỜI GIAN THỰC (PUB/SUB)       │   │
│    │ • drone:ip_map    : Tra cứu IP -> deviceId   │  │ • channel:drone:telemetry:full:<id> (20Hz Full)│   │
│    │ • drone:sys_map   : Tra cứu SysID -> deviceId│  │ • channel:drone:telemetry:lite:<id> (1Hz Lite) │   │
│    │ • drone:states    : Hash Snapshot toàn phi đội│  │ • channel:drone:raw:full:<id>       (20Hz)     │   │
│    │ • drone:heartbeats: ZSET Liveness theo Time  │  │ • channel:drone:raw:lite:<id>       (1Hz)      │   │
│    │ • drone:focus_set : Set các Drone đang lái   │  │                                                │   │
│    └──────────────────────────────────────────────┘  └────────────────────────────────────────────────┘   │
└───────────────────────┬──────────────────────────────────────────────┬────────────────────────────────────┘
                        │ HGETALL drone:states (REST API)              │ PSUBSCRIBE channel:drone:telemetry:*
                        ▼                                              ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 3. NESTJS BACKEND GATEWAY (provisioning-api - Port 10004)                                                 │
│    ├─► [Redis Subscriber]   : Lắng nghe luồng sự kiện bay thời gian thực từ Redis Pub/Sub                │
│    ├─► [L1 In-Memory Cache] : Lưu RAM Node.js 0ms + SingleFlight Mutex (500ms chống Cache Stampede)       │
│    ├─► [Auto-Discovery DB]  : Tự động ghi danh Drone mới vào PostgreSQL                                   │
│    ├─► [MAVLink Relay]      : Cầu nối nhị phân On-Demand chuyển tiếp xuống QGroundControl / Pilot Bridge  │
│    └─► [Telemetry Gateway]  : Phân phối dữ liệu vào các Socket.IO Rooms theo quyền hạn                    │
└────────────────────────────────────────┬──────────────────────────────────────────────────────────────────┘
                                         │ Phân chia phòng WebSocket (Socket.IO Rooms)
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐ ┌──────────────────────────────┐
│ ROOM 'admin' / 'all'         │ │ ROOM 'user:<userId>'         │ │ ROOM 'drone:<deviceId>'      │
│ (Dành cho Super Admin)       │ │ (Dành cho Phi Công Sở Hữu)   │ │ (Dành cho Client Đang Lái)   │
│ • Nhận toàn bộ Drone         │ │ • Chỉ nhận Drone của mình    │ │ • Nhận luồng 20Hz Full       │
│ • Tần số: 1Hz Lite / 20Hz    │ │ • Tần số: 1Hz Lite           │ │ • Vẽ HUD 3D, chân trời, HUD  │
│ • Xem toàn cảnh tác chiến    │ │ • Cập nhật tiểu đội bản đồ   │ │ • Ghi SADD drone:focus_set   │
└──────────────┬───────────────┘ └──────────────┬───────────────┘ └──────────────┬───────────────┘
               │                                │                                │
               └────────────────────────────────┼────────────────────────────────┘
                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 4. TRÌNH DIỄN & ĐIỀU KHIỂN (CLIENT DASHBOARD & PILOT BRIDGE)                                              │
│    ├─► Web Dashboard (public/js/socket.js) : Nhận telemetry:update -> Hàng đợi queue -> 60 FPS rAF       │
│    ├─► Tactical Map (public/js/map.js)     : Leaflet Canvas (preferCanvas: true) vẽ Marker xoay góc       │
│    ├─► Cockpit HUD (public/js/hud.js)      : Hiển thị Roll/Pitch, độ cao, vận tốc mượt mà                │
│    └─► Pilot Bridge / QGC (Port 10004)     : Nhận MAVLink v2 thô & bắn lệnh điều khiển Uplink về Drone    │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## II. CHI TIẾT GIAI ĐOẠN 1: INGESTION TỪ DRONE VÀO GO & ĐẨY VÀO REDIS

```text
[Drone 10.13.37.X] ──(UDP 14551)──> [Go Ingestion] ──(Micro-Batch 20ms)──> [Redis Pipeline]
```

### 1. Tiếp nhận gói tin & Phân giải định danh (IP/SysID Resolution)
* Drone kết nối qua **WireGuard VPN** (`10.13.37.X`) và bắn các gói tin MAVLink v2 (`HEARTBEAT`, `GLOBAL_POSITION_INT`, `ATTITUDE`, `SYS_STATUS`, `GPS_RAW_INT`...) về cổng UDP `14551` của VPS.
* Go Ingestion Service trích xuất IP nguồn thực tế từ UDP Socket:
  1. Kiểm tra bảng băm `drone:ip_map` trong Redis: `10.13.37.2` $\rightarrow$ `DRONE-001` ($< 0.1\text{ms}$).
  2. Nếu không tìm thấy IP, kiểm tra System ID qua `drone:sys_map`: `SysID 1` $\rightarrow$ `DRONE-001`.
  3. Nếu là thiết bị mới chưa cấu hình: tự sinh fallback `DRONE-IP-10-13-37-2` để không làm gián đoạn luồng dữ liệu.

### 2. State Aggregation & Bộ lọc biến thiên (Deadband Filtering)
* **`StateAggregator` (RAM In-Memory):** Gom tất cả các bản tin MAVLink đơn lẻ (gói GPS gửi ở 5Hz, gói Attitude gửi ở 20Hz, gói Pin gửi ở 1Hz) thành một thực thể trạng thái đo xa hoàn chỉnh duy nhất (`TelemetryPayload`).
* **`DeadbandFilter`:** Lọc bỏ 85% – 90% các gói tin thừa:
  * **Sự kiện khẩn cấp (Phát ngay lập tức):** Chuyển chế độ bay (`flightMode`), đổi trạng thái động cơ (`armed`), đổi `fixType` GPS, mất hoặc có lại kết nối (`connected`).
  * **Kiểm tra ngưỡng biến thiên:** Chỉ phát khi $\Delta\text{GPS} \ge 0.2\text{m}$, $\Delta\text{Độ cao} \ge 0.1\text{m}$, $\Delta\text{Góc la bàn} \ge 1.0^\circ$, $\Delta\text{Roll/Pitch} \ge 0.8^\circ$, $\Delta\text{Pin} \ge 1\%$.
  * **Rate Limiting:** Khống chế khoảng cách tối thiểu giữa 2 lần phát không nhanh hơn `minInterval` (mặc định 20Hz / 50ms).
  * **Heartbeat định kỳ:** Nếu Drone đứng yên 100%, vẫn cưỡng bức phát **1 lần mỗi 2 giây** để đảm bảo liveness.

### 3. Gom Micro-Batching Pipeline theo chu kỳ 20ms
* Thay vì mỗi frame gọi lệnh Redis một lần (gây nghẽn Syscall mạng), Go Service đưa các payload đã lọc vào bộ đệm RAM Channel (`telemetryChan` & `rawChan`, sức chứa 2,000 items).
* Background Worker `microBatchFlushLoop` định kỳ **20 mili-giây** (50 lần/giây) thức dậy, gom tất cả các item trong giỏ và mở 1 `redis.Pipeline()` duy nhất:
  ```go
  pipe := p.client.Pipeline()
  // 1. Cập nhật snapshot Full JSON vào Hash
  pipe.HSet(ctx, "drone:states", item.DeviceID, string(item.JSONData))
  // 2. Cập nhật nhịp tim Liveness vào ZSET
  pipe.ZAdd(ctx, "drone:heartbeats", redis.Z{ Score: float64(now.Unix()), Member: item.DeviceID })
  // 3. Phân luồng phát Pub/Sub theo Focus Set
  if isFocused {
      pipe.Publish(ctx, "channel:drone:telemetry:full:" + item.DeviceID, string(item.JSONData))
      pipe.Publish(ctx, "channel:drone:raw:full:" + item.DeviceID, rawBytes)
  } else {
      // Khống chế tần số 1Hz cho Drone nền
      if time.Since(lastLite) >= 1*time.Second {
          pipe.Publish(ctx, "channel:drone:telemetry:lite:" + item.DeviceID, string(liteJSON))
      }
      if time.Since(lastRawLite) >= 1*time.Second {
          pipe.Publish(ctx, "channel:drone:raw:lite:" + item.DeviceID, rawBytes)
      }
  }
  pipe.Exec(ctx) // 1 TCP Roundtrip duy nhất cho hàng chục lệnh!
  ```

---

## III. CHI TIẾT GIAI ĐOẠN 2: NESTJS BACKEND ĐỌC DỮ LIỆU REDIS & MỤC ĐÍCH SỬ DỤNG

```text
[Redis Server] ──(Pub/Sub + HGetAll)──> [NestJS Gateway] ──(L1 Cache + Auth Guard)──> [REST & WebSockets]
```

### 1. Tiến trình lắng nghe Pub/Sub Subscriber thời gian thực
* `TelemetryService` sử dụng kết nối Redis Subscriber chuyên dụng để đăng ký pattern `channel:drone:telemetry:*`.
* Khi có bản tin bắn về từ Go Ingestion qua Redis:
  1. **Chuẩn hóa Payload (`normalizeTelemetryPayload`):** Nếu là bản tin từ kênh `lite` (gói nén ~70 bytes), server tự động giải nén và bổ sung các trường mặc định để tương thích 100% với UI.
  2. **Ghi vào L1 In-Memory Cache của Node.js (0ms):** Cập nhật `inMemoryCache.set(deviceId, telemetryData)` để các luồng đọc nội bộ không cần truy vấn lại Redis.
  3. **Auto-Discovery thiết bị mới:** Nếu phát hiện `deviceId` mới xuất hiện lần đầu trên dải mạng VPN (`10.13.37.X`), tự động gọi `deviceService.findOrCreateManualDevice()` để lưu vào PostgreSQL.
  4. **Chuyển tiếp sang WebSocket Gateway:** Gọi `telemetryGateway.broadcastTelemetry(telemetryData)`.

### 2. Phục vụ REST API Snapshot chống Cache Stampede
* **Endpoint:** `GET /api/v1/telemetry/fleet/states` (Được gọi khi người dùng mở Dashboard, F5 hoặc tải lại danh sách Drone).
* **Cơ chế chống nghẽn (Anti-Stampede Architecture):**
  * **L1 Cache RAM (TTL 500ms):** Nếu nhiều người dùng cùng gọi API trong vòng 500ms, Server trả kết quả trực tiếp từ RAM Node.js trong **0 mili-giây**, không chạm tới Redis.
  * **SingleFlight Mutex Promise:** Nếu cache hết hạn và có 1,000 người dùng cùng F5 một lúc, chỉ đúng **1 truy vấn** được gửi xuống Redis (`HGETALL drone:states`) và DB, 999 request còn lại dùng chung kết quả của Promise đó.

### 3. Cầu nối nhị phân On-Demand MAVLink Relay ([`mavlink-relay.gateway.ts`](../provisioning-api/src/telemetry/mavlink-relay.gateway.ts))
* **Mục đích:** Phục vụ ứng dụng điều khiển chuyên nghiệp **QGroundControl / Mission Planner / Pilot Bridge** kết nối qua WebSocket cổng `10004` (Namespace `/mavlink`).
* **Cơ chế On-Demand:**
  * Chỉ `SUBSCRIBE channel:drone:raw:full:<id>` khi có Pilot thực sự kết nối điều khiển Drone đó.
  * Tự động `UNSUBSCRIBE` khi Pilot ngắt kết nối $\rightarrow$ Triệt tiêu 100% lãng phí CPU và băng thông cho các Drone không có người xem.
  * **Uplink (Lệnh lái):** Khi Pilot gửi byte điều khiển từ cần lái qua WebSocket $\rightarrow$ Gateway nhận và bắn UDP Socket trực tiếp vào IP WireGuard của Drone (`10.13.37.X:14551`).

---

## IV. CHI TIẾT GIAI ĐOẠN 3: PHÂN PHỐI DỮ LIỆU VÀO CÁC PHÒNG (ROOMS) SOCKET.IO

```text
[TelemetryGateway.broadcastTelemetry] ──> [Server-Side Room Isolation] ──> [Web Dashboard]
```

### 1. Bảng quy hoạch các Room Socket.IO và Phân quyền bảo mật

Để đảm bảo bảo mật không phận và tối ưu băng thông mạng trình duyệt, dữ liệu được phân chia vào các phòng chuyên biệt dựa trên vai trò người dùng (JWT Authentication):

```text
                                  ┌────────────────────────┐
                                  │   TELEMETRY GATEWAY    │
                                  │  (broadcastTelemetry)  │
                                  └───────────┬────────────┘
                      ┌───────────────────────┼───────────────────────┐
                      ▼                       ▼                       ▼
            ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
            │   ROOM 'admin'   │    │ ROOM 'user:<id>' │    │ ROOM 'drone:<id>'│
            └─────────┬────────┘    └─────────┬────────┘    └─────────┬────────┘
                      │                       │                       │
                      ▼                       ▼                       ▼
            ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
            │ 👑 SUPER ADMIN   │    │ 👤 PHI CÔNG      │    │ 🎯 MÀN HÌNH HUD  │
            │ Nhận tất cả      │    │ Nhận các Drone   │    │ Nhận luồng 20Hz  │
            │ Drone toàn mạng  │    │ thuộc sở hữu     │    │ của Drone đang   │
            │ (1Hz Lite / 20Hz)│    │ (Tiểu đội 1Hz)   │    │ Focus lái tay    │
            └──────────────────┘    └──────────────────┘    └──────────────────┘
```

| Tên Phòng (Socket.IO Room) | Đối tượng tham gia | Điều kiện tham gia | Tần số dữ liệu nhận | Mục đích sử dụng trên Web UI |
| :--- | :--- | :--- | :---: | :--- |
| **`admin`** / **`all`** | Quản trị viên hệ thống (Role `ADMIN`) | Tự động join khi kết nối có Token Admin | **Tất cả Drone** (1Hz Lite hoặc 20Hz Focus) | Hiển thị toàn cảnh bức tranh tác chiến của toàn bộ Drone trên cả nước, giám sát KPI hệ thống. |
| **`user:<userId>`** | Phi công sở hữu (Role `PILOT`) | Tự động join vào phòng cá nhân chứa User ID của mình | **1Hz Lite** (Chỉ các Drone do Pilot này sở hữu) | Cập nhật vị trí các Drone trong phi đội/tiểu đội của mình trên bản đồ Leaflet (vẽ icon, hiển thị trạng thái pin/GPS). |
| **`drone:<deviceId>`** | Pilot đang lái hoặc Admin xem chi tiết | Client chủ động phát sự kiện `subscribe:drone` | **20Hz Full** (Bản tin chi tiết tốc độ cao) | Cập nhật chuyển động mượt mà của đường chân trời nhân tạo Cockpit HUD, la bàn, góc nghiêng Roll/Pitch 3D, thanh đo độ cao/vận tốc. |

### 2. Vòng đời Focus Drone (`subscribe:drone` & `drone:focus_set`)
Khi người dùng tương tác trên Web Dashboard:

1. **Khi Click chọn 1 Drone trên bản đồ hoặc menu:**
   * Trình duyệt gửi sự kiện: `socket.emit('subscribe:drone', { deviceId: 'DRONE-001' })`.
   * Server kiểm tra quyền sở hữu (nếu là Pilot chỉ được phép Focus Drone của mình).
   * Socket của client được đưa vào phòng `drone:DRONE-001`.
   * Server gọi `redisService.addFocusDrone('DRONE-001')` $\rightarrow$ Thêm ID vào Redis Set `drone:focus_set`.
   * Go Ingestion Service nhận diện ID này nằm trong Focus Set $\rightarrow$ **Tự động kích hoạt luồng 20Hz Full chi tiết** (cấu hình qua `MAX_PUBLISH_RATE_HZ=20`).
2. **Khi chuyển sang Drone khác hoặc đóng theo dõi:**
   * Trình duyệt gửi sự kiện: `socket.emit('unsubscribe:drone', { deviceId: 'DRONE-001' })`.
   * Socket rời khỏi phòng `drone:DRONE-001`.
   * Nếu phòng này không còn ai khác theo dõi $\rightarrow$ Server gọi `redisService.removeFocusDrone('DRONE-001')`.
   * Go Ingestion Service phát hiện không còn ai Focus $\rightarrow$ **Tự động hạ tần số về 1Hz Lite**, tiết kiệm 95% tải.

### 3. Phía Client Web Dashboard: Gom hàng đợi & Vẽ mượt mà 60 FPS
* **Vấn đề:** Khi có nhiều Drone cùng gửi tin nhắn qua WebSocket, nếu mỗi sự kiện `telemetry:update` đều gọi hàm vẽ lại DOM/Canvas, trình duyệt sẽ bị nghẽn CPU và tụt khung hình.
* **Giải pháp trong [`socket.js`](../provisioning-api/public/js/socket.js):**
  1. Khi nhận sự kiện `telemetry:update`, gói tin được đưa vào hàng đợi `telemetryRenderQueue.set(deviceId, data)`.
  2. Kích hoạt chu kỳ vẽ qua `requestAnimationFrame()` (đồng bộ theo tần số quét của màn hình máy tính 60Hz / 144Hz):
  3. Cập nhật vị trí Marker máy bay trên bản đồ Leaflet (`preferCanvas: true`).
  4. Xoay góc la bàn bằng CSS Transform `rotate(Xdeg)` trực tiếp trên icon thay vì hủy tạo lại DOM.
  5. Cập nhật đường bay lịch sử Polyline (tối đa 1,000 điểm gần nhất).
  6. Nếu Drone này đang là `activeDroneId` $\rightarrow$ Đẩy dữ liệu góc nghiêng và độ cao lên thanh công cụ Cockpit HUD.

---

## V. TỪ ĐIỂN TOÀN BỘ CẤU TRÚC DỮ LIỆU & KEY REDIS (DATA DICTIONARY)

---

### 1. BẢNG BĂM ÁNH XẠ ĐỊNH DANH (IDENTITY MAPPING HASHES)

#### 📌 Key 1: `drone:ip_map`
* **Kiểu dữ liệu:** `Hash`
* **Thời gian sống (TTL):** Vĩnh viễn (Persisted) – Cập nhật/Xóa theo vòng đời thiết bị.
* **Mục đích:** Ánh xạ từ **Địa chỉ IP WireGuard VPN $\rightarrow$ Mã định danh Drone (`deviceId`)**. Cho phép Go Ingest nhận diện danh tính Drone trong nano-giây từ gói tin UDP.
* **Cấu trúc lưu trữ:**
  ```redis
  HSET drone:ip_map "10.13.37.2" "DRONE-001"
  HSET drone:ip_map "10.13.37.3" "DRONE-002"
  ```
* **Các bên tương tác:**
  * ✍️ **Bên ghi (Writer):** NestJS [`DeviceService`](../provisioning-api/src/device/device.service.ts) hoặc Go [`IPResolver.SetMapping`](../telemetry-ingestion-service/internal/resolver/resolver.go).
  * 👁️ **Bên đọc (Reader):** Go [`IPResolver.ResolveIP`](../telemetry-ingestion-service/internal/resolver/resolver.go), NestJS [`WebSSHService`](../provisioning-api/src/web-ssh/web-ssh.service.ts), NestJS [`TelemetryService`](../provisioning-api/src/telemetry/telemetry.service.ts).

---

#### 📌 Key 2: `drone:sys_map`
* **Kiểu dữ liệu:** `Hash`
* **Thời gian sống (TTL):** Vĩnh viễn (Persisted).
* **Mục đích:** Ánh xạ phụ từ **MAVLink System ID (`sysid`) $\rightarrow$ Mã định danh Drone (`deviceId`)**. Dùng khi Drone bay qua trạm chuyển tiếp Relay hoặc SITL Simulator mà IP bị NAT.
* **Cấu trúc lưu trữ:**
  ```redis
  HSET drone:sys_map "1" "DRONE-001"
  HSET drone:sys_map "2" "DRONE-002"
  ```
* **Các bên tương tác:**
  * ✍️ **Bên ghi (Writer):** Go [`IPResolver.SetSysMapping`](../telemetry-ingestion-service/internal/resolver/resolver.go).
  * 👁️ **Bên đọc (Reader):** Go [`IPResolver`](../telemetry-ingestion-service/internal/resolver/resolver.go) và NestJS [`TelemetryService`](../provisioning-api/src/telemetry/telemetry.service.ts).

---

### 2. BẢNG BĂM TRẠNG THÁI TOÀN PHI ĐỘI (FLEET TELEMETRY STATE)

#### 📌 Key 3: `drone:states`
* **Kiểu dữ liệu:** `Hash`
* **Thời gian sống (TTL):** Vĩnh viễn (Ghi đè liên tục theo chu kỳ Micro-Batching 20ms).
* **Mục đích:** Lưu trữ **Snapshot trạng thái bay mới nhất của toàn bộ phi đội Drone** trong một Key duy nhất.
* **Cấu trúc lưu trữ:**
  * **Field:** `deviceId` (ví dụ `"DRONE-001"`).
  * **Value:** Chuỗi JSON chứa toàn bộ dữ liệu đo xa (`TelemetryPayload`).
  ```redis
  HSET drone:states "DRONE-001" '{"deviceId":"DRONE-001","connected":true,"armed":true,"flightMode":"GUIDED","battery":{"percentage":85,"voltageMv":15800},"gps":{"lat":21.005512,"lon":105.843120,"altRelativeM":50.2,"groundSpeedMs":12.5,"headingDeg":90},"attitude":{"rollDeg":1.2,"pitchDeg":-0.8,"yawDeg":90},"timestamp":1724410500123}'
  ```
* **Ưu điểm thiết kế:** Khi REST API cần lấy trạng thái của toàn bộ 100+ Drone, NestJS chỉ cần gọi duy nhất **1 lệnh `HGETALL drone:states`** ($< 1\text{ms}$) thay vì gửi 100 câu lệnh riêng lẻ.
* **Các bên tương tác:**
  * ✍️ **Bên ghi (Writer):** Go [`RedisPublisher.flushBatch`](../telemetry-ingestion-service/internal/publisher/redis.go).
  * 👁️ **Bên đọc (Reader):** NestJS [`TelemetryService.fetchRawFleetFromStorage`](../provisioning-api/src/telemetry/telemetry.service.ts).

---

### 3. TẬP HỢP THEO DÕI NHỊP TIM & DANH SÁCH FOCUS

#### 📌 Key 4: `drone:heartbeats`
* **Kiểu dữ liệu:** `Sorted Set (ZSET)`
* **Thời gian sống (TTL):** Vĩnh viễn (Score cập nhật liên tục theo Unix timestamp giây).
* **Mục đích:** Quản lý **Trạng thái Online / Offline (Liveness Index)** của toàn bộ phi đội siêu tốc ($O(\log N + M)$).
* **Cấu trúc lưu trữ:**
  * **Member:** `deviceId` (ví dụ `"DRONE-001"`).
  * **Score:** `Unix Timestamp` (giây).
  ```redis
  ZADD drone:heartbeats 1724410500 "DRONE-001"
  ```
* **Lệnh tra cứu thường dùng:**
  * Lọc Drone Online trong 10s: `ZRANGEBYSCORE drone:heartbeats (Now - 10) +inf`
  * Đếm số Drone đang bay: `ZCOUNT drone:heartbeats (Now - 10) +inf`
* **Các bên tương tác:**
  * ✍️ **Bên ghi (Writer):** Go [`RedisPublisher.flushBatch`](../telemetry-ingestion-service/internal/publisher/redis.go).
  * 👁️ **Bên đọc (Reader):** NestJS [`RedisService.getOnlineDeviceIds`](../provisioning-api/src/redis/redis.service.ts).

---

#### 📌 Key 5: `drone:focus_set`
* **Kiểu dữ liệu:** `Set (SET)`
* **Mục đích:** Lưu danh sách các Drone **đang có người xem chi tiết hoặc lái tay** để Go Ingest kích hoạt phát 20Hz Full (50ms).
* **Cấu trúc lưu trữ:**
  ```redis
  SADD drone:focus_set "DRONE-001"
  SREM drone:focus_set "DRONE-001"
  SMEMBERS drone:focus_set
  ```
* **Các bên tương tác:**
  * ✍️ **Bên ghi (Writer):** NestJS [`TelemetryGateway`](../provisioning-api/src/telemetry/telemetry.gateway.ts) & [`MavlinkRelayGateway`](../provisioning-api/src/telemetry/mavlink-relay.gateway.ts).
  * 👁️ **Bên đọc (Reader):** Go Ingestion [`RedisPublisher.syncFocusSetLoop`](../telemetry-ingestion-service/internal/publisher/redis.go).

---

### 4. KÊNH PHÁT SỰ KIỆN THỜI GIAN THỰC (PUB/SUB CHANNELS)

#### 📢 Channel 1: `channel:drone:telemetry:full:<deviceId>`
* **Kiểu dữ liệu:** `Pub/Sub Channel` (JSON)
* **Tần số:** **20Hz** (Phát khi Drone nằm trong `drone:focus_set`, khống chế theo `MAX_PUBLISH_RATE_HZ=20`).
* **Mục đích:** Luồng dữ liệu đo xa chi tiết (góc nghiêng 3D, vận tốc, la bàn, HUD, MAVLink) dành riêng cho Pilot đang Focus lái con đó.

---

#### 📢 Channel 2: `channel:drone:telemetry:lite:<deviceId>`
* **Kiểu dữ liệu:** `Pub/Sub Channel` (Compact JSON)
* **Tần số:** **1Hz** (Khống chế 1 lần/giây cho các Drone nền).
* **Mục đích:** Luồng dữ liệu tóm tắt siêu nhẹ (~70 bytes: GPS, % pin, mode) phục vụ hiển thị toàn bộ tiểu đội hoặc màn hình Super Admin.

---

#### 📢 Channel 3: `channel:drone:raw:full:<deviceId>`
* **Kiểu dữ liệu:** `Pub/Sub Channel (Raw Binary MAVLink v2 Buffer)`
* **Tần số:** **20Hz** (Khi Drone nằm trong Focus)
* **Mục đích:** Luồng byte nhị phân MAVLink v2 thô đẩy trực tiếp xuống **Pilot Bridge / QGroundControl** qua WebSocket nhị phân On-Demand (Cổng 10004).

---

#### 📢 Channel 4: `channel:drone:raw:lite:<deviceId>`
* **Kiểu dữ liệu:** `Pub/Sub Channel (Raw Binary MAVLink v2 Buffer)`
* **Tần số:** **1Hz** (Khống chế 1 lần/giây cho Drone nền).
* **Mục đích:** Luồng byte nhị phân MAVLink tóm tắt phục vụ tính năng Multi-Vehicle trên QGroundControl.

---

## VI. BẢNG TỔNG HỢP TRA CỨU NHANH (REDIS CHEAT SHEET)

| Tên Key / Channel | Kiểu dữ liệu | TTL | Bên Ghi (Writer) | Bên Đọc (Reader) | Mô tả chức năng thực tế hiện tại |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`drone:ip_map`** | `Hash` | Vĩnh viễn | NestJS / Go | Go / NestJS | Tra cứu: `VPN_IP` $\rightarrow$ `deviceId` (Ví dụ `10.13.37.2` $\rightarrow$ `DRONE-001`). |
| **`drone:sys_map`** | `Hash` | Vĩnh viễn | Go | Go / NestJS | Tra cứu: `MAVLink_SysID` $\rightarrow$ `deviceId` (Ví dụ `1` $\rightarrow$ `DRONE-001`). |
| **`drone:states`** | `Hash` | Vĩnh viễn | Go Ingest | NestJS API | Snapshot trạng thái toàn phi đội (Ghi qua Micro-Batching 20ms). |
| **`drone:heartbeats`** | `Sorted Set` | Vĩnh viễn | Go Ingest | NestJS API | Quản lý Liveness: Lọc siêu tốc Drone Online/Offline qua Score timestamp. |
| **`drone:focus_set`** | `Set` | Tức thời | NestJS Gateway | Go Ingest | Danh sách Drone đang có Pilot Focus để Go chuyển sang phát 20Hz Full. |
| **`channel:drone:telemetry:full:<id>`** | `Pub/Sub` | - | Go Ingest | NestJS WS | Luồng JSON chi tiết 20Hz cho Drone đang Focus. |
| **`channel:drone:telemetry:lite:<id>`** | `Pub/Sub` | - | Go Ingest | NestJS WS | Luồng JSON tóm tắt 1Hz siêu nhẹ cho tiểu đội / Admin. |
| **`channel:drone:raw:full:<id>`** | `Pub/Sub` | - | Go Ingest | NestJS Gateway | Luồng byte MAVLink thô 20Hz cho Pilot Bridge / QGroundControl. |
| **`channel:drone:raw:lite:<id>`** | `Pub/Sub` | - | Go Ingest | NestJS Gateway | Luồng byte MAVLink thô 1Hz cho QGroundControl Multi-Vehicle. |

---

## VII. CÁC LỆNH REDIS CLI THƯỜNG DÙNG ĐỂ DEBUG HỆ THỐNG

Khi SSH vào VPS, bạn có thể chạy `redis-cli` (mặc định cổng `6380`) để kiểm tra nhanh hệ thống:

```bash
# 1. Xem danh sách IP VPN đang ánh xạ với Drone nào
redis-cli -p 6380 HGETALL drone:ip_map

# 2. Lấy trạng thái bay tức thời của DRONE-001
redis-cli -p 6380 HGET drone:states DRONE-001

# 3. Lấy toàn bộ trạng thái của tất cả Drone đang hoạt động
redis-cli -p 6380 HGETALL drone:states

# 4. Lấy danh sách Drone đang ONLINE trong 10 giây qua
redis-cli -p 6380 ZRANGEBYSCORE drone:heartbeats (Now - 10) +inf

# 5. Xem danh sách các Drone đang được Focus lái tay
redis-cli -p 6380 SMEMBERS drone:focus_set

# 6. Lắng nghe luồng telemetry JSON Full 20Hz của DRONE-001
redis-cli -p 6380 SUBSCRIBE channel:drone:telemetry:full:DRONE-001

# 7. Lắng nghe luồng telemetry JSON Lite 1Hz của toàn bộ phi đội
redis-cli -p 6380 PSUBSCRIBE "channel:drone:telemetry:lite:*"

# 8. Lắng nghe luồng byte nhị phân thô MAVLink của DRONE-001
redis-cli -p 6380 --raw SUBSCRIBE channel:drone:raw:full:DRONE-001
```

---

## VIII. ĐỊNH HƯỚNG TỐI ƯU HIỆU NĂNG CHO HỆ THỐNG QUY MÔ LỚN (ROADMAP TIẾP THEO)

Lộ trình nâng cấp hạ tầng phần cứng và cụm đa máy chủ (xem chi tiết tại [`checklist_toi_uu_he_thong.md`](checklist_toi_uu_he_thong.md)):

1. **Tắt AOF Disk Persistence cho Telemetry (Task 1.7):** Chạy thuần In-Memory `--appendonly no` tránh nghẽn đĩa `fsync`.
2. **Kích hoạt Multi-Threading I/O & Tinh chỉnh Linux Kernel (Task 1.8):** Bật `io-threads 4` và cấu hình `vm.overcommit_memory = 1`.
3. **Kiến trúc Tách Đọc/Ghi & Sharded Pub/Sub Redis 7+ (Task 1.9):** Tách Master-Replica cho quy mô 50,000+ người dùng.
4. **Lọc Không Gian Chiến Thuật Redis Geospatial (Task 1.10):** Áp dụng `GEOADD drone:geo_positions` và `GEOSEARCH BYRADIUS` để chỉ phân phối tọa độ của các Drone nằm trong bán kính quan sát (AOI) của phi công.
