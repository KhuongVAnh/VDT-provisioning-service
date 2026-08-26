# TÀI LIỆU KIẾN TRÚC & TỪ ĐIỂN DỮ LIỆU REDIS
## (Từ Điển Toàn Bộ Redis Keys, Hashes, Strings & Pub/Sub Channels)

---

## I. TỔNG QUAN VAI TRÒ CỦA REDIS TRONG HỆ THỐNG

Trong hệ thống Cloud Provisioning & Telemetry, **Redis Server** (chạy tại cổng nội bộ `6379`/`6380`) đóng vai trò là **Trục Xương Sống Bộ Nhớ Tốc Độ Cao (High-Speed In-Memory Backbone)**, kết nối giữa:
1. **Dịch vụ nuốt dữ liệu bay ([`telemetry-ingestion-service`](../telemetry-ingestion-service) - Golang):** Ghi trạng thái và phát sự kiện ở tần số cao (10Hz – 50Hz).
2. **Cổng điều phối & API ([`provisioning-api`](../provisioning-api) - NestJS):** Đọc trạng thái tức thời và Subscribe luồng sự kiện để bắn tới Web Dashboard.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│               GOLANG WORKER (telemetry-ingestion-service - Ingest MAVLink)             │
│               • Micro-Batching Pipeline (Chu kỳ gom 20ms)                              │
└───────────────┬────────────────────────────────────────┬───────────────────────────────┘
                │ 1. HSET drone:states & ZADD heartbeats │ 2. PUBLISH channel:drone:...
                ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                     REDIS SERVER                                        │
│   ┌────────────────────────────────────────┐  ┌─────────────────────────────────────┐   │
│   │ 🗄️ HASHES & SETS & ZSETS               │  │ 📢 PUB/SUB (Kênh Sự Kiện Realtime) │   │
│   │ • drone:ip_map (Tra cứu IP WireGuard)  │  │ • channel:drone:telemetry:full:<id> │   │
│   │ • drone:sys_map (Tra cứu System ID)    │  │ • channel:drone:telemetry:lite:<id> │   │
│   │ • drone:states (Snapshot trạng thái)   │  │ • channel:drone:raw:full:<id>       │   │
│   │ • drone:heartbeats (ZSET Liveness 10s) │  │ • channel:drone:raw:lite:<id>       │   │
│   │ • drone:focus_set (Set Drone xem 20Hz) │  │                                     │   │
│   └───────────────────┬────────────────────┘  └─────────────────┬───────────────────┘   │
└───────────────────────┼─────────────────────────────────────────┼───────────────────────┘
                        │ HGETALL / SADD / SREM / ZRANGE          │ SUBSCRIBE (On-Demand)
                        ▼                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        NESTJS BACKEND (provisioning-api Gateway)                       │
│                        • L1 In-Memory Cache (RAM Node.js 500ms) + SingleFlight         │
│                        • REST API: GET /api/v1/telemetry/fleet/states (0ms Redis Lat)  │
│                        • WebSocket: TelemetryGateway (Socket.IO 'telemetry:update')    │
│                        • WebSocket: MavlinkRelayGateway (On-Demand Binary MAVLink Relay)│
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## II. TỪ ĐIỂN CHI TIẾT TỪNG KEY & CẤU TRÚC DỮ LIỆU REDIS

### 1. BẢNG BĂM ÁNH XẠ ĐỊNH DANH (IDENTITY MAPPING HASHES)

---

#### 📌 Key 1: `drone:ip_map`
* **Kiểu dữ liệu:** `Hash`
* **Thời gian sống (TTL):** Vĩnh viễn (Persisted) – Cập nhật/Xóa theo vòng đời thiết bị.
* **Mục đích:** Bảng tra cứu ánh xạ nhanh từ **Địa chỉ IP WireGuard VPN $\rightarrow$ Mã định danh Drone (`deviceId`)**. Khi Drone gửi gói tin UDP nhị phân lên server, Golang Ingestion Service chỉ nhìn thấy IP nguồn (ví dụ `10.13.37.2`), nhờ bảng này sẽ biết ngay đó là `DRONE-001` trong thời gian nano-giây mà không cần truy vấn Database.
* **Cấu trúc lưu trữ:**
  ```redis
  HSET drone:ip_map "10.13.37.2" "DRONE-001"
  HSET drone:ip_map "10.13.37.3" "DRONE-002"
  ```
