# TỔNG HỢP NGUYÊN NHÂN SỰ CỐ & PHƯƠNG ÁN GIẢI QUYẾT TRUYỀN VIDEO FPV

> **Dự án:** VDT Provisioning Service & Pilot Bridge  
> **Tác giả:** Đội ngũ Kỹ thuật Hệ thống  
> **Ngày cập nhật:** 25/08/2026  
> **Mục đích:** Đúc kết toàn bộ hành trình phân tích, debug và giải quyết các lỗi từ hạ tầng Cloud, mạng NAT đến ứng dụng Pilot Bridge và trạm điều khiển QGroundControl.

---

## 1. BỨC TRANH KIẾN TRÚC TỔNG THỂ

```text
┌──────────────────────────┐
│      DRONE CAMERA        │
│  (10.13.37.X WireGuard)  │
└─────────────┬────────────┘
              │ [1. Đẩy luồng RTSP H.264 qua VPN: 10.13.37.1:8554/live/<id>]
              ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   HẠ TẦNG CLOUD VPS (103.253.20.32)                    │
│                                                                        │
│  ┌─────────────────────────┐            ┌───────────────────────────┐  │
│  │   MediaMTX Core Server  │            │    NestJS Gateway API     │  │
│  │  • RTSP Ingest  : :8554 │            │  • Public Port   : 10004  │  │
│  │  • WebRTC WHEP  : :8889 │◄───────────│  • JWT & Ownership Guard  │  │
│  │  • WebRTC Media : :10005│            │  • WHEP Proxy Endpoint    │  │
│  └──────────┬──────────────┘            └─────────────▲─────────────┘  │
└─────────────┼─────────────────────────────────────────┼────────────────┘
              │                                         │ [2. Bắt tay WHEP qua Port 10004]
              │ [3. Gói tin UDP RTP/STUN qua Port 10005]│
              ▼                                         │
┌───────────────────────────────────────────────────────┴────────────────┐
│                   MÔI TRƯỜNG MÁY KHÁCH (PILOT STATION)                 │
│                                                                        │
│  [A. Web Dashboard (Trình duyệt)]   ──► Xem WebRTC mượt mà (< 30ms)    │
│                                                                        │
│  [B. Pilot Bridge (WSL2)]                                  │
│       │ • Bắt tay WHEP HTTP & Đục lỗ NAT STUN ICE qua Port 10005       │
│       │ • Bắn dòng UDP RTP sang Card mạng Windows Host                 │
│       ▼                                                                │
│  [C. QGroundControl (Windows Host)] ──► Nhận dòng Video FPV Port 5600   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. BẢNG TỔNG HỢP 6 NGUYÊN NHÂN CỐT LÕI & PHƯƠNG ÁN KHẮC PHỤC

| STT | Tên Sự Cố / Hiện Tượng | Nguyên Nhân Gốc (Root Cause) | Mức Độ | Trạng Thái & Giải Pháp |
| :---: | :--- | :--- | :---: | :--- |
| **1** | **Lệch chu kỳ khởi tạo (Race Condition) làm mất Telemetry MAVLink** | `MavlinkRelayGateway.afterInit()` chạy trước khi `RedisService` kịp kết nối, dẫn đến hàm lấy subscriber trả về `null` và Gateway không bao giờ subscribe kênh `channel:drone:raw:*`. | 🔴 Nghiêm trọng | ✅ **Đã xử lý:** Thêm hook `OnModuleInit` và cơ chế Auto-Retry Polling 500ms trong NestJS Gateway. |
| **2** | **Cấu hình sai địa chỉ IP trên QGroundControl Video Stream** | Nhập IP máy ảo WSL2 (`172.30.85.133:5600`) vào mục Video Settings của QGC trên Windows. Vì QGC là bên mở cổng lắng nghe (UDP Receiver) chứ không phải Client, Windows không sở hữu IP này nên báo lỗi bind socket. | 🟡 Trung bình | ✅ **Đã xử lý:** Hướng dẫn cấu hình chuẩn: Chỉ nhập duy nhất số cổng `5600` trên QGC. |
| **3** | **MediaMTX từ chối WHEP Offer với mã lỗi `HTTP 400 Bad Request`** | App Pilot Bridge gửi chuỗi `dummySdpOffer` chỉ có 10 dòng thô sơ, thiếu các trường bắt buộc của chuẩn RFC WebRTC (`ice-ufrag`, `ice-pwd`, `mid`, `BUNDLE`). | 🔴 Nghiêm trọng | ✅ **Đã xử lý:** Viết lại bộ sinh bản tin SDP Offer chuẩn RFC 8829 với đầy đủ thuộc tính WebRTC. |
| **4** | **Gói tin STUN đục lỗ NAT bị bắn nhầm vào IP nội bộ Datacenter (`10.1.10.189`)** | MediaMTX nằm sau mạng 1:1 NAT của Cloud nên gửi candidate mang IP nội bộ `10.1.10.189`. Pilot Bridge đọc candidate này và gửi gói tin vào IP nội bộ (không thể định tuyến ngoài Internet). | 🔴 Nghiêm trọng | ✅ **Đã xử lý:** Tích hợp bộ lọc RFC 1918, loại bỏ sạch IP `10.x` và ép buộc đích gửi UDP 100% về đúng IP Public `103.253.20.32:10005`. |
| **5** | **Gói STUN không được chấp nhận do xung đột Role ICE (`0x8029` vs `0x802A`)** | Dùng nhầm mã thuộc tính `0x8029` (`ICE-CONTROLLED`) thay vì `0x802A` (`ICE-CONTROLLING`) và thiếu bộ phản hồi ngược lại khi MediaMTX kiểm tra bắt tay 2 chiều. | 🔴 Nghiêm trọng | ✅ **Đã xử lý:** Cập nhật mã `0x802A` và triển khai tự động phản hồi bản tin `0x0101` kèm `XOR-MAPPED-ADDRESS` & HMAC-SHA1. |
| **6** | **Rào cản DTLS Handshake của WebRTC đối với ứng dụng Desktop Socket thuần** | WebRTC yêu cầu 3 tầng: ICE $\rightarrow$ DTLS $\rightarrow$ SRTP. Trình duyệt Web có sẵn engine WebRTC hoàn chỉnh, trong khi ứng dụng C++ socket thuần sau khi qua tầng STUN (11ms) thì bị kẹt ở tầng DTLS do chưa chạy bắt tay mã hoá TLS. | 🔴 Nghiêm trọng | ✅ **Đã xử lý hoàn hảo (Giải Pháp 1):** Tích hợp thư viện C++ **`libdatachannel`** trực tiếp vào `pilot-bridge`. Tự động hoá 100% ICE, DTLS Handshake và giải mã SRTP $\rightarrow$ Plain RTP, chuyển tiếp sang QGroundControl cổng UDP 5600 mà không cần mở thêm bất kỳ cổng nào trên VPS! |
| **7** | **QGroundControl báo "Waiting for Video" do Pilot Bridge bắn gói tin vào IP `N/A`** | Trong môi trường WSL2 mới (DNS Tunneling), đọc file `/etc/resolv.conf` trả về IP proxy `10.255.255.254` hoặc không hợp lệ, khiến hàm tìm IP Windows Host trả về `N/A` và app chỉ bắn UDP vào `127.0.0.1:5600` (bên trong WSL) thay vì Windows (`172.30.80.1:5600`). | 🔴 Nghiêm trọng | ✅ **Đã xử lý:** Sửa `getWindowsHostGateway()` đọc trực tiếp `/proc/net/route` bằng `std::ifstream` để lấy Default Gateway `172.30.80.1`, đồng thời lấy IP thực tế từ kết nối TCP MAVLink của QGC. |

---

## 3. CHI TIẾT CÁC SỰ CỐ VÀ BÀI HỌC KỸ THUẬT

### 3.1. Sự Cố 1: Lệch chu kỳ khởi tạo NestJS Redis Pub/Sub
* **Hiện tượng:** Web Dashboard hiển thị tọa độ GPS bay bình thường (nhờ kênh JSON `telemetry:all`), nhưng trạm điều khiển Pilot Bridge nhận `0 KB/s RX` (kênh nhị phân `raw:*` bị điếc).
* **Nhật ký log:**
  ```text
  [Nest] WARN [MavlinkRelayGateway] Redis Subscriber chưa sẵn sàng cho MAVLink Relay.
  [Nest] LOG [RedisService] Kết nối thành công tới Redis Server tại 127.0.0.1:6380
  ```
* **Giải pháp đã thực hiện:**  
  Bổ sung cờ `isRedisSubscribed` và cơ chế Polling tự động thử lại sau 500ms trong `initRedisSubscription()`. Khi Redis kết nối xong, Gateway sẽ tự động đăng ký `psubscribe('channel:drone:raw:*')`.

---

### 3.2. Sự Cố 2: Nhầm lẫn giữa TCP Client và UDP Receiver trên QGroundControl
* **Hiện tượng:** Người dùng điền `172.30.85.133:5600` vào ô Video của QGC nhưng không nhận được video.
* **Nguyên lý cốt lõi:**
  * **Kênh Telemetry (TCP):** QGC là **TCP Client** $\rightarrow$ Cần biết IP của WSL2 (`172.30.85.133`) để chủ động kết nối vào cổng `5760`.
  * **Kênh Video (UDP):** QGC là **UDP Receiver** $\rightarrow$ QGC chỉ cần mở cổng `5600` trên Windows. App Pilot Bridge trong WSL2 đã có sẵn code tự động tìm IP Windows (`172.30.80.1`) và bắn các gói tin RTP vào cổng `5600`.

---

### 3.3. Sự Cố 3 & 4: Đục lỗ NAT UDP và lọc sạch IP rác RFC 1918
* **Hiện tượng:** App báo đã bật Video nhưng lệnh `tcpdump -i any -n "udp port 10005"` trên VPS hoàn toàn không thấy gói tin nào bay tới.
* **Nguyên nhân:**
  * MediaMTX trả về SDP Answer: `a=candidate:... 10.1.10.189 10005`.
  * Pilot Bridge lấy nhầm IP `10.1.10.189` (IP nội bộ card mạng VPS) làm đích gửi. Gói tin gửi ra ngoài Internet bị các router mạng vứt bỏ.
* **Giải pháp đã thực hiện:**
  ```cpp
  // Luôn ép đích gửi UDP về Public IP của máy chủ
  QUrl serverQUrl(m_serverUrl);
  m_remoteMediaHost = serverQUrl.host(); // 103.253.20.32
  m_remoteMediaPort = 10005;
  ```
* **Kết quả:** Ngay sau khi sửa, `tcpdump` trên VPS đã bắt được chính xác 100% các gói tin UDP `104 bytes` gửi lên từ Client (`171.241.31.77`).

---

### 3.4. Sự Cố 5 & 6: Tầng bắt tay WebRTC (ICE vs DTLS)
* **Hiện tượng:**
  * Bắt tay STUN thành công rực rỡ trong **11ms**:
    `MediaMTX đã xác thực thành công STUN ICE Check! Bắt đầu tiếp nhận Video RTP...`
  * Nhưng sau đúng 10 giây, MediaMTX đóng phiên: `closed: deadline exceeded while waiting connection`.
* **Phân tích bản chất:**
  * Chuẩn WebRTC đòi hỏi sau khi đục lỗ ICE xong, hai bên phải thực hiện bắt tay **DTLS 1.2 Handshake** (ClientHello $\rightarrow$ ServerHello $\rightarrow$ Certificate $\rightarrow$ Key Derivation) để tạo khóa mã hóa SRTP.
  * Trình duyệt Web có sẵn bộ nhân WebRTC của Google làm điều này.
  * Ứng dụng Desktop C++ nếu chỉ dùng `QUdpSocket` thô thì không có tầng DTLS, dẫn đến MediaMTX chờ 10s không thấy DTLS nên hủy phiên.

---

### 3.5. Sự Cố 7: QGC "Waiting for Video" do Pilot Bridge bắn gói tin vào `Windows Host:5600 (N/A)`
* **Hiện tượng:** 
  * App nhận WebRTC thành công: `🟢 [WebRTC] PeerConnection & DTLS Handshake thành công! Đang nhận video SRTP...`
  * Nhận gói tin RTP 1200 bytes bình thường.
  * Nhưng QGroundControl trên Windows liên tục báo `Waiting for Video` và không có hình ảnh.
* **Nguyên nhân cốt lõi:**
  * Nhìn vào dòng log của App:
    `🎥 [WebRTC] Đích chuyển tiếp QGroundControl: UDP 127.0.0.1:5600 và Windows Host:5600 (N/A)`
  * Vì Windows Host là `(N/A)`, cờ `m_hasWinQgc = false`, App **chỉ bắn UDP vào `127.0.0.1:5600` (localhost bên trong máy ảo WSL2)** mà không hề bắn gói tin nào sang card mạng Windows (`172.30.80.1:5600`).
  * Nguyên nhân hàm `getWindowsHostGateway()` trả về `N/A` là do `/proc/` trong Linux là file hệ thống ảo, dùng `QTextStream::atEnd()` bị coi là hết file ngay lập tức; đồng thời `/etc/resolv.conf` trong WSL2 mới chứa IP proxy DNS `10.255.255.254` thay vì Gateway.
* **Giải pháp đã thực hiện:**
  * Dùng `std::ifstream` đọc `/proc/net/route` để lấy Default Gateway `172.30.80.1`.
  * Lấy trực tiếp IP của QGroundControl khi QGC kết nối MAVLink TCP vào `LocalGcsServer` (`172.30.80.1`).
  * Bắn đồng thời sang cả `127.0.0.1:5600` và `172.30.80.1:5600`.

---

## 4. BẢNG SO SÁNH CÁC GIAO THỨC TRUYỀN VIDEO CHO DRONE

| Tiêu Chí So Sánh | WebRTC (WHEP) | RTSP (Real-Time Streaming) | Low-Latency HLS | Thuần UDP RTP |
| :--- | :---: | :---: | :---: | :---: |
| **Độ trễ trung bình** | **`< 30ms`** (Siêu tốc) | **`30ms – 50ms`** (Cực thấp) | `1500ms – 3000ms` (Chậm) | **`< 20ms`** (Tức thì) |
| **Môi trường tối ưu nhất** | 🌐 **Trình duyệt Web (Dashboard)** | 🎮 **QGroundControl / VLC** | 📱 Smart TV / Di động | 🚀 Mạng LAN / Nội bộ |
| **Độ phức tạp kết nối** | Cao (Signaling + ICE + DTLS + SRTP) | **Thấp (TCP/UDP RTSP chuẩn)** | Thấp (HTTP Polling phân đoạn) | Rất thấp (Bắn gói tin UDP thô) |
| **Khả năng vượt NAT** | Cần Client-First UDP Hole Punching | Vượt NAT tốt qua TCP/UDP Port | Vượt mọi NAT qua HTTP 80/443 | Khó vượt Symmetric NAT |
| **Hỗ trợ trong QGC** | Không hỗ trợ trực tiếp | 🟢 **Hỗ trợ gốc 100% (GStreamer)** | Không hỗ trợ tốt | 🟢 Hỗ trợ qua Port 5600 |

---

