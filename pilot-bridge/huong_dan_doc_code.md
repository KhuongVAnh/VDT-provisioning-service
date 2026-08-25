# 📡 ĐẶC TẢ GIAO THỨC & QUY TRÌNH BẮT TAY MẠNG (PILOT BRIDGE)
> **Dự án:** Pilot Bridge — Trạm Mặt Đất & Cầu Nối Video FPV Cho Drone  
> **Phiên bản tài liệu:** 2.0 (Toàn diện)  
> **Nội dung:** Đặc tả chi tiết từng bước bắt tay WebSocket Socket.IO v4 (MAVLink), WebRTC WHEP (Video FPV) và cơ chế chuyển tiếp cục bộ cho QGroundControl (Port 5760 & 5600).

---

## 🗺️ I. TỔNG QUAN LUỒNG DỮ LIỆU TOÀN HỆ THỐNG

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   HẠ TẦNG CLOUD VPS                                    │
│                                                                                        │
│   [Drone qua VPN: 10.13.37.X]                                                          │
│        │ (1) MAVLink UDP 14551 & RTSP Video 8554                                       │
│        ▼                                                                               │
│   ┌──────────────────────────────────────────────┐                                     │
│   │ Telemetry Ingestion (Go) & MediaMTX          │                                     │
│   │ • Redis Pub/Sub: channel:drone:raw:<id>      │                                     │
│   │ • WebRTC Media Server: UDP Port 10005        │                                     │
│   └──────────────────────┬───────────────────────┘                                     │
│                          │ (2) Trao đổi nội bộ                                         │
│                          ▼                                                             │
│   ┌──────────────────────────────────────────────┐                                     │
│   │ NestJS Business Gateway (Port 10004)         │                                     │
│   │ • Socket.IO Namespace: /mavlink              │                                     │
│   │ • WHEP Proxy Endpoint: /api/v1/video/:id/whep│                                     │
│   │ • Xác thực quyền sở hữu Drone qua JWT Token  │                                     │
│   └──────────────────────┬───────────────────────┘                                     │
└──────────────────────────┼─────────────────────────────────────────────────────────────┘
                           │ 
                           │ [Chỉ sử dụng 2 Cổng Public duy nhất: 10004 & 10005]
                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                PILOT BRIDGE (C++ QT6 TRÊN MÁY TRẠM LINUX / WSL)                        │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 1. TẦNG MAVLINK TELEMETRY (WebSocketClient.cpp)                                │   │
│   │ • Bắt tay Socket.IO v4 qua Port 10004 với Header Authorization JWT             │   │
│   │ • Nhận byte MAVLink Downlink ──► Mở TCP Server 127.0.0.1:5760 cho QGC          │   │
│   │ • Nhận lệnh bay Uplink từ QGC ──► Đóng gói sự kiện mavlink:uplink lên Cloud    │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 2. TẦNG VIDEO FPV STREAM (VideoRelayBridge.cpp)                                │   │
│   │ • Gửi SDP Offer qua HTTP POST Port 10004 (WHEP Protocol)                       │   │
│   │ • Đục lỗ ICE STUN & Bắt tay mã hóa DTLS 1.2 qua UDP Port 10005 (libdatachannel)│   │
│   │ • Giải mã SRTP thành RTP H.264 thô ──► Bắn socket ::sendto sang UDP 5600      │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬───────────────────────────────┬─────────────────────────────┘
                           │ TCP 127.0.0.1:5760            │ UDP 127.0.0.1:5600
                           ▼ (MAVLink Telemetry & Lệnh)    ▼ (RTP Video Stream)
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   TRẠM ĐIỀU KHIỂN MẶT ĐẤT (QGROUNDCONTROL CỤC BỘ)                      │
│   • Hiển thị thông số bay, GPS, Pin, Cảnh báo OSD trực tiếp trên giao diện.            │
│   • Giải mã phần cứng GPU luồng H.264 và render video FPV trên nền bản đồ bay.         │
│   • Truyền lệnh cất cánh, hạ cánh, bay theo lộ trình Waypoints tới Drone.              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📡 II. QUY TRÌNH KẾT NỐI & BẮT TAY GIAO THỨC WEBSOCKET (SOCKET.IO v4)

Module đảm nhiệm: [`src/bridge/WebSocketClient.cpp`](./src/bridge/WebSocketClient.cpp)

