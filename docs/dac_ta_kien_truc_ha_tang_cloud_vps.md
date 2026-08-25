# ĐẶC TẢ KIẾN TRÚC HẠ TẦNG MÁY CHỦ CLOUD VPS (SBCLOUD BACKEND)
## (Phân Lớp Dịch Vụ, Quản Lý Cổng Mạng Public/Private & Cơ Chế Giao Tiếp Nội Bộ)

> **Tài liệu Kỹ thuật Hạ Tầng Máy Chủ (Infrastructure Architecture Specification)**  
> **Áp dụng cho:** Hệ thống Cloud VPS (103.253.20.32), Docker Containers, Systemd Services và Mạng VPN WireGuard.  
> **Phiên bản:** 2.0.0  
> **Ngày cập nhật:** 25/08/2026  

---

## 1. TỔNG QUAN HẠ TẦNG MÁY CHỦ CLOUD VPS

Hạ tầng máy chủ trung tâm (Cloud VPS) đóng vai trò là "bộ não" điều phối toàn bộ luồng dữ liệu Telemetry MAVLink, Video FPV WebRTC, định tuyến mạng VPN và xác thực quyền sở hữu thiết bị bay:

* **Địa chỉ Public IP:** `103.253.20.32`
* **Hệ điều hành:** Ubuntu Server 22.04 / 24.04 LTS (x86_64).
* **Mô hình triển khai dịch vụ:** Kết hợp tối ưu giữa **Docker Compose (`network_mode: "host"`)** và **Native Linux Systemd Services**:
  1. **Dockerized Services (Docker Compose):**
     * `drone-postgres` (PostgreSQL 16 Alpine Database).
     * `drone-redis` (Redis 7.4 Alpine Message Broker & State Cache).
     * `drone-telemetry-ingestion` (Go High-Performance Telemetry Core).
     * `drone-provisioning-api` (NestJS API Gateway & Access Control).
  2. **Native Host Services (Systemd & Kernel Modules):**
     * `wireguard` (`wg0` Interface - Kernel Module quản lý mạng VPN Drone `10.13.37.0/24`).
     * `mediamtx` (MediaMTX Golang Native Streaming Server).

---

## 2. BẢNG PHÂN LOẠI CỔNG MẠNG (PUBLIC VS PRIVATE PORTS MATRIX)

Để đảm bảo nguyên tắc an toàn **Zero-Trust**, các cổng mạng trên VPS được phân định ranh giới nghiêm ngặt thành **Cổng Công Khai (Public)** và **Cổng Nội Bộ (Private/Internal)**:

| Tên Dịch Vụ / Thành Phần | Cổng Mạng (Port) | Giao Thức (Protocol) | Phạm Vi (Scope) | Ràng Buộc Địa Chỉ Lắng Nghe (Listen Interface) | Mục Đích Sử Dụng & Chi Tiết |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **NestJS API Gateway** | **`10004`** | **TCP** | 🌐 **PUBLIC** | `0.0.0.0:10004` | Cửa khẩu duy nhất mở ra Internet: REST API, Binary WebSocket `/mavlink`, WHEP Proxy, Web SSH. |
| **MediaMTX WebRTC Media**| **`10005`** | **UDP / TCP**| 🌐 **PUBLIC** | `0.0.0.0:10005` | Cổng Single-Port Multiplexing truyền nhận gói tin WebRTC Media (ICE STUN, DTLS, SRTP H.264). |
| **WireGuard VPN Server** | **`10006`** | **UDP** | 🌐 **PUBLIC** | `0.0.0.0:10006` | Cổng tiếp nhận kết nối mã hóa VPN từ các Drone Air Unit qua sóng 4G/5G. |
| **MediaMTX RTSP Ingest** | **`8554`** | **TCP / UDP**| 🔒 **PRIVATE**| `10.13.37.1:8554` *(Chỉ mở trên card mạng wg0)* | Tiếp nhận luồng video RTSP H.264 trực tiếp từ Camera Drone qua đường hầm VPN. |
| **MediaMTX WHEP API** | **`8889`** | **TCP** | 🔒 **PRIVATE**| `127.0.0.1:8889` *(Localhost VPS)* | Cổng Signaling WHEP nội bộ, chỉ cho phép NestJS Gateway gọi vào để trao đổi SDP Offer/Answer. |
| **MediaMTX HLS Server** | **`8888`** | **TCP** | 🔒 **PRIVATE**| `127.0.0.1:8888` *(Localhost VPS)* | Cung cấp luồng Low-Latency HLS phục vụ Web Dashboard (được NestJS proxy nội bộ). |
| **Redis Server** | **`6380`** | **TCP** | 🔒 **PRIVATE**| `127.0.0.1:6380` *(Localhost VPS)* | Message Broker luân chuyển bản tin MAVLink nhị phân và lưu trữ trạng thái bay OSD. |
| **PostgreSQL Database** | **`5432`** | **TCP** | 🔒 **PRIVATE**| `127.0.0.1:5432` *(Localhost VPS)* | Cơ sở dữ liệu quan hệ lưu trữ tài khoản, mật khẩu, danh mục Drone và quyền sở hữu. |
| **Go Telemetry Ingest** | **`14551`** | **UDP** | 🔒 **PRIVATE**| `0.0.0.0:14551` *(Nhận từ subnet 10.13.37.X)* | Lắng nghe các gói tin MAVLink v2 UDP thô từ Companion Computer của Drone gửi lên. |
| **Drone MAVLink Uplink** | **`14550`** | **UDP** | 🔒 **VPN MẠNG DRONE**| `10.13.37.X:14550` *(Nằm trên Drone)* | Cổng trên Drone để nhận lệnh điều khiển bay (Uplink) do NestJS Gateway bắn xuống. |
| **Drone SSH Maintenance**| **`22`** | **TCP** | 🔒 **VPN MẠNG DRONE**| `10.13.37.X:22` *(Nằm trên Drone)* | Cổng SSH bảo trì từ xa trên Drone, chỉ NestJS Web SSH Gateway mới có quyền mở kết nối. |

