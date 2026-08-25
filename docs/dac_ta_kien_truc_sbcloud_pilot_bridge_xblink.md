# ĐẶC TẢ KIẾN TRÚC TOÀN HỆ THỐNG SBCLOUD & Pilot Bridge
## (Hệ Sinh Thái Truyền Dẫn Telemetry MAVLink v2 & Video FPV WebRTC Siêu Tốc < 30ms)

> **Tài liệu Kỹ thuật Chuẩn Hóa Toàn Diện (Master Architecture Specification)**  
> **Áp dụng cho:** Toàn bộ hệ thống Drone Air Unit, Cloud Backend (SBCloud), Pilot Bridge Desktop Client và Trạm điều khiển mặt đất (QGroundControl / Mission Planner).  
> **Phiên bản:** 2.0.0  
> **Ngày cập nhật:** 25/08/2026  

---

## 1. TỔNG QUAN HỆ THỐNG VÀ BỐI CẢNH KIẾN TRÚC

### 1.1. Bối cảnh & Vấn đề Cốt lõi
* **QGroundControl (QGC)** và **Mission Planner (MP)** là các trạm điều khiển mặt đất (Ground Control Station - GCS) tiêu chuẩn công nghiệp trong ngành UAV. Tuy nhiên, các phần mềm này được thiết kế cho mạng nội bộ/sóng vô tuyến tầm gần, **hoàn toàn không có cơ chế xác thực danh tính (Authentication/JWT)** đối với luồng dữ liệu MAVLink và Video.
* Nếu máy chủ Cloud mở trực tiếp cổng TCP/UDP MAVLink hoặc RTSP công khai ra Internet:
  1. Bất kỳ ai cũng có thể kết nối xem trộm luồng hình ảnh camera nhạy cảm.
  2. Nguy cơ bị tấn công chèn lệnh bay giả mạo hoặc gửi nhầm lệnh sang Drone khác của người dùng khác, gây tai nạn rơi máy bay nghiêm trọng.

### 1.2. Mục tiêu Thiết kế Hệ thống
1. **Phân quyền & Cách ly Tuyệt đối (Zero-Trust Ownership):** Phi công chỉ có thể nhận Telemetry, xem Video FPV và gửi lệnh điều khiển tới đúng những chiếc Drone thuộc quyền sở hữu của mình.
2. **Tương thích GCS Gốc 100%:** Sử dụng nguyên bản QGroundControl/Mission Planner chính thức, không cần sửa mã nguồn hoặc cài đặt thêm plugin phức tạp.
3. **Độ trễ Siêu tốc (Ultra-Low Latency):**
   * MAVLink Telemetry 2 chiều: `< 30ms`.
   * Video FPV Live Stream: **`< 30ms`** (bằng chuẩn WebRTC WHEP UDP, nhanh gấp 100 lần so với HLS thông thường).
4. **Vận hành Một Chạm (One-Click Operation):** Phi công chỉ cần mở ứng dụng cầu nối **Pilot Bridge (Qt6 C++)** $\rightarrow$ Đăng nhập tài khoản $\rightarrow$ Bật QGroundControl bay ngay lập tức.

---

## 2. BỨC TRANH KIẾN TRÚC TOÀN TRÌNH (END-TO-END ARCHITECTURE)

