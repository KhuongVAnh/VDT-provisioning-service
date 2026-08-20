# TÀI LIỆU YÊU CẦU KỸ THUẬT & THIẾT KẾ KIẾN TRÚC
## Module: Core Telemetry Ingestion, Video Streaming (MediaMTX) & Web Remote Management

---

### I. BỐI CẢNH VÀ MỤC TIÊU DỰ ÁN (PROJECT CONTEXT & OBJECTIVES)

Dự án phát triển tầng **Core Streaming & Ingestion** cho nền tảng quản trị đội Drone công nghiệp (Industrial Drone Fleet Management), kế thừa trực tiếp hạ tầng mạng riêng ảo VPN WireGuard (`10.13.37.0/24`) và dịch vụ cấp phát tự động (`provisioning-api`) đã hoàn thành ở Phase 1.

#### 1. Mục tiêu cốt lõi:
1. **Dịch vụ nuốt và giải mã dữ liệu bay thời gian thực (MAVLink Ingestion Service):** Xây dựng bằng **Golang** để đảm bảo hiệu năng cao, độ trễ cực thấp (< 5ms), giải mã luồng UDP binary MAVLink v1/v2 từ hàng trăm drone đồng thời và đẩy dữ liệu chuẩn hóa vào **Redis (Pub/Sub & Key-Value State)**.
2. **Hạ tầng truyền hình ảnh thời gian thực (Ultra-Low Latency Video Streaming):** Triển khai **MediaMTX** làm Video Gateway, nhận luồng RTSP/H.264 từ camera drone qua mạng VPN và phát lại lên trình duyệt Web qua giao thức **WebRTC (WHEP)** với độ trễ dưới 300ms phục vụ bay BVLOS.
3. **Phân phối Telemetry & Bản đồ thời gian thực (Real-time Gateway):** Tích hợp WebSocket Gateway (NestJS) tiêu thụ dữ liệu từ Redis để hiển thị vị trí GPS, trạng thái bay (HUD, pin, độ cao, vận tốc, mode) trên bản đồ số.
4. **Truy cập dòng lệnh từ xa an toàn (Web-based SSH Terminal):** Cung cấp terminal Linux trực tiếp trên Dashboard quản trị thông qua `xterm.js` và SSH bridge, truy cập thẳng vào IP VPN `10.13.37.X:22` của từng drone mà không mở port ra ngoài Internet.

---

### II. RÀNG BUỘC HẠ TẦNG VÀ THÔNG SỐ HỆ THỐNG (INFRASTRUCTURE SPECS)

* **Hạ tầng VPN (WireGuard Subnet):** `10.13.37.0/24`.
  * Gateway / Server Cloud: `10.13.37.1`
  * Dải IP Drone được cấp phát: `10.13.37.2` – `10.13.37.254`
* **Cổng kết nối MAVLink Ingestion:** UDP `10.13.37.1:14550` (Nội bộ VPN).
* **Redis Server:** Port `6379` (Quản lý trạng thái tức thời `Hashes` và luồng sự kiện `Pub/Sub`).
* **MediaMTX Video Gateway:**
  * Port Ingest (RTSP nội bộ VPN): TCP/UDP `10.13.37.1:8554`
  * Port WebRTC WHEP (Egress ra trình duyệt Web): TCP `8889` (hoặc NAT qua port Gateway).
* **NestJS Business & API Gateway:** Lắng nghe tại TCP `10004` (Cung cấp REST API, WebSocket Gateway và Web-SSH Bridge).
* **SSH Service trên Drone:** TCP `10.13.37.X:22` (Chỉ cho phép truy cập từ Gateway `10.13.37.1`).

---

### III. THIẾT KẾ KIẾN TRÚC TỔNG THỂ (SYSTEM ARCHITECTURE)