Do máy chủ Cloud sử dụng **NestJS WebSockets (Socket.IO v4)**, trong khi phía Qt sử dụng thư viện **`QWebSocket` thuần RFC 6455**, quá trình bắt tay và trao đổi dữ liệu tuân thủ nghiêm ngặt máy trạng thái của Engine.IO:

```text
  [Pilot Bridge (QWebSocket)]                             [NestJS Gateway (Port 10004)]
               │                                                        │
    (BƯỚC 1)   │─── 1. HTTP Upgrade: /socket.io/?EIO=4&transport=ws ───>│ (Xác thực JWT Token & DroneId)
               │                                                        │
    (BƯỚC 2)   │<── 2. Nhận gói tin "0{"sid":"...", "pingInterval":...}─│ (Engine.IO Open Handshake)
               │                                                        │
    (BƯỚC 3)   │─── 3. Gửi "40/mavlink," ──────────────────────────────>│ (Yêu cầu tham gia Namespace)
               │                                                        │
    (BƯỚC 4)   │<── 4. Nhận "40/mavlink,{"sid":"..."}" ─────────────────│ (Chấp thuận tham gia Room Drone)
               │                                                        │
               │════════════════════════════════════════════════════════│
               │         ★ KÊNH TRUYỀN DỮ LIỆU HOẠT ĐỘNG 2 CHIỀU        │
               │════════════════════════════════════════════════════════│
               │                                                        │
  [DOWNLINK]   │<── 5. "42/mavlink,["mavlink:downlink", [bytes...]]" ───│ (Dữ liệu bay từ Drone)
               │    (Giải mã byte thô -> Đẩy sang TCP 5760 cho QGC)     │
               │                                                        │
  [UPLINK]     │─── 6. "42/mavlink,["mavlink:uplink", [bytes...]]" ────>│ (Lệnh bay từ QGroundControl)
               │    (Đọc byte từ TCP 5760 -> Đóng gói gửi lên Cloud)    │
               │                                                        │
  [HEARTBEAT]  │<── 7. Nhận Ping "2" ───────────────────────────────────│
               │─── 8. Phản hồi Pong "3" ──────────────────────────────>│ (Giữ kết nối luôn sống)
               │                                                        │
```

### 🔹 Chi tiết 6 bước thực thi trong Code:

#### Bước 1: Xây dựng URL & Gắn Header an ninh
* Client chuẩn hóa URL theo chuẩn Engine.IO v4:
  `ws://103.253.20.32:10004/socket.io/?EIO=4&transport=websocket&token=<JWT>&droneId=<ID>`
* Gắn HTTP Header `Authorization: Bearer <JWT>` và `x-drone-id: <ID>` để Guard phía NestJS kiểm tra quyền sở hữu.
* Gọi `m_webSocket->open(request)`.

#### Bước 2: Bắt tay Engine.IO Open (`0...`)
* Khi kết nối TCP thành công, Server gửi về gói tin dạng text bắt đầu bằng số `0` chứa `sid`, `pingInterval` (25000ms), `pingTimeout` (20000ms).

#### Bước 3: Tham gia Namespace `/mavlink` (`40/mavlink,`)
* Ngay khi nhận được gói `0`, Client gửi ngay chuỗi text `40/mavlink,` để yêu cầu định tuyến vào kênh dữ liệu MAVLink của Drone.

#### Bước 4: Xác nhận kết nối thành công (`40/mavlink`)
* Server phản hồi `40/mavlink,...`. Client phát tín hiệu `connected()`, chuyển trạng thái Badge giao diện sang **🟢 ĐANG HOẠT ĐỘNG**.

#### Bước 5: Luồng truyền nhận dữ liệu Downlink & Uplink
* **Downlink (Gói `42/mavlink`):** Server gửi chuỗi JSON chứa mảng byte hoặc Base64. Client giải mã thành `QByteArray` nhị phân thô và phát tín hiệu `binaryDataReceived(data)`.
* **Uplink (Gửi lệnh bay):** Khi QGC gửi byte MAVLink vào TCP 5760, Client đóng gói thành chuỗi:
  `42/mavlink,["mavlink:uplink", [byte_0, byte_1, ...]]` và gửi qua `m_webSocket->sendTextMessage()`.

#### Bước 6: Cơ chế Heartbeat (Ping/Pong) & Tự động kết nối lại
* Khi nhận được gói tin `"2"` từ server $\rightarrow$ lập tức gửi lại `"3"` (Pong).
* Nếu mất kết nối (`onDisconnected`), Timer tự động kích hoạt thuật toán **Exponential Backoff** (1s, 2s, 4s, 8s... tối đa 15s) để kết nối lại liên tục cho đến khi thông mạng.