---

## 3. SƠ ĐỒ KIẾN TRÚC MẠNG NỘI BỘ TRÊN VPS

```text
                                        INTERNET CÔNG CỘNG
                  ┌──────────────────────────────┼──────────────────────────────┐
                  │ Gói tin WireGuard VPN UDP    │ Bắt tay WHEP & WebSocket TLS │ Gói tin WebRTC UDP/TCP
                  │ (Port 10006)                 │ (Port 10004)                 │ (Port 10005)
                  ▼                              ▼                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   HẠ TẦNG CLOUD VPS (103.253.20.32)                              │
│                                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ A. LINUX KERNEL WIREGUARD VPN GATEWAY (Interface: wg0 - IP: 10.13.37.1/24)                 │  │
│  │    • Tiếp nhận kết nối bảo mật từ Drone Air Unit (10.13.37.2, 10.13.37.3, 10.13.37.X...).    │  │
│  │    • Định tuyến cách ly toàn bộ luồng mạng Drone, không cho phép truy cập trái phép.      │  │
│  └───────┬───────────────────────────────┬───────────────────────────────┬────────────────────┘  │
│          │ [UDP Telemetry :14551]        │ [RTSP Video Stream :8554]     │ [UDP Uplink :14550]   │
│          ▼                               ▼                               ▲                       │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐      │                       │
│  │ 1. Go Telemetry Ingestion    │  │ 2. MediaMTX Streaming Engine │      │                       │
│  │    (Docker Host Mode)        │  │    (Native Systemd Service)  │      │                       │
│  │ • Lắng nghe UDP 14551        │  │ • Ingest RTSP: 10.13.37.1:8554│     │                       │
│  │ • Bóc tách OSD Telemetry     │  │ • Internal WHEP: 127.0.0.1:8889│    │                       │
│  │ • Xuất bản MAVLink thô       │  │ • WebRTC Media: 0.0.0.0:10005│      │                       │
│  └──────────────┬───────────────┘  └──────────────▲───────────────┘      │                       │
│                 │                                 │                      │                       │
│                 │ [Bắn bản tin RESP]              │ [HTTP Proxy SDP]     │                       │
│                 ▼                                 │                      │                       │
│  ┌──────────────────────────────┐                 │                      │                       │
│  │ 3. Redis Server (Port 6380)  │                 │                      │                       │
│  │    (Lắng nghe 127.0.0.1)     │                 │                      │                       │
│  │ • Channel: drone:raw:*       │                 │                      │                       │
│  │ • Hash: telemetry:all        │                 │                      │                       │
│  └──────────────┬───────────────┘                 │                      │                       │
│                 │                                 │                      │                       │
│                 │ [Pub/Sub Stream]                │                      │                       │
│                 ▼                                 │                      │                       │
│  ┌────────────────────────────────────────────────┴──────────────────────┴────────────────────┐  │
│  │ 4. NestJS API Gateway & Mission Controller (Docker Host Mode - Port 10004)                 │  │
│  │    • REST Controller: Xác thực Login, Register, Quản lý phân quyền Drone.                  │  │
│  │    • MavlinkRelayGateway: Subscribe Redis Pub/Sub $\rightarrow$ Bắn Binary WebSocket.      │  │
│  │    • VideoController: Kiểm tra JWT Token $\rightarrow$ Reverse Proxy SDP WHEP sang MediaMTX.│  │
│  │    • UplinkDispatcher: Nhận lệnh từ WebSocket $\rightarrow$ Bắn UDP sang 10.13.37.X:14550. │  │
│  │    • WebSshGateway: Cầu nối WebSocket sang SSH client 10.13.37.X:22.                       │  │
│  └──────────────┬─────────────────────────────────────────────────────────────────────────────┘  │
│                 │                                                                                │
│                 │ [Query SQL nội bộ 127.0.0.1:5432]                                              │
│                 ▼                                                                                │
│  ┌──────────────────────────────┐                                                                │
│  │ 5. PostgreSQL Database Server│                                                                │
│  │    (Lắng nghe 127.0.0.1:5432)│                                                                │
│  │ • Bảng Users, Drones, Tokens │                                                                │
│  └──────────────────────────────┘                                                                │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. CHI TIẾT CÁC LUỒNG GIAO TIẾP DỮ LIỆU NỘI BỘ (INTER-SERVICE FLOWS)

### 4.1. Luồng 1: Telemetry Downlink (Từ Drone lên Web Dashboard & Pilot Bridge)
1. **Chặng Drone $\rightarrow$ Go Ingestion:** Drone gửi các gói tin MAVLink v2 UDP thô tới `10.13.37.1:14551`.
2. **Chặng Go Ingestion $\rightarrow$ Redis:**
   * Go Ingestion Service đọc UDP, kiểm tra tính toàn vẹn (CRC).
   * Cập nhật tọa độ GPS, Pin, Trạng thái bay vào Redis Hash `telemetry:all` (phục vụ Web Dashboard).
   * Xuất bản nguyên vẹn dòng byte MAVLink nhị phân vào kênh Redis Pub/Sub `channel:drone:raw:<deviceId>`.
3. **Chặng Redis $\rightarrow$ NestJS $\rightarrow$ Client:**
   * `MavlinkRelayGateway` trong NestJS đăng ký `psubscribe('channel:drone:raw:*')`.
   * Khi có dữ liệu, NestJS kiểm tra danh sách kết nối WebSocket trong room của Drone đó và bắn dòng byte nhị phân qua WebSocket Port `10004` tới ứng dụng Pilot Bridge.

---

### 4.2. Luồng 2: Command Uplink (Từ QGroundControl xuống Drone)
1. **Chặng QGC $\rightarrow$ Pilot Bridge $\rightarrow$ NestJS:**
   * Phi công thao tác trên QGroundControl $\rightarrow$ gửi MAVLink qua TCP `127.0.0.1:5760` tới Pilot Bridge.
   * Pilot Bridge đóng gói byte nhị phân và gửi qua WebSocket `/mavlink` lên NestJS Gateway (Port 10004).
2. **Chặng NestJS $\rightarrow$ Drone:**
   * NestJS Gateway kiểm tra `DeviceOwnershipGuard` (xác thực quyền sở hữu của phi công với Drone đích).
   * Tra cứu bảng định tuyến IP VPN của Drone (`10.13.37.X`).
   * Sử dụng Native UDP Socket của Node.js (`dgram.createSocket`) bắn trực tiếp gói tin MAVLink tới cổng **`10.13.37.X:14550`** (cổng lắng nghe của MAVRouter trên Companion Computer của Drone).

---

### 4.3. Luồng 3: Video Streaming WebRTC WHEP (Bảo mật & Tốc độ cao)
1. **Chặng Ingest từ Drone:**
   * Camera Drone đẩy luồng H.264 qua RTSP tới `rtsp://10.13.37.1:8554/live/<deviceId>`.
   * MediaMTX tiếp nhận và chuyển đổi định dạng tức thời trong RAM (**Zero-Transcoding**).