Hệ thống được tổ chức thành **4 tầng độc lập** tạo thành một đường ống truyền dẫn dữ liệu khép kín:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 1. TẦNG THIẾT BỊ BAY (DRONE AIR UNIT)                  │
│                                                                                        │
│  ┌─────────────────────────┐          ┌─────────────────────────────────────────────┐  │
│  │ Pixhawk Autopilot (FC)  │          │ Companion Computer (Pi 4 / Jetson / Radxa)  │  │
│  │ • ArduPilot / PX4       │◄────────►│ • MAVRouter / MAVProxy (UDP 14550 / 14551)   │  │
│  │ • MAVLink v2 Telemetry  │  Serial  │ • GStreamer / V4L2 Hardware H.264 Encoder   │  │
│  └─────────────────────────┘          │ • WireGuard VPN Client (IP: 10.13.37.X)     │  │
│                                       └──────────────────────┬──────────────────────┘  │
└──────────────────────────────────────────────────────────────┼─────────────────────────┘
                                                               │ Đường hầm mã hóa VPN WireGuard
                                                               │ Subnet: 10.13.37.0/24 (UDP 10006)
                                                               ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              2. TẦNG HẠ TẦNG CLOUD (SBCLOUD BACKEND VPS)               │
│                                                                                        │
│  ┌────────────────────────┐   ┌───────────────────────────┐   ┌─────────────────────┐  │
│  │ WireGuard VPN Gateway  │   │  Go Ingestion Core Service│   │ MediaMTX Core Engine│  │
│  │ • Subnet: 10.13.37.1/24│   │  • Nhận UDP :14551        │   │ • RTSP Ingest :8554 │  │
│  │ • Cách ly mạng Drone   │   │  • Giải mã MAVLink v2     │   │ • WebRTC WHEP :8889 │  │
│  └───────────┬────────────┘   └─────────────┬─────────────┘   └──────────┬──────────┘  │
│              │                              │                            │             │
│              ▼                              ▼                            │             │
│  ┌────────────────────────────────────────────────────────┐              │             │
│  │               Redis In-Memory Message Broker           │              │             │
│  │ • Pub/Sub Channel: channel:drone:raw:<deviceId>        │              │             │
│  │ • JSON Hash Cache: telemetry:all / telemetry:drone:<id>│              │             │
│  └───────────────────────────┬────────────────────────────┘              │             │
│                              │                                           │             │
│                              ▼                                           │             │
│  ┌───────────────────────────────────────────────────────────────────────┴──────────┐  │
│  │ NestJS API Gateway & Access Guard (Cửa khẩu duy nhất ra Internet - Port 10004)   │  │
│  │ • JWT Authentication & DeviceOwnershipGuard (PostgreSQL Data Store)               │  │
│  │ • Binary WebSocket Gateway (/mavlink namespace) cho Telemetry 2 chiều             │  │
│  │ • WHEP Proxy Signaling Endpoint (POST /api/v1/video/:deviceId/whep)               │  │
│  │ • Web SSH Terminal Gateway (/ssh namespace) cho bảo trì từ xa                     │  │
│  └───────────────────────────────────┬───────────────────────────────────────────────┘  │
└──────────────────────────────────────┼──────────────────────────────────────────────────┘
                                       │ Kênh Internet Công cộng (Có xác thực JWT Token):
                                       │ 1. Binary WebSocket TLS (Port 10004 /mavlink)
                                       │ 2. WHEP Signaling HTTPS (Port 10004 /api/v1/video/...)
                                       │ 3. WebRTC Media Stream UDP (Port 10005)
                                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        3. TẦNG CẦU NỐI PHI CÔNG (Pilot Bridge)              │
│                                                                                        │
│  - Ứng dụng Desktop Qt6 C++ Native chạy trên máy trạm phi công (Ubuntu / Linux / WSL2). │
│  - Xác thực tài khoản Phi công qua REST API $\rightarrow$ Nhận danh sách Drone sở hữu.│
│  - [Bridge 1] Mở WebSocket nhận MAVLink nhị phân $\rightarrow$ Ghi vào TCP 127.0.0.1:5760│
│  - [Bridge 2] Bắt tay WHEP WebRTC qua libdatachannel $\rightarrow$ Bắn RTP sang UDP 5600│
│  - Cơ chế đa luồng không khóa (Zero-Copy Native Sockets), độ trễ bổ sung < 0.1ms.     │
└──────────────────────────────────────┬─────────────────────────────────────────────────┘
                                       │ Mạng Loopback Nội bộ (Kernel Localhost 127.0.0.1):
                                       │ • MAVLink Telemetry 2 chiều : TCP 127.0.0.1:5760
                                       │ • Video FPV RTP H.264       : UDP 127.0.0.1:5600
                                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         4. TẦNG TRẠM ĐIỀU KHIỂN (GROUND CONTROL STATION)               │
