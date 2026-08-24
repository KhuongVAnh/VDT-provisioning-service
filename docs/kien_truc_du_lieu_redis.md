# TÀI LIỆU KIẾN TRÚC & TỪ ĐIỂN DỮ LIỆU REDIS
## (Từ Điển Toàn Bộ Redis Keys, Hashes, Strings & Pub/Sub Channels)

---

## I. TỔNG QUAN VAI TRÒ CỦA REDIS TRONG HỆ THỐNG

Trong hệ thống Cloud Provisioning & Telemetry, **Redis Server** (chạy tại cổng nội bộ `6379`/`6380`) đóng vai trò là **Trục Xương Sống Bộ Nhớ Tốc Độ Cao (High-Speed In-Memory Backbone)**, kết nối giữa:
1. **Dịch vụ nuốt dữ liệu bay ([`telemetry-ingestion-service`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/telemetry-ingestion-service) - Golang):** Ghi trạng thái và phát sự kiện ở tần số cao (10Hz – 50Hz).
2. **Cổng điều phối & API ([`provisioning-api`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/provisioning-api) - NestJS):** Đọc trạng thái tức thời và Subscribe luồng sự kiện để bắn tới Web Dashboard.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│               GOLANG WORKER (telemetry-ingestion-service - Ingest MAVLink)             │
└───────────────┬────────────────────────────────────────┬───────────────────────────────┘
                │ 1. HSET drone:states & drone:ip_map    │ 2. PUBLISH channel:drone:...
                ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                     REDIS SERVER                                        │
│   ┌────────────────────────────────────────┐  ┌─────────────────────────────────────┐   │
│   │ 🗄️ HASHES (Bảng Tra Cứu & Trạng Thái)  │  │ 📢 PUB/SUB (Kênh Sự Kiện Realtime) │   │
│   │ • drone:ip_map                         │  │ • channel:drone:telemetry:all       │   │
│   │ • drone:sys_map                        │  │ • channel:drone:telemetry:<id>      │   │
│   │ • drone:states                         │  │                                     │   │
│   │                                        │  │ ⏱️ STRINGS WITH TTL (Snapshot Riêng)│   │
│   │                                        │  │ • drone:state:<deviceId> (TTL 10s)  │   │
│   └───────────────────┬────────────────────┘  └─────────────────┬───────────────────┘   │
└───────────────────────┼─────────────────────────────────────────┼───────────────────────┘
                        │ HGET / HGETALL                          │ SUBSCRIBE
                        ▼                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        NESTJS BACKEND (provisioning-api Gateway)                       │