2. **Chặng Bắt tay Signaling WHEP:**
   * Client gửi HTTP POST SDP Offer lên `POST http://103.253.20.32:10004/api/v1/video/<deviceId>/whep` kèm Bearer JWT Token.
   * NestJS Gateway xác thực quyền sở hữu Drone $\rightarrow$ gửi bản tin SDP Offer nội bộ tới `http://127.0.0.1:8889/live/<deviceId>/whep`.
   * MediaMTX sinh ra **SDP Answer** $\rightarrow$ NestJS trả lại SDP Answer cho Client.
3. **Chặng Truyền tải Media WebRTC:**
   * Client và MediaMTX thực hiện đục lỗ NAT ICE và bắt tay mã hóa DTLS 1.2 qua cổng công khai **`10005` (UDP)**.
   * MediaMTX truyền trực tiếp luồng SRTP H.264 tới Client với độ trễ `< 30ms`.

---

### 4.4. Luồng 4: Xác thực & Lưu trữ Dữ liệu (Database & Cache)
* NestJS Gateway kết nối tới PostgreSQL (`127.0.0.1:5432`) qua TypeORM/Prisma để quản lý người dùng, thiết bị bay và phân quyền.
* Mọi phiên đăng nhập sinh mã JWT Access Token có thời hạn.
* Danh mục Drone và trạng thái Online/Offline được cache tức thời trên Redis (`127.0.0.1:6380`) với cơ chế TTL (Time-To-Live) tự động hết hạn sau 30 giây nếu Drone mất kết nối mạng.