│                                                                                        │
│  [QGroundControl / Mission Planner (Gốc)]                                              │
│  • Comm Links : Kết nối TCP 127.0.0.1:5760 (Nhận HUD, bản đồ GPS, gửi lệnh bay)       │
│  • Video Stream: Mở cổng UDP 5600 (Hiển thị luồng Camera FPV trực tiếp siêu nét)       │
│  • Hoàn toàn không cần biết IP của VPS, không lo lộ port hay xung đột dữ liệu!         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. MA TRẬN PHÂN TẦNG CÁC GIAO THỨC TRUYỀN DẪN

Hệ thống kết hợp chặt chẽ nhiều giao thức mạng chuyên dụng cho từng chặng truyền tải:

| Chặng Truyền Dẫn | Giao Thức (Protocol) | Cổng Mạng (Port) | Định Dạng Dữ Liệu | Cơ Chế Bảo Mật / Xác Thực | Độ Trễ Ước Tính |
| :--- | :--- | :---: | :--- | :--- | :---: |
| **Drone $\rightarrow$ Cloud VPN** | **WireGuard VPN** | `10006` (UDP) | IP Packets (Lớp 3) | ChaCha20-Poly1305 + Curve25519 | `< 5ms` |
| **Drone Telemetry $\rightarrow$ Ingest** | **UDP MAVLink v2** | `14551` (UDP) | Binary MAVLink v2 Frame | Mã hóa đường hầm VPN | `< 2ms` |
| **Drone Video $\rightarrow$ Media Server**| **RTSP / RTP (H.264)** | `8554` (TCP/UDP) | H.264 NALUs qua RTP | Mã hóa đường hầm VPN | `< 10ms` |
| **Ingest $\rightarrow$ Message Broker** | **Redis RESP Protocol**| `6380` (TCP) | Raw Bytes / JSON Hash | Lắng nghe cục bộ `127.0.0.1` | `< 0.5ms` |
| **Cloud $\rightarrow$ Pilot (Telemetry)**| **WebSocket (Engine.IO)**| `10004` (TCP) | Binary WebSocket Frames | TLS + Bearer JWT Token | `< 20ms` |
| **Pilot $\rightarrow$ Cloud (Uplink)** | **WebSocket $\rightarrow$ UDP**| `10004` $\rightarrow$ `14550` | Binary MAVLink v2 | JWT Auth + Kiểm tra quyền sở hữu | `< 25ms` |
| **Pilot $\leftrightarrow$ Cloud (Signaling)** | **HTTP WHEP (RFC 8829)**| `10004` (TCP) | SDP Offer / SDP Answer | Bearer JWT Token + Quyền sở hữu | `< 50ms` (1 lần) |
| **Cloud $\rightarrow$ Pilot (Video)** | **WebRTC (SRTP/UDP)** | `10005` (UDP) | SRTP H.264 (RFC 6184) | DTLS 1.2 + SRTP Encryption | **`20ms – 30ms`** |
| **Pilot $\rightarrow$ QGC (Telemetry)** | **TCP Stream** | `127.0.0.1:5760` | Stream Byte MAVLink v2 | Loopback IPC Kernel | `< 0.05ms` |
| **Pilot $\rightarrow$ QGC (Video FPV)** | **Plain RTP over UDP** | `127.0.0.1:5600` | RTP H.264 Packets | Loopback IPC Kernel | `< 0.05ms` |

---

## 4. NGUYÊN LÝ HOẠT ĐỘNG CHI TIẾT CỦA CÁC GIAO THỨC CHỦ CHỐT