│                        • REST API: GET /api/v1/telemetry/fleet/states                  │
│                        • WebSocket: TelemetryGateway (Socket.IO 'telemetry:update')    │
│                        • Web-SSH  : Tra cứu IP kết nối Terminal                        │
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
  * ✍️ **Bên ghi (Writer):** NestJS [`DeviceService`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/provisioning-api/src/device/device.service.ts#L45) (khi cấp phát thiết bị mới) hoặc Go [`IPResolver.SetMapping`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/telemetry-ingestion-service/internal/resolver/resolver.go#L120).
  * 👁️ **Bên đọc (Reader):** Go [`IPResolver.ResolveIP`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/telemetry-ingestion-service/internal/resolver/resolver.go#L53), NestJS [`WebSSHService`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/provisioning-api/src/web-ssh/web-ssh.service.ts#L74), NestJS [`TelemetryService`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/provisioning-api/src/telemetry/telemetry.service.ts#L131).

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
  * ✍️ **Bên ghi (Writer):** Go [`IPResolver.SetSysMapping`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/telemetry-ingestion-service/internal/resolver/resolver.go#L134).
  * 👁️ **Bên đọc (Reader):** Go [`IPResolver`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/telemetry-ingestion-service/internal/resolver/resolver.go#L86) và NestJS [`TelemetryService`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/provisioning-api/src/telemetry/telemetry.service.ts#L132).

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
  * ✍️ **Bên ghi (Writer):** Go [`RedisPublisher.PublishTelemetry`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/telemetry-ingestion-service/internal/publisher/redis.go#L40).
  * 👁️ **Bên đọc (Reader):** NestJS [`RedisService.getAllTelemetryStates`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/provisioning-api/src/redis/redis.service.ts#L120) và [`TelemetryService.getAllFleetStates`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/provisioning-api/src/telemetry/telemetry.service.ts#L118).

---

### 3. CHUỖI SNAPSHOT RIÊNG TỪNG DRONE (STRING WITH TTL)

---

#### 📌 Key Pattern: `drone:state:<deviceId>` *(Ví dụ: `drone:state:DRONE-001`)*
* **Kiểu dữ liệu:** `String` (JSON)
* **Thời gian sống (TTL):** **`10 giây`** (Tự động biến mất nếu Drone mất kết nối).
* **Mục đích:** Lưu trữ bản chụp trạng thái của riêng một Drone. Key này có gắn thời gian sống (TTL), nếu Drone bị rơi hoặc mất sóng 4G quá 10 giây, Key sẽ tự động bị Redis xóa, đóng vai trò như một cơ chế **Heartbeat Liveness Check**.
* **Cấu trúc lưu trữ:**
  ```redis
  SET drone:state:DRONE-001 '{"deviceId":"DRONE-001",...}' EX 10
  ```
* **Các bên tương tác:**
  * ✍️ **Bên ghi (Writer):** Go [`RedisPublisher.PublishTelemetry`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/telemetry-ingestion-service/internal/publisher/redis.go#L44).
  * 👁️ **Bên đọc (Reader):** Dùng khi kiểm tra nhanh trạng thái đơn lẻ `GET drone:state:DRONE-001`.

---

### 4. KÊNH PHÁT SỰ KIỆN THỜI GIAN THỰC (PUB/SUB CHANNELS)

---

#### 📢 Channel 1: `channel:drone:telemetry:all`
* **Kiểu dữ liệu:** `Pub/Sub Channel` (Không lưu trữ dữ liệu, chỉ luân chuyển tin nhắn).
* **Mục đích:** Kênh phát sóng sự kiện tổng hợp cho **toàn bộ phi đội**. Mỗi khi bất kỳ Drone nào trong hệ thống gửi dữ liệu về, Go Worker sẽ bắn một tin nhắn JSON vào kênh này.
* **Payload tin nhắn:** Chuỗi JSON `TelemetryPayload` chuẩn hóa.
* **Các bên tương tác:**
  * 📢 **Bên phát (Publisher):** Go [`RedisPublisher`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/telemetry-ingestion-service/internal/publisher/redis.go#L51).
  * 👂 **Bên nhận (Subscriber):** NestJS [`TelemetryService.startRedisSubscription`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/provisioning-api/src/telemetry/telemetry.service.ts#L52). NestJS nhận tin nhắn và chuyển tiếp ngay lập tức sang Socket.IO (`telemetry:update`) để cập nhật lên Bản đồ Leaflet.

---

#### 📢 Channel 2: `channel:drone:telemetry:<deviceId>` *(Ví dụ: `channel:drone:telemetry:DRONE-001`)*
* **Kiểu dữ liệu:** `Pub/Sub Channel`
* **Mục đích:** Kênh phát sóng sự kiện riêng biệt cho **từng Drone cụ thể**. Phục vụ các microservice hoặc AI worker chỉ muốn theo dõi 1 Drone duy nhất mà không bị quá tải bởi dữ liệu của các Drone khác.
* **Các bên tương tác:**
  * 📢 **Bên phát (Publisher):** Go [`RedisPublisher`](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/telemetry-ingestion-service/internal/publisher/redis.go#L49).

---

## III. BẢNG TỔNG HỢP TRA CỨU NHANH (REDIS CHEAT SHEET)

| Tên Key / Channel | Kiểu dữ liệu | TTL | Bên Ghi (Writer) | Bên Đọc (Reader) | Mô tả chức năng |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`drone:ip_map`** | `Hash` | Vĩnh viễn | NestJS / Go | Go / NestJS | Tra cứu: `VPN_IP` $\rightarrow$ `deviceId` (Ví dụ `10.13.37.2` $\rightarrow$ `DRONE-001`). |
| **`drone:sys_map`** | `Hash` | Vĩnh viễn | Go | Go / NestJS | Tra cứu: `MAVLink_SysID` $\rightarrow$ `deviceId` (Ví dụ `1` $\rightarrow$ `DRONE-001`). |
| **`drone:states`** | `Hash` | Vĩnh viễn | Go Ingest | NestJS API | Lưu trữ Snapshot trạng thái toàn bộ phi đội (Field: `deviceId`, Value: JSON). |
| **`drone:state:<id>`** | `String` | 10s | Go Ingest | Go / CLI | Snapshot trạng thái riêng của 1 Drone kèm thời gian sống (TTL Heartbeat). |
| **`channel:drone:telemetry:all`** | `Pub/Sub` | - | Go Ingest | NestJS WS | Luồng sự kiện tổng phát cho toàn bộ Web Dashboard (Bản đồ Leaflet). |
| **`channel:drone:telemetry:<id>`** | `Pub/Sub` | - | Go Ingest | Microservices | Luồng sự kiện riêng phát cho người theo dõi 1 Drone duy nhất. |

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

# 4. Lắng nghe trực tiếp luồng telemetry realtime đang bắn qua Redis
redis-cli SUBSCRIBE channel:drone:telemetry:all

# 5. Kiểm tra thời gian sống còn lại của DRONE-001
TTL drone:state:DRONE-001
```