---

## 🎥 III. QUY TRÌNH BẮT TAY VIDEO FPV SIÊU TỐC WEBRTC WHEP

Module đảm nhiệm: [`src/video/VideoRelayBridge.cpp`](./src/video/VideoRelayBridge.cpp)  
Thư viện lõi: **`libdatachannel` (C++ WebRTC)**

WebRTC WHEP (WebRTC HTTP Egress Protocol - RFC 8829) loại bỏ hoàn toàn độ trễ giật hình (Head-of-Line Blocking) của TCP/HLS, đưa độ trễ video xuống mức tức thì **`< 30ms`**:

```text
  [Pilot Bridge (libdatachannel)]                          [NestJS Gateway :10004]           [MediaMTX Core :10005]
               │                                                      │                                │
    (BƯỚC 1)   │ 1. Tạo PeerConnection & Video Track (RecvOnly H.264) │                                │
               │ 2. Sinh SDP Offer & Thu thập ICE Candidates         │                                │
               │                                                      │                                │
    (BƯỚC 2)   │─── 3. HTTP POST /api/v1/video/:id/whep (SDP Offer) ─>│                                │
               │       (Content-Type: application/sdp, Bearer JWT)    │                                │
               │                                                      │─── 4. Chuyển tiếp sang WHEP ──>│
               │                                                      │        (127.0.0.1:8889)        │
               │                                                      │                                │
    (BƯỚC 3)   │<── 6. HTTP 200 OK (SDP Answer từ MediaMTX) ──────────│<── 5. Trả về SDP Answer ───────│
               │                                                      │    (Chứa IP Public :10005)     │
               │                                                      │                                │
               │═══════════════════════════════════════════════════════════════════════════════════════│
               │     ★ BƯỚC 4: THIẾT LẬP KÊNH TRUYỀN DỮ LIỆU THUẦN UDP TRỰC TIẾP (PORT 10005)          │
               │═══════════════════════════════════════════════════════════════════════════════════════│
               │                                                                                       │
    (BƯỚC 4)   │─── 7. Đục lỗ NAT ICE STUN Connectivity Check (Thuần UDP) ────────────────────────────>│
               │<── 8. STUN Binding Success Response ──────────────────────────────────────────────────│
               │                                                                                       │
    (BƯỚC 5)   │◄── 9. Bắt tay mã hóa bảo mật DTLS 1.2 Handshake (Đổi Key SRTP) ──────────────────────►│
               │                                                                                       │
    (BƯỚC 6)   │<══ 10. Luồng gói tin Video SRTP (H.264 Payload Type 96) ══════════════════════════════│
               │    (libdatachannel tự động giải mã thành gói tin RTP thô)                             │
               │                                                                                       │
               │──► 11. Bắn trực tiếp bằng BSD Socket ::sendto sang UDP 127.0.0.1:5600 (QGC)           │
```

### 🔹 Chi tiết các bước thực thi WebRTC:

1. **Khởi tạo Track:** Khởi tạo `rtc::Description::Video("video", rtc::Description::Direction::RecvOnly)` với Codec H.264 (Payload Type 96).
2. **Thu thập ứng viên ICE:** Đăng ký sự kiện `onGatheringStateChange`. Khi đạt trạng thái `Complete`, trích xuất toàn bộ `localDescription()` (SDP Offer).
3. **Bắt tay WHEP qua Gateway:** Gửi HTTP POST SDP Offer kèm JWT Token lên NestJS Gateway (Port 10004). NestJS kiểm tra quyền rồi forward sang `127.0.0.1:8889` của MediaMTX.
4. **Nạp SDP Answer:** Nhận SDP Answer từ Server qua HTTP 200 OK $\rightarrow$ gọi `m_peerConnection->setRemoteDescription()`.
5. **Đục lỗ NAT & Bắt tay DTLS 1.2:** `libdatachannel` tự động gửi gói tin STUN Check vào cổng UDP `10005` của Cloud VPS, hoàn tất bắt tay mã hóa DTLS 1.2 trong `< 25ms`.
6. **Xử lý gói RTP giải mã:** Gói tin SRTP được giải mã tức thời trong RAM thành RTP H.264 thô và chuyển vào callback `track->onMessage()`.

---