### 4.1. Giao thức MAVLink v2 (Micro Air Vehicle Communication Protocol)
MAVLink v2 là giao thức đóng gói nhị phân hướng thông điệp (Message-oriented Binary Protocol) tối ưu băng thông cho các hệ thống nhúng điều khiển bay.

```text
┌──────┬────────┬────────┬───────┬──────┬──────┬────────────┬─────────┬──────────────┬──────────┐
│ STX  │ LEN    │ INC_F  │ CMP_F │ SEQ  │ SYS  │ COMP       │ MSG_ID  │ PAYLOAD      │ CHECKSUM │
│ 0xFD │ 1 Byte │ 1 Byte │ 1 Byte│ 1Byte│ 1Byte│ 1 Byte     │ 3 Bytes │ 0 - 255 Byte │ 2 Bytes  │
└──────┴────────┴────────┴───────┴──────┴──────┴────────────┴─────────┴──────────────┴──────────┘
```

* **STX (`0xFD`):** Byte mở đầu đánh dấu phiên bản MAVLink v2 (khác với `0xFE` của MAVLink v1).
* **LEN:** Độ dài payload dữ liệu hữu ích.
* **INC_F & CMP_F:** Cờ tính năng tương thích và không tương thích (hỗ trợ ký số bảo mật Signature).
* **SEQ:** Số thứ tự gói tin (0 - 255) dùng để phát hiện rớt gói tin trên đường truyền mạng.
* **SYS & COMP ID:** Định danh của máy bay (System ID) và thành phần (Autopilot, Gimbal, Companion Computer).
* **MSG_ID (24-bit):** Mã loại thông điệp (ví dụ: `HEARTBEAT` = 0, `GLOBAL_POSITION_INT` = 33, `ATTITUDE` = 30, `COMMAND_LONG` = 76).
* **CHECKSUM (CRC-16-CCITT):** Mã kiểm tra tính toàn vẹn gói tin kết hợp với byte CRC Extra đặc thù của từng thông điệp.

---

### 4.2. Giao thức WebSocket & Socket.IO (Engine.IO v4)
Được sử dụng cho kênh Telemetry 2 chiều và Web SSH vì tính chất duy trì kết nối bền vững (Persistent Connection) và truyền nhận dữ liệu Full-Duplex với độ trễ cực thấp.

```text
Client (Pilot Bridge)                                     Server (NestJS Gateway :10004)
        │                                                               │
        │─────── 1. HTTP GET /socket.io/?EIO=4&transport=websocket ────►│ (Bắt tay HTTP Upgrade)
        │◄────── 2. HTTP 101 Switching Protocols (Upgrade to WS) ───────│
        │                                                               │
        │◄────── 3. Engine.IO Packet "0" (Handshake: pingInterval) ─────│ (Thiết lập phiên)
        │─────── 4. Socket.IO Packet "40/mavlink?token=JWT&droneId=..." ─►│ (Gia nhập Namespace)
        │◄────── 5. Socket.IO Packet "40/mavlink," (Join Success) ──────│
        │                                                               │
        │◄══════ 6. DÒNG GÓI TIN NHỊ PHÂN MAVLINK (BINARY STREAM) ══════│ (Downlink Telemetry)
        │══════► 7. DÒNG LỆNH ĐIỀU KHIỂN UPLINK (BINARY COMMAND) ═══════│ (Uplink Command)
        │                                                               │
        │─────── 8. Ping Frame ("2") ──────────────────────────────────►│ (Định kỳ kiểm tra mạng)
        │◄────── 9. Pong Frame ("3") ──────────────────────────────────│
```