---

### 4.5. Luồng 5: Bảo trì & Quản trị Dòng lệnh (Web SSH Terminal)
* Quản trị viên mở giao diện Web SSH trên Dashboard.
* Trình duyệt mở WebSocket tới NestJS Gateway tại namespace `/ssh`.
* NestJS Gateway khởi tạo phiên SSH client nội bộ kết nối trực tiếp vào địa chỉ IP VPN của Drone (`10.13.37.X:22`).
* Kỹ sư có thể thao tác dòng lệnh, xem log máy bay thời gian thực mà hoàn toàn không cần mở port SSH 22 của Drone ra ngoài Internet.

---

## 5. CẤU HÌNH BẢO MẬT & TƯỜNG LỬA (FIREWALL & ROUTING)

Hạ tầng VPS áp dụng chính sách tường lửa **Chặn mặc định (Default Deny)** trên Linux UFW / Iptables:

```text
BẢNG QUY TẮC TƯỜNG LỬA (UFW FIREWALL RULES)
-------------------------------------------------------------------------
Cổng Mạng      Giao thức    Hành động        Ghi chú
-------------------------------------------------------------------------
22             TCP          ALLOW            Cổng SSH quản trị VPS (Giới hạn IP Admin)
10004          TCP          ALLOW            NestJS API Gateway & WebSocket
10005          UDP/TCP      ALLOW            MediaMTX WebRTC Single-Port Multiplexing
10006          UDP          ALLOW            WireGuard VPN Ingress cho Drone
80, 443        TCP          ALLOW            Nginx HTTP/HTTPS Web Dashboard
-------------------------------------------------------------------------
5432, 6380     TCP          DENY (BLOCKED)   Chặn hoàn toàn từ Internet (Chỉ nghe 127.0.0.1)
8554, 8888     TCP          DENY (BLOCKED)   Chặn hoàn toàn từ Internet (Chỉ nghe VPN/Local)
8889, 14551    TCP/UDP      DENY (BLOCKED)   Chặn hoàn toàn từ Internet
-------------------------------------------------------------------------
```

---

## 6. SỔ TAY KIỂM TRA & GIÁM SÁT TRẠNG THÁI VPS

Dành cho Quản trị viên và Kỹ sư vận hành hệ thống:

1. **Kiểm tra trạng thái toàn bộ Docker Containers:**
   ```bash
   docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
   ```
2. **Kiểm tra các cổng mạng đang mở lắng nghe trên VPS:**
   ```bash
   sudo ss -tulnp | grep -E "10004|10005|10006|8554|8889|6380|5432|14551"
   ```
3. **Xem nhật ký log thời gian thực của NestJS Gateway:**
   ```bash
   docker logs --tail 100 -f drone-provisioning-api
   ```
4. **Xem nhật ký log của MediaMTX Streaming Server:**
   ```bash
   sudo journalctl -u mediamtx -f -n 100
   ```
5. **Kiểm tra danh sách các Drone đang kết nối qua WireGuard VPN:**
   ```bash
   sudo wg show wg0
   ```