* **Các bên tương tác:**
  * ✍️ **Bên ghi (Writer):** NestJS [`DeviceService`](../provisioning-api/src/device/device.service.ts) (khi cấp phát thiết bị mới) hoặc Go [`IPResolver.SetMapping`](../telemetry-ingestion-service/internal/resolver/resolver.go).
  * 👁️ **Bên đọc (Reader):** Go [`IPResolver.ResolveIP`](../telemetry-ingestion-service/internal/resolver/resolver.go), NestJS [`WebSSHService`](../provisioning-api/src/web-ssh/web-ssh.service.ts), NestJS [`TelemetryService`](../provisioning-api/src/telemetry/telemetry.service.ts).

---

#### 📌 Key 2: `drone:sys_map`
* **Kiểu dữ liệu:** `Hash`
* **Thời gian sống (TTL):** Vĩnh viễn (Persisted).
* **Mục đích:** Bảng ánh xạ phụ từ **MAVLink System ID (`sysid`) $\rightarrow$ Mã định danh Drone (`deviceId`)**. Dùng khi Drone bay qua trạm chuyển tiếp Relay hoặc SITL Simulator mà IP bị NAT.
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

---

#### 📌 Key 3: `drone:states`
* **Kiểu dữ liệu:** `Hash`
* **Thời gian sống (TTL):** Vĩnh viễn (Nội dung từng field được ghi đè liên tục theo tần số nhận tin MAVLink).
* **Mục đích:** Lưu trữ **Snapshot trạng thái bay mới nhất của toàn bộ phi đội Drone** trong một Key duy nhất.
* **Cấu trúc lưu trữ:**
  * **Field:** `deviceId` (ví dụ `"DRONE-001"`, `"DRONE-002"`).
  * **Value:** Chuỗi JSON chứa toàn bộ dữ liệu đo xa (`TelemetryPayload`).
  ```redis
  HSET drone:states "DRONE-001" '{"deviceId":"DRONE-001","connected":true,"armed":true,"flightMode":"GUIDED","battery":{"percentage":85},"gps":{"lat":21.005,"lon":105.843,"altRelativeM":50.2,"groundSpeedMs":12.5,"headingDeg":90},"attitude":{"rollDeg":1.2,"pitchDeg":-0.8},"timestamp":1724410500123}'
  ```
* **Ưu điểm thiết kế:** Khi Web Dashboard cần lấy trạng thái của toàn bộ 100+ Drone, NestJS chỉ cần gọi duy nhất **1 lệnh `HGETALL drone:states`** (thực thi dưới 1ms) thay vì phải gửi 100 câu lệnh riêng lẻ.
* **Các bên tương tác:**
  * ✍️ **Bên ghi (Writer):** Go [`RedisPublisher.PublishTelemetry`](../telemetry-ingestion-service/internal/publisher/redis.go).
  * 👁️ **Bên đọc (Reader):** NestJS [`RedisService.getAllTelemetryStates`](../provisioning-api/src/redis/redis.service.ts) và [`TelemetryService.getAllFleetStates`](../provisioning-api/src/telemetry/telemetry.service.ts).

---

### 3. TẬP HỢP THEO DÕI NHỊP TIM & DANH SÁCH FOCUS

---

#### 📌 Key 1: `drone:heartbeats`
* **Kiểu dữ liệu:** `Sorted Set (ZSET)`
* **Thời gian sống (TTL):** Vĩnh viễn (Score cập nhật liên tục theo Unix timestamp).
* **Mục đích:** Quản lý **Trạng thái Online / Offline (Liveness Index)** của toàn bộ phi đội siêu tốc ($O(\log N + M)$) mà không cần tạo hàng ngàn key String riêng lẻ.
* **Cấu trúc lưu trữ:**
  * **Member:** `deviceId` (ví dụ `"DRONE-001"`).
  * **Score:** `Unix Timestamp` (thời điểm nhận tin gần nhất).
  ```redis
  ZADD drone:heartbeats 1724410500 "DRONE-001"
  ```