* **Cơ chế Binary Framing:** Socket.IO v4 hỗ trợ truyền dữ liệu nhị phân trực tiếp (`QByteArray` / `Buffer`) mà không cần mã hóa Base64, giúp tiết kiệm 33% băng thông mạng và loại bỏ hoàn toàn độ trễ parse JSON.
* **Namespace Isolation (`/mavlink`):** Phân tách logic điều khiển bay độc lập với các sự kiện Web REST thông thường.

---

### 4.3. Giao thức WebRTC WHEP (WebRTC HTTP Egress Protocol - IETF RFC 8829)
WebRTC là giao thức thời gian thực hiện đại nhất thế giới hiện nay, sử dụng kiến trúc bảo mật 3 tầng kết hợp: **ICE (Đục lỗ NAT) $\rightarrow$ DTLS (Bắt tay mã hóa) $\rightarrow$ SRTP (Truyền tải Video).**

```text
Pilot Bridge (Client)               NestJS Gateway (:10004)         MediaMTX Server (:10005)
        │                                      │                               │
[1. WHEP Signaling]                            │                               │
        │─── HTTP POST /whep (SDP Offer) ─────►│                               │
        │    Header: Authorization: Bearer JWT │─── Chuyển tiếp SDP Offer ────►│
        │                                      │◄── Trả về SDP Answer ─────────│
        │◄── HTTP 200 OK (SDP Answer) ─────────│                               │
        │                                                                      │
[2. ICE STUN Hole Punching]                                                    │
        │══════ STUN Binding Request (0x0001 / ICE-CONTROLLING 0x802A) ═══════►│
        │◄═════ STUN Binding Response (0x0101 + XOR-MAPPED-ADDRESS) ═══════════│
        │                                                                      │
[3. DTLS 1.2 Handshake & Key Derivation]                                       │
        │══════ DTLS ClientHello ─────────────────────────────────────────────►│
        │◄═════ DTLS ServerHello, Certificate, ServerKeyExchange ══════════════│
        │══════ ClientKeyExchange, ChangeCipherSpec ──────────────────────────►│
        │       (Sinh cặp khóa mã hóa đối xứng SRTP Master Key trong RAM)      │
        │                                                                      │
[4. SRTP Media Stream & Chuyển tiếp RTP]                                       │
        │◄═════ Gói tin SRTP H.264 Đã Mã Hóa (UDP Port 10005) ═════════════════│
        │                                                                      │
   [libdatachannel Giải mã SRTP]                                               │
        │ $\rightarrow$ Trích xuất Plain RTP H.264 thô (RFC 6184)              │
        ▼                                                                      │
[5. Local UDP Forwarding]                                                      │
   ::sendto(127.0.0.1:5600)                                                    │
        ▼                                                                      │
 [QGroundControl]                                                              │
```

#### Các thành phần cốt lõi trong WebRTC:
1. **WHEP (WebRTC HTTP Egress Protocol):** Chuẩn hóa việc phân phối luồng WebRTC một chiều qua HTTP REST đơn giản, thay thế các cơ chế Signaling phức tạp cổ điển.
2. **ICE (Interactive Connectivity Establishment - RFC 8489):** Sử dụng các gói tin STUN đục lỗ qua các tầng tường lửa/NAT của mạng di động 4G/5G.
3. **DTLS 1.2 (Datagram Transport Layer Security - RFC 6347):** Thực hiện bắt tay trao đổi chứng chỉ bảo mật và sinh cặp khóa mã hóa đối xứng trực tiếp giữa Client và MediaMTX.
4. **SRTP (Secure Real-time Transport Protocol - RFC 3711):** Mã hóa toàn bộ gói tin video H.264 Payload ở tầng mạng.
5. **Cơ chế Keyframe on-demand (RTCP PLI - RFC 4585):** Định kỳ mỗi giây, Pilot Bridge gửi yêu cầu RTCP Picture Loss Indication (PLI) về Media Server để camera Drone lập tức nhả ra khung hình I-Frame (SPS/PPS), đảm bảo QGroundControl bắt được hình ảnh tức thì khi vừa mở phần mềm.