```mermaid
flowchart TB
    subgraph EDGE_LAYER["1. TẦNG BIÊN (DRONE COMPANION COMPUTER)"]
        direction TB
        FC["Flight Controller (ArduPilot/PX4)"] -->|UART MAVLink 2| MR["mavlink-router (Pi 4)"]
        CAM["Pi Camera / USB Cam"] -->|H.264 Video Stream| GST["GStreamer Pipeline"]
        SSHD["SSH Daemon (:22)"]

        MR -->|UDP 14550| WG_EDGE["WireGuard Client (wg0: 10.13.37.X)"]
        GST -->|RTSP :8554| WG_EDGE
        SSHD --- WG_EDGE
    end

    subgraph VPN_LAYER["2. MẠNG RIÊNG ẢO BẢO MẬT (WIREGUARD VPN)"]
        WG_EDGE ===|UDP 10006 VPN Encrypted Tunnel| WG_SERVER["WireGuard Server (10.13.37.1)"]
    end

    subgraph BACKEND_LAYER["3. CLOUD BACKEND & PROCESSING PIPELINE"]
        direction TB
        WG_SERVER -->|UDP Stream :14550| GO_WORKER["Go MAVLink Ingestion Service<br/>(gomavlib + IP Resolver)"]
        WG_SERVER -->|RTSP :8554/live/ID| MMTX["MediaMTX Server<br/>(WebRTC Gateway)"]

        GO_WORKER -->|1. HSET drone:state:ID| REDIS_STATE[("Redis Cache<br/>(Latest State)")]
        GO_WORKER -->|2. PUBLISH telemetry:stream| REDIS_PUBSUB[("Redis Pub/Sub<br/>(Realtime Event)")]

        subgraph NEST_GW["NestJS API & Gateway (Port 10004)"]
            PROV_MOD["Provisioning Module (Phase 1)"]
            WS_GATEWAY["WebSocket Gateway (Socket.io)"]
            REST_API["REST Dashboard API"]
            SSH_BRIDGE["Web SSH Bridge (SSH2 Client)"]
        end

        REDIS_PUBSUB -->|Subscribe| WS_GATEWAY
        REDIS_STATE -->|Query Cache| REST_API
        SSH_BRIDGE -.->|SSH over VPN (10.13.37.X:22)| WG_SERVER
    end

    subgraph UI_LAYER["4. GIAO DIỆN ĐIỀU HÀNH TẬP TRUNG (MISSION CONTROL)"]
        direction TB
        MAP_VIEW["Bản đồ GPS & HUD Telemetry<br/>(Leaflet / MapLibre 2D-3D)"]
        VIDEO_PLAYER["WebRTC Video Player<br/>(WHEP Low-Latency < 300ms)"]
        TERM_UI["Web SSH Terminal<br/>(Xterm.js)"]
        DASH_UI["Fleet Management Dashboard"]

        WS_GATEWAY ==>|WebSocket Push (10Hz)| MAP_VIEW
        MMTX ==>|WebRTC WHEP Stream| VIDEO_PLAYER
        SSH_BRIDGE <==>|Bi-directional WS Stream| TERM_UI
        REST_API --> DASH_UI
    end
```

---

### IV. QUY CHUẨN DỮ LIỆU & MESSAGE CONTRACTS

#### 1. Định dạng JSON Telemetry chuẩn (Đẩy vào Redis Pub/Sub & Redis Hash)
```json
{
  "deviceId": "DRONE-10000000a1b2c3d4",
  "sysid": 1,
  "vpnIp": "10.13.37.5",
  "connected": true,
  "armed": true,
  "flightMode": "GUIDED",
  "battery": {
    "percentage": 88,
    "voltageMv": 15800,
    "currentCa": 1250
  },
  "gps": {
    "fixType": 3,
    "satellites": 14,
    "lat": 21.005512,
    "lon": 105.843120,
    "altRelativeM": 45.2,
    "altMslM": 55.4,
    "headingDeg": 135.0,
    "groundSpeedMs": 8.5
  },
  "attitude": {
    "rollDeg": 1.2,
    "pitchDeg": -3.4,
    "yawDeg": 135.0
  },
  "vfrHud": {
    "airspeedMs": 9.1,
    "climbRateMs": 0.5,
    "throttlePct": 45
  },
  "lastHeartbeat": 1771485600123,
  "timestamp": 1771485600123
}
```

#### 2. Chiến lược lưu trữ Redis:
* **Key trạng thái tức thời:** `drone:state:<deviceId>` (Type: `Hash` hoặc `JSON String` kèm TTL 30 giây để tự động đánh dấu offline nếu mất tín hiệu).
* **Bảng ánh xạ IP sang Device ID:** `drone:ip_map` (Type: `Hash`, Field: `10.13.37.X` -> Value: `DRONE-xxxx`).
* **Pub/Sub Channel:** `channel:drone:telemetry:<deviceId>` (Kênh riêng cho từng drone) và `channel:drone:telemetry:all` (Kênh tổng hợp cho toàn đội drone).

---

### V. KỊCH BẢN STREAMING VIDEO & WEB-SSH

#### 1. Luồng Video (MediaMTX):
* **Bên phía Drone (Raspberry Pi 4):**
  Chạy lệnh GStreamer mã hóa phần cứng H.264 và đẩy luồng RTSP về Cloud qua mạng VPN:
  ```bash
  gst-launch-1.0 v4l2src device=/dev/video0 ! video/x-raw,width=1280,height=720,framerate=30/1 ! \
    v4l2h264enc extra-controls="controls,h264_profile=1,video_bitrate=2000000" ! \
    h264parse ! rtspclientsink location=rtsp://10.13.37.1:8554/live/<DEVICE_ID>
  ```
* **Bên phía Cloud MediaMTX:**
  Cấu hình mở endpoint WHEP WebRTC tại đường dẫn `/live/<DEVICE_ID>/whep`.