* **Lệnh tra cứu thường dùng:**
  * Lọc Drone Online trong 10s: `ZRANGEBYSCORE drone:heartbeats (Now - 10) +inf`
  * Đếm số Drone đang bay: `ZCOUNT drone:heartbeats (Now - 10) +inf`

---

#### 📌 Key 2: `drone:focus_set`
* **Kiểu dữ liệu:** `Set (SET)`
* **Mục đích:** Lưu danh sách các Drone **đang có Pilot/Admin Focus xem chi tiết hoặc lái tay** (để Go Ingestion kích hoạt phát luồng 10Hz Full, còn các Drone khác tự động ép xuống 1Hz Lite).
* **Cấu trúc lưu trữ:**
  ```redis
  SADD drone:focus_set "DRONE-001"
  SREM drone:focus_set "DRONE-001"
  SMEMBERS drone:focus_set
  ```
* **Các bên tương tác:**
  * ✍️ **Bên ghi (Writer):** NestJS [`TelemetryGateway`](../provisioning-api/src/telemetry/telemetry.gateway.ts) và [`MavlinkRelayGateway`](../provisioning-api/src/telemetry/mavlink-relay.gateway.ts).
  * 👁️ **Bên đọc (Reader):** Go Ingestion [`RedisPublisher`](../telemetry-ingestion-service/internal/publisher/redis.go).

---

### 4. KÊNH PHÁT SỰ KIỆN THỜI GIAN THỰC (PUB/SUB CHANNELS)

---

#### 📢 Channel 1: `channel:drone:telemetry:full:<deviceId>`
* **Kiểu dữ liệu:** `Pub/Sub Channel` (JSON)
* **Tần số:** **10Hz** (Phát khi Drone nằm trong `drone:focus_set`).
* **Mục đích:** Luồng dữ liệu đo xa chi tiết (góc nghiêng 3D, vận tốc, la bàn, HUD, MAVLink) dành riêng cho Pilot đang Focus lái con đó.

---

#### 📢 Channel 2: `channel:drone:telemetry:lite:<deviceId>`
* **Kiểu dữ liệu:** `Pub/Sub Channel` (Compact JSON)
* **Tần số:** **1Hz** (Phát định kỳ 1 lần/giây cho các Drone nền).
* **Mục đích:** Luồng dữ liệu tóm tắt siêu nhẹ (~70 bytes: GPS, % pin, mode) phục vụ hiển thị toàn bộ tiểu đội hoặc màn hình Super Admin (`PSUBSCRIBE channel:drone:telemetry:lite:*`).

---

#### 📢 Channel 3: `channel:drone:raw:full:<deviceId>`
* **Kiểu dữ liệu:** `Pub/Sub Channel (Raw Binary MAVLink v2 Buffer)`
* **Tần số:** **10Hz – 20Hz**
* **Mục đích:** Luồng byte nhị phân MAVLink v2 thô đẩy trực tiếp xuống **Pilot Bridge / QGroundControl** qua WebSocket nhị phân On-Demand (Cổng 10004).

---

#### 📢 Channel 4: `channel:drone:raw:lite:<deviceId>`
* **Kiểu dữ liệu:** `Pub/Sub Channel (Raw Binary MAVLink v2 Buffer)`
* **Tần số:** **1Hz**
* **Mục đích:** Luồng byte nhị phân MAVLink tóm tắt (chỉ chứa Heartbeat & GPS) phục vụ tính năng Multi-Vehicle trên QGroundControl.

---

## III. BẢNG TỔNG HỢP TRA CỨU NHANH (REDIS CHEAT SHEET)