---

### 4.4. Giao thức WireGuard VPN
WireGuard là giao thức VPN thế hệ mới chạy trực tiếp bên trong Linux Kernel:
* **Thuật toán mật mã hiện đại:** ChaCha20 để mã hóa đối xứng, Poly1305 để xác thực dữ liệu, Curve25519 cho trao đổi khóa ECDH.
* **Định tuyến Subnet `10.13.37.0/24`:** Máy bay Drone kết nối vào mạng VPN như một máy tính trong mạng LAN nội bộ.
* **Tàng hình trước Internet:** WireGuard không phản hồi các gói tin quét cổng không có khóa hợp lệ, đảm bảo an toàn tuyệt đối cho thiết bị bay.

---

## 5. CƠ CHẾ BẢO MẬT & PHÂN QUYỀN SỞ HỮU (ZERO-TRUST)

Mọi yêu cầu truy cập từ phía Phi công đều phải vượt qua bộ lọc **`DeviceOwnershipGuard`** tại NestJS Gateway trước khi được cấp quyền tương tác:

```text
                             ┌──────────────────────────────────────┐
                             │    Yêu cầu từ Pilot Bridge / Web     │
                             │ (Kèm Header: Authorization / Token)  │
                             └──────────────────┬───────────────────┘
                                                │
                                                ▼
                             ┌──────────────────────────────────────┐
                             │       NestJS JwtAuthGuard            │
                             │ • Giải mã chữ ký số JWT Secret Key   │
                             │ • Trích xuất userId, email, role     │
                             └──────────────────┬───────────────────┘
                                                │
                                                ▼
                             ┌──────────────────────────────────────┐
                             │     DeviceOwnershipGuard             │
                             │ • Tra cứu PostgreSQL Database        │
                             │ • Kiểm tra quan hệ User <-> Drone    │
                             └──────────┬────────────────┬──────────┘
                                        │                │
                      [Khớp quyền sở hữu / Admin]   [Không khớp / Gian lận]
                                        │                │
                                        ▼                ▼
                         ┌─────────────────────┐  ┌─────────────────────┐
                         │ ✅ CẤP QUYỀN         │  │ 🚫 403 FORBIDDEN    │
                         │ • Subscribe MAVLink │  │ • Từ chối WebSocket │
                         │ • Chấp nhận WHEP SDP│  │ • Hủy phiên WebRTC  │
                         │ • Cho phép Uplink   │  │ • Chặn mở Web SSH   │
                         └─────────────────────┘  └─────────────────────┘
```

---

## 6. QUY TRÌNH VẬN HÀNH TOÀN TRÌNH CHO PHI CÔNG

1. **Khởi động Trạm Điều khiển:**
   * Mở ứng dụng **Pilot Bridge** trên máy tính Ubuntu $\rightarrow$ Nhập thông tin tài khoản $\rightarrow$ Bấm **Đăng nhập**.
2. **Chọn Máy bay:**
   * Danh sách các Drone thuộc quyền sở hữu của phi công sẽ hiển thị tự động.
   * Chọn Drone cần bay $\rightarrow$ Bấm **▶ BẬT CẦU NỐI MAVLINK** $\rightarrow$ Bấm **▶ BẬT VIDEO FPV**.
3. **Mở QGroundControl:**
   * Mở phần mềm QGroundControl (chạy song song trên cùng máy tính).
   * **Comm Links:** Đã cấu hình sẵn `TCP 127.0.0.1:5760` (Bấm Connect).
   * **Video:** Đã cấu hình sẵn `UDP 5600`.
4. **Tác chiến Bay:**
   * Thông số Telemetry, GPS, Pin, Độ cao và luồng Camera FPV trực tiếp hiển thị mượt mà trên QGroundControl với độ trễ `< 30ms`. Phi công sẵn sàng thực hiện các nhiệm vụ bay an toàn!