* **Bên phía Trình duyệt:**
  Sử dụng thư viện WHEP client native gọi WebRTC SDP exchange với MediaMTX và gắn vào thẻ `<video autoplay muted></video>`.

#### 2. Luồng Web SSH Terminal:
* **Frontend:** Khởi tạo giao diện terminal với `xterm.js` và `fitAddon`. Mở kết nối WebSocket tới `ws://<SERVER_HOST>:10004/ws/ssh?deviceId=<DEVICE_ID>`.
* **Backend (NestJS Gateway):**
  * Tra cứu IP VPN của Drone (`10.13.37.X`).
  * Khởi tạo SSH client (`ssh2`) kết nối tới `10.13.37.X:22`.
  * Bắt cầu (Bridge) luồng dữ liệu 2 chiều giữa WebSocket client và SSH Pseudo-Terminal (PTY).

---

### VI. CHECKLIST TRIỂN KHAI CHI TIẾT (IMPLEMENTATION CHECKLIST)

```
[ ] GIAI ĐOẠN 1: GO MAVLINK INGESTION SERVICE (Core Worker)
    [ ] Khởi tạo dự án Go (go.mod, cấu trúc thư mục cmd/, internal/, pkg/).
    [ ] Tích hợp thư viện `gomavlib` để lắng nghe UDP socket 0.0.0.0:14550.
    [ ] Xây dựng cơ chế IP-to-Device Resolver (Tra cứu IP người gửi để gán đúng Device ID).
    [ ] Xử lý giải mã các tin nhắn MAVLink cốt lõi:
        - HEARTBEAT (#0): Base Mode, Custom Flight Mode, System Status.
        - GLOBAL_POSITION_INT (#33): Lat, Lon, Relative Alt, Heading, Speed.
        - SYS_STATUS (#1): Battery remaining %, Voltage, Current.
        - ATTITUDE (#30): Roll, Pitch, Yaw.
        - VFR_HUD (#74): Airspeed, Groundspeed, Climb rate, Throttle.
    [ ] Tích hợp Redis Client (go-redis):
        - Ghi trạng thái tức thời vào Redis Hash kèm TTL.
        - Bắn sự kiện JSON vào Redis Pub/Sub channel.
    [ ] Viết Unit Test cho bộ parser và test mô phỏng gửi gói tin MAVLink giả lập.

[ ] GIAI ĐOẠN 2: TÍCH HỢP REDIS & NESTJS WEBSOCKET GATEWAY
    [ ] Thêm Redis service vào docker-compose.yml.
    [ ] Xây dựng Telemetry Gateway trong NestJS sử dụng @nestjs/websockets.
    [ ] Đăng ký lắng nghe kênh Redis Pub/Sub và chuyển tiếp tức thời qua Socket.io tới Web Client.
    [ ] Cung cấp REST API:
        - GET /api/v1/telemetry/:deviceId/state (Lấy trạng thái tức thời từ Redis).
        - GET /api/v1/telemetry/fleet/states (Lấy trạng thái toàn bộ đội drone).

[ ] GIAI ĐOẠN 3: TRIỂN KHAI MEDIAMTX VIDEO STREAMING GATEWAY
    [ ] Cấu hình file mediamtx.yml tối ưu cho WebRTC/WHEP và RTSP.
    [ ] Thêm MediaMTX container vào docker-compose.yml.
    [ ] Viết script mẫu GStreamer / FFmpeg chạy trên Raspberry Pi 4 để test đẩy luồng RTSP.
    [ ] Tích hợp WHEP Video Player Component vào giao diện Web Dashboard.

[ ] GIAI ĐOẠN 4: XÂY DỰNG MODULE WEB SSH TERMINAL
    [ ] Cài đặt thư viện `ssh2` trên NestJS Backend.
    [ ] Xây dựng SSH WebSocket Gateway hỗ trợ tương tác Shell 2 chiều (Resize, PTY, Keystroke).
    [ ] Tích hợp giao diện `xterm.js` vào Web Mission Control Dashboard.
    [ ] Kiểm tra phân quyền SSH key và timeout session tự động.

[ ] GIAI ĐOẠN 5: GIAO DIỆN MISSION CONTROL DASHBOARD & E2E TESTING
    [ ] Cập nhật giao diện SPA: Tích hợp Bản đồ GPS thời gian thực (Leaflet / MapLibre), HUD góc nghiêng (Artificial Horizon), Video Stream và Tab Terminal SSH.
    [ ] Viết công cụ giả lập Drone (Drone Simulator / MAVLink Feeder) để kiểm thử tải toàn hệ thống (Stress test 50+ Drone).
    [ ] Hoàn thiện tài liệu hướng dẫn vận hành, triển khai Docker Compose và hướng dẫn cấu hình trên Drone.
```