| Tên Key / Channel | Kiểu dữ liệu | TTL | Bên Ghi (Writer) | Bên Đọc (Reader) | Mô tả chức năng thực tế hiện tại |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`drone:ip_map`** | `Hash` | Vĩnh viễn | NestJS / Go | Go / NestJS | Tra cứu: `VPN_IP` $\rightarrow$ `deviceId` (Ví dụ `10.13.37.2` $\rightarrow$ `DRONE-001`). |
| **`drone:sys_map`** | `Hash` | Vĩnh viễn | Go | Go / NestJS | Tra cứu: `MAVLink_SysID` $\rightarrow$ `deviceId` (Ví dụ `1` $\rightarrow$ `DRONE-001`). |
| **`drone:states`** | `Hash` | Vĩnh viễn | Go Ingest | NestJS API | Snapshot trạng thái toàn phi đội (Ghi qua Micro-Batching 20ms). |
| **`drone:heartbeats`** | `Sorted Set` | Vĩnh viễn | Go Ingest | NestJS API | Quản lý Liveness: Lọc siêu tốc Drone Online/Offline qua Score timestamp. |
| **`drone:focus_set`** | `Set` | Tức thời | NestJS Gateway | Go Ingest | Danh sách Drone đang có Pilot Focus để Go chuyển sang phát 10Hz Full. |
| **`channel:drone:telemetry:full:<id>`** | `Pub/Sub` | - | Go Ingest | NestJS WS | Luồng JSON chi tiết 10Hz cho Drone đang Focus. |
| **`channel:drone:telemetry:lite:<id>`** | `Pub/Sub` | - | Go Ingest | NestJS WS | Luồng JSON tóm tắt 1Hz siêu nhẹ cho tiểu đội / Admin. |
| **`channel:drone:raw:full:<id>`** | `Pub/Sub` | - | Go Ingest | NestJS Gateway | Luồng byte MAVLink thô 10-20Hz cho Pilot Bridge / QGroundControl. |
| **`channel:drone:raw:lite:<id>`** | `Pub/Sub` | - | Go Ingest | NestJS Gateway | Luồng byte MAVLink thô 1Hz cho QGroundControl Multi-Vehicle. |

---

## IV. CÁC LỆNH REDIS CLI THƯỜNG DÙNG ĐỂ DEBUG HỆ THỐNG

Khi SSH vào VPS, bạn có thể chạy `redis-cli` để kiểm tra nhanh hệ thống:

```bash
# 1. Xem danh sách IP VPN đang ánh xạ với Drone nào
HGETALL drone:ip_map

# 2. Lấy trạng thái bay tức thời của DRONE-001
HGET drone:states DRONE-001

# 3. Lấy toàn bộ trạng thái của tất cả Drone đang hoạt động
HGETALL drone:states

# 4. Lấy danh sách Drone đang ONLINE trong 10 giây qua
ZRANGEBYSCORE drone:heartbeats (Now - 10) +inf

# 5. Xem danh sách các Drone đang được Focus
SMEMBERS drone:focus_set

# 6. Lắng nghe luồng telemetry JSON Full 10Hz của DRONE-001
redis-cli SUBSCRIBE channel:drone:telemetry:full:DRONE-001

# 7. Lắng nghe luồng telemetry JSON Lite 1Hz của toàn bộ phi đội
redis-cli PSUBSCRIBE "channel:drone:telemetry:lite:*"

# 8. Lắng nghe luồng byte nhị phân thô MAVLink của DRONE-001
redis-cli --raw SUBSCRIBE channel:drone:raw:full:DRONE-001
```

---

## V. ĐỊNH HƯỚNG TỐI ƯU HIỆU NĂNG CHO HỆ THỐNG QUY MÔ LỚN (ROADMAP TIẾP THEO)

Lộ trình nâng cấp hạ tầng phần cứng và cụm đa máy chủ (xem chi tiết tại [`checklist_toi_uu_he_thong.md`](checklist_toi_uu_he_thong.md)):

1. **Tắt AOF Disk Persistence cho Telemetry (Task 1.7):** Chạy thuần In-Memory `--appendonly no` tránh nghẽn đĩa `fsync`.
2. **Kích hoạt Multi-Threading I/O & Tinh chỉnh Linux Kernel (Task 1.8):** Bật `io-threads 4` và cấu hình `vm.overcommit_memory = 1`.
3. **Kiến trúc Tách Đọc/Ghi & Sharded Pub/Sub Redis 7+ (Task 1.9):** Tách Master-Replica cho quy mô 50,000+ người dùng.



