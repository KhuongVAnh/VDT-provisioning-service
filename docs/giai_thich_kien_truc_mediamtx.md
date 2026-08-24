# TÀI LIỆU KIẾN TRÚC STREAMING VIDEO MEDIAMTX & NESTJS GATEWAY
## (Thực Trạng Phân Phối Video HLS & Kiến Trúc Dự Án)

---

## I. TỔNG QUAN HỆ THỐNG HIỆN TẠI

Hệ thống truyền video của dự án hiện đang vận hành theo mô hình kết hợp giữa **Media Server Lõi (MediaMTX)** và **Cổng An Ninh Phân Phối (NestJS Video Gateway)**:

1. **Media Server Lõi ([MediaMTX](https://github.com/bluenviron/mediamtx)):**
   - Viết bằng **Golang**, đóng vai trò tiếp nhận luồng video gốc từ Drone qua mạng VPN WireGuard và chuyển đổi định dạng tức thời trong bộ nhớ RAM (**Zero-Transcoding In-Memory Remuxing**).
   - Được thiết lập ở chế độ **cô lập bảo mật tuyệt đối**: Chỉ lắng nghe trên IP VPN `10.13.37.1:8554` (chiều Drone đẩy lên) và Localhost `127.0.0.1` (không mở bất kỳ cổng nào ra Internet công cộng).

2. **Cổng Phân Phối Video ([NestJS Video Gateway - Port 10004](../provisioning-api/src/video/video.controller.ts)):**
   - Cửa khẩu an ninh duy nhất mở ra Internet (Port 10004).
   - **Thực trạng hiện tại trên Web Dashboard:** Đang phân phối video tới trình duyệt thông qua giao thức **Low-Latency HLS (HTTP Live Streaming)** bằng cơ chế **Reverse Proxy**.

---

## II. ĐÁNH GIÁ THỰC TRẠNG HIỆN TẠI TRÊN WEB DASHBOARD

### 1. Cơ chế đang hoạt động: Low-Latency HLS (Hls.js)
Hiện tại, trên giao diện Web Dashboard ([`public/index.html`](../provisioning-api/public/index.html#L1700-L1750)), trình duyệt đang sử dụng thư viện **Hls.js** để kéo luồng video từ endpoint `GET /api/v1/video/:deviceId/index.m3u8` qua Port 10004.

* **Ưu điểm vượt trội:**
  * 🔒 **Bảo mật tối đa (Zero Public Ports):** MediaMTX nằm kín hoàn toàn sau `127.0.0.1`, không cần mở bất kỳ cổng phụ nào trên Firewall VPS.
  * 🌐 **Tương thích 100% mọi loại mạng:** Chạy hoàn toàn trên HTTP tiêu chuẩn, không bị chặn bởi bất kỳ tường lửa công ty hay mạng di động nào.
* **Hạn chế:**
  * ⏱️ **Độ trễ còn ở mức `0.8s – 1.5s`:** Do cơ chế của HLS phải gom các khung hình thành các phân đoạn nhỏ (`.m4s`) và trình duyệt phải tải đệm (Buffer) trước khi phát.

---

## III. SƠ ĐỒ DÒNG CHẢY DỮ LIỆU & CHU TRÌNH PHÁT VIDEO HIỆN TẠI (HLS PROXY)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DRONE FLIGHT SYSTEM                                  │
│       [Camera Module] ──(H.264 V4L2/GStreamer)──► [4G/5G WireGuard VPN: 10.13.37.X]    │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ (1) RTSP Ingest (Port 8554) / SRT (Port 8890)
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               CLOUD SERVER BACKEND                                     │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 1. MEDIAMTX CORE (Lắng nghe nội bộ VPN 10.13.37.1 & Localhost 127.0.0.1)       │   │
│   │ • Tự động Remux H.264 sang Low-Latency HLS Segments (.m4s & index.m3u8)        │   │
│   │ • Cổng HLS nội bộ: 127.0.0.1:8888 (KHÔNG MỞ RA INTERNET)                       │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
│                                           │                                            │
│                                           │ (3) Lấy danh sách Playlist & Segment .m4s  │
│                                           │     (HTTP Stream nội bộ 127.0.0.1:8888)    │
│                                           ▼                                            │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 2. NESTJS VIDEO GATEWAY (PORT 10004 DUY NHẤT)                                  │   │
│   │ • Cung cấp API thông tin luồng : GET /api/v1/video/:id/stream-info             │   │
│   │ • Reverse Proxy luồng HLS      : GET /api/v1/video/:id/index.m3u8 & *.m4s      │   │
│   │ • Cơ chế Zero-Buffer Pipelining: Chuyển tiếp tức thì byte stream qua HTTP      │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
└───────────────────────────────────────────┼────────────────────────────────────────────┘
                                            │ (2) HTTP GET tuần tự (index.m3u8, seg.m4s)
                                            │     qua Port 10004
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        MÁY KHÁCH NGƯỜI XEM (WEB DASHBOARD)                             │
│                        • Thư viện Hls.js nhận phân đoạn và render lên thẻ <video>      │
│                        • Độ trễ Low-Latency HLS: ~ 0.8s - 1.5s                         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Chi tiết các bước chu trình phân phối HLS:
1. **Bước 1 (Ingest):** Drone truyền luồng camera H.264 qua VPN WireGuard vào cổng `10.13.37.1:8554` của MediaMTX.
2. **Bước 2 (Remuxing):** MediaMTX cắt nhỏ luồng thành các part 100ms / segment 500ms và cập nhật file `index.m3u8` trong RAM tại `127.0.0.1:8888`.
3. **Bước 3 (Truy vấn Stream Info):** Trình duyệt gọi `GET /api/v1/video/:deviceId/stream-info` để lấy `hlsUrl`.
4. **Bước 4 (Kéo luồng qua Proxy):** Thư viện `Hls.js` liên tục gửi các request `GET /api/v1/video/:deviceId/index.m3u8` và các file `.m4s` qua Port 10004 của NestJS.
5. **Bước 5 (Zero-Buffer Pipe):** NestJS lấy trực tiếp dữ liệu từ `127.0.0.1:8888` và `pipe` thẳng về trình duyệt.

---

## IV. GIẢI THÍCH CHI TIẾT CÁC PHÂN HỆ & CỔNG MẠNG MEDIAMTX

### 1. Phân hệ RTSP / RTP / RTCP (Kênh Ingest từ Drone)
* **`rtspAddress: 10.13.37.1:8554` (Control Plane - TCP/UDP):**
  * Nhận lệnh điều khiển bắt tay: `OPTIONS`, `ANNOUNCE`, `SETUP`, `RECORD`, `TEARDOWN`.
* **`rtpAddress: 10.13.37.1:8000` (Data Plane - UDP):**
  * Nhận các gói tin khung hình H.264 thực tế do Drone đẩy lên.
* **`rtcpAddress: 10.13.37.1:8001` (Quality Monitoring - UDP):**
  * Đo lường chất lượng đường truyền (Packet Loss, RTT, Jitter) để Drone tự động kích hoạt tính năng [Dynamic Adaptive Bitrate](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/scripts/drone_stream_adaptive.sh).

### 2. Phân hệ HLS / Low-Latency HLS (Kênh phát tương thích 100%)
* **`hlsAddress: 127.0.0.1:8888` (HTTP Streaming):**
  * Tự động cắt luồng H.264 thành các phân đoạn nhỏ (`.m4s`/`.ts`) và sinh file `index.m3u8`.
  * **Low-Latency HLS (`hlsVariant: lowLatency`):** Cắt nhỏ segment thành các phần siêu nhỏ (parts ~100ms), giúp độ trễ giảm từ 6s xuống còn **`0.5s – 1.5s`**.
  * NestJS làm nhiệm vụ Proxy endpoint này qua `GET /api/v1/video/:deviceId/*`.

### 3. Phân hệ REST API Điều khiển & Quản trị
* **`apiAddress: 127.0.0.1:9997` (REST API do MediaMTX cung cấp sẵn):**
  * `GET /v3/paths/list`: Lấy danh sách tất cả các Drone đang phát sóng.
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

| Endpoint đầu ra | Giao thức | Độ trễ | Ứng dụng & Đối tượng sử dụng |
| :--- | :---: | :---: | :--- |
| **`http://127.0.0.1:8889/live/DRONE-001/whep`** | **WebRTC WHEP** | ⚡ **< 200ms** | Xem trực tiếp trên **Web Dashboard / Browser** (Thời gian thực). |
| **`http://127.0.0.1:8888/live/DRONE-001/index.m3u8`** | **HLS / LL-HLS** | ⏱️ **1.5s – 4s** | Dự phòng đa nền tảng (iOS Safari, SmartTV, mạng bị chặn UDP). |
| **`rtsp://10.13.37.1:8554/live/DRONE-001`** | **RTSP Re-stream** | ⚡ **200ms – 400ms** | Phần mềm chuyên dụng **QGroundControl**, **VLC**, hoặc **Server AI YOLO**. |

---

## VI. BẢNG SO SÁNH MEDIAMTX VỚI CÁC MEDIA SERVER KHÁC

| Tiêu chí | MediaMTX | Nginx-RTMP | SRS (Simple Realtime Server) | Janus Gateway |
| :--- | :---: | :---: | :---: | :---: |
| **Ngôn ngữ phát triển** | **Golang** | C (Module) | C++ | C |
| **Tài nguyên RAM tiêu thụ** | 🟢 **~30 MB** | 🟡 ~50 MB | 🟡 ~60 MB | 🔴 ~150 MB+ |
| **Độ trễ WebRTC WHEP** | ⚡ **< 200ms** | ❌ Không hỗ trợ | ⚡ < 200ms | ⚡ < 200ms |
| **Hỗ trợ Ingest RTSP từ Drone** | 🟢 **Native (Rất mạnh)** | ❌ Cần FFmpeg phụ trợ | 🟡 Cần plugin | 🟡 Phức tạp |
| **Phù hợp hệ thống Drone/UAV** | 🌟 **Tối ưu nhất** | ⏱️ Lạc hậu | 🟢 Tốt | 🟡 Phức tạp |

