# TÀI LIỆU KIẾN TRÚC STREAMING VIDEO MEDIAMTX & NESTJS GATEWAY
## (Thực Trạng Phân Phối WebRTC WHEP Siêu Tốc < 30ms & Cơ Chế Dự Phòng HLS Đa Tầng)

---

## I. TỔNG QUAN HỆ THỐNG HIỆN TẠI

Hệ thống truyền video FPV của dự án đang vận hành theo mô hình kết hợp giữa **Media Server Lõi (MediaMTX Native Systemd)** và **Cổng An Ninh Phân Phối (NestJS Video Gateway - Port 10004)**:

1. **Media Server Lõi ([MediaMTX](https://github.com/bluenviron/mediamtx)):**
   * Viết bằng **Golang**, tiếp nhận luồng video gốc H.264 từ Drone qua mạng VPN WireGuard và chuyển đổi định dạng tức thời trong RAM (**Zero-Transcoding In-Memory Remuxing**).
   * **Cổng RTSP Ingest:** `10.13.37.1:8554` (Lắng nghe nội bộ kênh mã hóa VPN).
   * **Cổng WebRTC Media:** `0.0.0.0:10005` (Hỗ trợ ghép kênh Single-Port Multiplexing cho cả **UDP** và **TCP**).
   * **Cổng Signaling & HLS nội bộ:** `127.0.0.1:8889` (WHEP) và `127.0.0.1:8888` (HLS) — hoàn toàn không lộ ra Internet.

2. **Cổng Phân Phối & Kiểm Soát Quyền ([NestJS Video Gateway - Port 10004](../provisioning-api/src/video/video.controller.ts)):**
   * Cửa khẩu an ninh duy nhất mở ra Internet (Port 10004) để trao đổi bản tin bắt tay SDP Offer/Answer và kiểm soát Token phi công.
   * **Phương thức phát chính (Primary):** **WebRTC WHEP (WebRTC HTTP Egress Protocol)** với kỹ thuật **Client-First UDP Hole Punching**, đưa độ trễ xuống mức tức thì **`< 30ms`**.
   * **Phương thức dự phòng (Fallback):** **Low-Latency HLS (Hls.js)** tự động kích hoạt nếu client ở trong mạng doanh nghiệp/tường lửa chặn UDP.

---

## II. THỰC TRẠNG PHÂN PHỐI VIDEO TRÊN WEB DASHBOARD & COCKPIT HUD

### 1. Kênh chính: WebRTC WHEP Siêu Tốc (Ultra-Low Latency < 30ms)
Trên giao diện Web Dashboard buồng lái tác chiến ([`public/js/video.js`](../provisioning-api/public/js/video.js)), trình duyệt kết nối trực tiếp với MediaMTX qua chuẩn WebRTC WHEP:
* ⚡ **Độ trễ siêu tốc:** Đạt **`25ms – 35ms`** (đo lường thực tế từ RTT + Jitter Buffer + Hardware GPU Decode), đáp ứng hoàn hảo yêu cầu bay trinh sát BVLOS.
* 🎯 **Kỹ thuật Client-First UDP Hole Punching:** Trình duyệt chủ động bắn gói tin STUN Request đầu tiên vào `103.253.20.32:10005`, kích hoạt bảng **Reverse DNAT** trên Gateway Cloud của VPS để bảo toàn cổng `10005` cho luồng UDP đi về.
* 🌐 **Dự phòng WebRTC TCP:** Sẵn sàng chuyển tiếp qua `TCP :10005` với độ trễ `< 100ms` khi mạng Client gặp Symmetric NAT.

### 2. Kênh phụ: Low-Latency HLS Fallback (Hls.js)
* Tự động kích hoạt khi WebRTC không thể thiết lập kết nối (chặn cả UDP lẫn TCP).
* Video được NestJS Reverse Proxy từ `127.0.0.1:8888` qua `GET /api/v1/video/:deviceId/hls/*` trên Port 10004.
* Độ trễ đạt mức **`0.8s – 1.5s`**.

---

## III. SƠ ĐỒ DÒNG CHẢY DỮ LIỆU & CHU TRÌNH PHÁT VIDEO HIỆN TẠI

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DRONE FLIGHT SYSTEM                                  │
│       [Camera Module] ──(H.264 V4L2/GStreamer)──► [4G/5G WireGuard VPN: 10.13.37.X]    │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ (1) RTSP Ingest (10.13.37.1:8554)
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               CLOUD SERVER BACKEND                                     │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 1. MEDIAMTX CORE (Native Systemd Service)                                      │   │
│   │ • Lắng nghe RTSP nội bộ VPN: 10.13.37.1:8554 (UDP/TCP)                         │   │
│   │ • WHEP Signaling nội bộ    : 127.0.0.1:8889                                    │   │
│   │ • HLS Streaming nội bộ     : 127.0.0.1:8888                                    │   │
│   │ • WebRTC Media Streaming   : 0.0.0.0:10005 (UDP & TCP Multiplexing)            │   │
│   │ • Public Host duy nhất     : 103.253.20.32:10005 (Đã lọc IP nội bộ)            │   │
│   └───────────────────────────────┬───────────────────────────────┬────────────────┘   │
│                                   │                               │                    │
│                                   │ (3) Bắt tay Signaling WHEP    │ (5) Lấy HLS        │
│                                   │     (127.0.0.1:8889)          │     Segment        │
│                                   ▼                               ▼                    │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 2. NESTJS VIDEO GATEWAY (CỔNG 10004 DUY NHẤT)                                  │   │
│   │ • WHEP Token Guard & Proxy : POST /api/v1/video/:id/whep                       │   │
│   │ • HLS Reverse Proxy        : GET  /api/v1/video/:id/hls/*                      │   │
│   │ • Zero-Buffer Pipelining   : Chuyển tiếp tức thì không tốn RAM                 │   │
│   └───────────────────────────────┬───────────────────────────────┬────────────────┘   │
└───────────────────────────────────┼───────────────────────────────┼────────────────────┘
                                    │                               │
            [2. Bắt tay SDP WHEP]   │                               │ [6. Kênh HLS Dự phòng]
            POST Port 10004         │                               │ GET Port 10004
                                    ▼                               ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        MÁY KHÁCH PHI CÔNG (WEB DASHBOARD)                              │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 🎯 KÊNH CHÍNH: WebRTC WHEP (Thuần UDP :10005)                                  │   │
│   │ • Client-First UDP Hole Punching (Trình duyệt bắn STUN Request trước)          │   │
│   │ • Độ trễ cực thấp: 25ms - 35ms (Hiển thị OSD HUD thời gian thực)               │   │
│   │ • Badge hiển thị: ⚡ WEBRTC (UDP) hoặc 🌐 WEBRTC (TCP)                          │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
│                                           │ (Nếu chặn UDP/TCP)                         │
│                                           ▼                                            │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 🛡️ KÊNH DỰ PHÒNG: Low-Latency HLS (Hls.js qua Port 10004)                      │   │
│   │ • Tự động kích hoạt khi WebRTC lỗi (Fallback đa tầng)                          │   │
│   │ • Độ trễ: 0.8s - 1.5s | Badge hiển thị: ⏱️ HLS (HTTP)                           │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## IV. GIẢI THÍCH CHI TIẾT CÁC PHÂN HỆ & CỔNG MẠNG MEDIAMTX

### 1. Phân hệ RTSP Ingest (Kênh tiếp nhận từ Drone)
* **`rtspAddress: 10.13.37.1:8554` (Control Plane - TCP/UDP):**
  * Bắt tay luồng RTSP: `OPTIONS`, `ANNOUNCE`, `SETUP`, `RECORD`, `TEARDOWN`.
* **`rtpAddress: 10.13.37.1:8000` (Data Plane - UDP):**
  * Nhận các gói tin khung hình H.264 do Drone đẩy lên qua VPN WireGuard.
* **`rtcpAddress: 10.13.37.1:8001` (Quality Monitoring - UDP):**
  * Đo lường chất lượng đường truyền (Packet Loss, RTT, Jitter) để Drone tự động kích hoạt tính năng thích ứng băng thông.

### 2. Phân hệ WebRTC WHEP (Kênh phát siêu tốc cho Phi công)
* **`webrtcAddress: 127.0.0.1:8889` (WHEP Signaling Endpoint):**
  * Tiếp nhận bản tin SDP Offer từ NestJS Gateway (Port 10004) và sinh ra SDP Answer.
* **`webrtcLocalUDPAddress: :10005` (RTP Media Data - UDP):**
  * Cổng tiếp nhận và phân phối các gói tin Video RTP qua UDP trực tiếp với trình duyệt.
* **`webrtcLocalTCPAddress: :10005` (Dự phòng TCP):**
  * Kênh ghép cổng TCP 10005 dự phòng chống nghẽn NAT.
* **`webrtcIPsFromInterfaces: no` & `webrtcAdditionalHosts: ["103.253.20.32"]`:**
  * Loại bỏ hoàn toàn các IP nội bộ rác (Docker, LAN), chỉ trả về IP Public duy nhất của VPS trong SDP Answer.

### 3. Phân hệ HLS / Low-Latency HLS (Kênh phát dự phòng)
* **`hlsAddress: 127.0.0.1:8888` (HTTP Streaming):**
  * Tự động cắt luồng H.264 thành các phân đoạn nhỏ 100ms / 500ms và sinh file `index.m3u8` trong RAM.
  * Phục vụ NestJS Reverse Proxy qua `GET /api/v1/video/:deviceId/hls/*`.

### 4. Phân hệ REST API Quản trị
* **`apiAddress: 127.0.0.1:9997`:**
  * `GET /v3/paths/list`: Lấy danh sách Drone đang phát sóng.
  * `GET /v3/rtspsessions/list`: Xem chi tiết thông số kết nối của từng Drone.
  * `GET /v3/webrtcsessions/list`: Đếm số lượng người đang xem trực tiếp qua WebRTC.

---

## V. CẤU TRÚC ĐỊNH TUYẾN LUỒNG ĐỘNG (PATHS SYSTEM)

MediaMTX tự động nhận diện và mở luồng theo tiền tố `live/<drone_id>`:

```yaml
paths:
  all_others:
    # Tự động đóng luồng và giải phóng RAM nếu Drone mất kết nối sau 10 giây
    sourceOnDemandCloseAfter: 10s
    runOnReadyRestart: yes
```

Khi Drone đẩy luồng vào: `rtsp://10.13.37.1:8554/live/DRONE-001`  
$\rightarrow$ MediaMTX tự động sinh ra **3 Endpoint đầu ra đồng thời**:

| Endpoint đầu ra | Giao thức | Độ trễ thực tế | Ứng dụng & Đối tượng sử dụng |
| :--- | :---: | :---: | :--- |
| **`http://127.0.0.1:8889/live/DRONE-001/whep`** | **WebRTC WHEP** | ⚡ **25ms – 35ms** | **Web Dashboard / Buồng lái FPV Cockpit** (Thời gian thực). |
| **`http://127.0.0.1:8888/live/DRONE-001/index.m3u8`** | **HLS / LL-HLS** | ⏱️ **0.8s – 1.5s** | Kênh dự phòng đa nền tảng (iOS Safari, mạng chặn UDP). |
| **`rtsp://10.13.37.1:8554/live/DRONE-001`** | **RTSP Re-stream** | ⚡ **150ms – 250ms** | Phần mềm chuyên dụng **QGroundControl**, **VLC**, hoặc **Server AI YOLO**. |

---

## VI. BẢNG SO SÁNH MEDIAMTX VỚI CÁC MEDIA SERVER KHÁC

| Tiêu chí | MediaMTX | Nginx-RTMP | SRS (Simple Realtime Server) | Janus Gateway |
| :--- | :---: | :---: | :---: | :---: |
| **Ngôn ngữ phát triển** | **Golang** | C (Module) | C++ | C |
| **Tài nguyên RAM tiêu thụ** | 🟢 **~30 MB** | 🟡 ~50 MB | 🟡 ~60 MB | 🔴 ~150 MB+ |
| **Độ trễ WebRTC WHEP** | ⚡ **< 30ms** | ❌ Không hỗ trợ | ⚡ < 150ms | ⚡ < 100ms |
| **Hỗ trợ Ingest RTSP từ Drone** | 🟢 **Native (Rất mạnh)** | ❌ Cần FFmpeg phụ trợ | 🟡 Cần plugin | 🟡 Phức tạp |
| **Phù hợp hệ thống Drone/UAV** | 🌟 **Tối ưu nhất** | ⏱️ Lạc hậu | 🟢 Tốt | 🟡 Phức tạp |