## 🔁 IV. CƠ CHẾ CHUYỂN TIẾP CỤC BỘ (LOCAL FORWARDING) CHO QGROUNDCONTROL

Sau khi dữ liệu MAVLink và Video FPV về đến máy trạm, ứng dụng thực hiện phân luồng chuyển tiếp cục bộ:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        PILOT BRIDGE LOCAL RELAY ENGINE                                 │
│                                                                                        │
│   [WebSocketClient] ──(MAVLink Packet)──► [LocalGcsServer] ──(TCP 5760)──► [QGC MAVLink]
│                                                                                        │
│   [VideoRelayBridge] ──(RTP H.264)──────► [Native ::sendto] ─(UDP 5600)─► [QGC Video]   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Kênh MAVLink Telemetry ([`LocalGcsServer.cpp`](./src/bridge/LocalGcsServer.cpp))
* **Khởi tạo Server:** Mở socket `QTcpServer` lắng nghe tại `0.0.0.0:5760`.
* **Kết nối đa điểm (Multi-client):** Khi QGroundControl kết nối vào `127.0.0.1:5760`, server chấp nhận socket và quản lý trong danh sách `m_clients`.
* **Chuyển tiếp Downlink:** Khi có gói tin từ Cloud, hàm `sendDataToGcs()` duyệt qua các client TCP đang kết nối và ghi thẳng mảng byte `client->write(data)`.
* **Chuyển tiếp Uplink:** Khi phi công thao tác trên QGC (Arm động cơ, chuyển chế độ bay, gán Waypoint), socket phát tín hiệu `readyRead` $\rightarrow$ đọc dữ liệu và gửi thẳng lên Cloud qua `m_cloudClient->sendBinaryData()`.

### 2. Kênh Video FPV Stream ([`VideoRelayBridge.cpp`](./src/video/VideoRelayBridge.cpp))
* **Zero-Transcoding & Non-blocking GUI:** Không giải mã video thành hình ảnh trên Pilot Bridge để tránh tốn CPU/RAM máy trạm.
* **Cơ chế Thread-safe với BSD Socket:**
  ```cpp
  // Khởi tạo socket UDP native của hệ điều hành
  m_rawUdpSock = ::socket(AF_INET, SOCK_DGRAM, 0);
  m_localQgcAddr.sin_family = AF_INET;
  m_localQgcAddr.sin_port = htons(5600);
  m_localQgcAddr.sin_addr.s_addr = inet_addr("127.0.0.1");

  // Trong Worker Thread của libdatachannel:
  track->onMessage([this](rtc::binary rtpPacket) {
      // Bắn trực tiếp gói RTP sang cổng 5600 của QGroundControl
      ::sendto(m_rawUdpSock, rtpPacket.data(), rtpPacket.size(), 0,
               (struct sockaddr *)&m_localQgcAddr, sizeof(m_localQgcAddr));
  });
  ```
* **Hiển thị trên QGroundControl:** QGroundControl lắng nghe tại `UDP 5600`, tự động sử dụng card đồ họa GPU của máy tính để giải mã luồng H.264 và vẽ trực tiếp khung hình FPV lên bản đồ tác chiến.

---

## 🧭 V. BẢNG THAM SỐ CẤU HÌNH KẾT NỐI

| Hạng mục | Địa chỉ / Cổng | Giao thức | Ghi chú cấu hình |
| :--- | :--- | :---: | :--- |
| **Cloud API Auth** | `http://103.253.20.32:10004` | HTTP REST | `POST /api/v1/auth/login` lấy JWT Token. |
| **Cloud MAVLink WS** | `ws://103.253.20.32:10004` | Socket.IO v4 | Namespace `/mavlink`, query `token` & `droneId`. |
| **Cloud Video WHEP** | `http://103.253.20.32:10004` | HTTP POST | `POST /api/v1/video/:id/whep` trao đổi SDP. |
| **Cloud WebRTC Media**| `103.253.20.32:10005` | UDP (DTLS/SRTP)| Kênh truyền dữ liệu hình ảnh độ trễ `< 30ms`. |
| **QGC Telemetry Link**| **`127.0.0.1:5760`** | **TCP** | Cài đặt trong QGC: *Comm Links* ➔ *TCP* ➔ `5760`. |
| **QGC Video Stream**  | **`127.0.0.1:5600`** | **UDP** | Cài đặt trong QGC: *Video Source* ➔ *UDP 5600*. |
