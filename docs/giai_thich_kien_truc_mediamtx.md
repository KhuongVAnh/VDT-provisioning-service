# TÀI LIỆU KIẾN TRÚC, CẤU TRÚC VÀ NGUYÊN LÝ HOẠT ĐỘNG CỦA MEDIAMTX
## (Hệ thống Streaming Video Ultra-Low Latency cho Drone Công Nghiệp)

---

## I. TỔNG QUAN VỀ MEDIAMTX

**MediaMTX** (trước đây có tên là `rtsp-simple-server`) là một Media Server mã nguồn mở hiệu năng cao, không trạng thái (stateless), được viết hoàn toàn bằng ngôn ngữ **Golang** bởi tác giả *Alessandro Pezzoni (bluenviron)*.

### 🌟 Tại sao dự án Drone chọn MediaMTX?
1. **Siêu nhẹ và Tiết kiệm tài nguyên:** Chỉ chiếm khoảng **25MB - 40MB RAM** khi vận hành, CPU idle gần như 0%.
2. **Zero-Transcoding Remuxing (Độ trễ tiệm cận 0):** MediaMTX **không decode rồi encode lại video** (tránh tốn CPU và không sinh độ trễ hàng trăm mili-giây). Nó chỉ bóc tách các gói tin H.264 từ luồng RTSP của Drone và đóng gói lại (remux) ngay lập tức trong bộ nhớ RAM sang WebRTC hoặc HLS.
3. **Đa giao thức (All-in-One Multi-Protocol):** Hỗ trợ chuyển đổi qua lại giữa tất cả các giao thức video phổ biến nhất hiện nay (RTSP, RTMP, HLS, WebRTC, SRT, UDP).
4. **Dynamic Stream Paths (Tự động mở luồng):** Cho phép hàng trăm Drone tự động đẩy stream lên theo định danh `live/<drone_id>` mà không cần khai báo tĩnh trước trong file cấu hình.

---

## II. SƠ ĐỒ KIẾN TRÚC TỔNG THỂ CỦA MEDIAMTX

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                MEDIAMTX SERVER CORE                                    │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 1. TẦNG TIẾP NHẬN ĐẦU VÀO (INGRESS LAYER)                                      │   │
│   │    • RTSP Ingest (Cổng 8554 - TCP / UDP RTP:8000) ◄── [Drone đẩy Camera lên]   │   │
│   │    • SRT Ingest  (Cổng 8890 - Chống mất gói di động)                           │   │
│   │    • WebRTC WHIP (Cổng 8889 - Web Browser Publisher)                           │   │
│   │    • RTMP Ingest (Cổng 1935 - OBS / Camera truyền thống)                       │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
│                                           │                                            │
│                                           ▼ (Gói tin H.264 NAL Units)                  │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ 2. LÕI ĐIỀU PHỐI & CHUYỂN ĐỔI BỘ NHỚ (IN-MEMORY REMUXING ENGINE)               │   │
│   │    • Bộ đệm vòng Ring Buffer (Zero-Copy Frame Processing)                      │   │
│   │    • Quản lý danh sách kênh phát sóng động (Paths: `live/<drone_id>`)          │   │
│   │    • Đo lường chất lượng mạng RTCP (Độ trễ RTT, Jitter, Mất gói)               │   │
│   └───────────────────┬───────────────────┬───────────────────┬────────────────────┘   │
│                       │                   │                   │                        │
│         ┌─────────────┘                   │                   └─────────────┐          │
│         ▼                                 ▼                                 ▼          │
│   ┌──────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────────┐
│   │ 3. WEBRTC WHEP EGRESS    │ │ 4. HLS / LL-HLS EGRESS   │ │ 5. RTSP / RTMP EGRESS    │
│   │ • Cổng: 127.0.0.1:8889   │ │ • Cổng: 127.0.0.1:8888   │ │ • Cổng: 10.13.37.1:8554  │
│   │ • Giao thức WHEP SDP     │ │ • Cấp file `index.m3u8`  │ │ • Xem qua VLC, QGC       │
│   │ • Trễ siêu thấp < 200ms  │ │ • Cấp các segment `.m4s` │ │ • Chuyển tiếp luồng      │
│   └─────────────┬────────────┘ └─────────────┬────────────┘ └─────────────┬────────────┘
│                 │                            │                            │            │
└─────────────────┼────────────────────────────┼────────────────────────────┼────────────┘
                  │                            │                            │
                  └────────────────────────────┼────────────────────────────┘
                                               │ (Nội bộ 127.0.0.1)
                                               ▼
                              ┌──────────────────────────────────┐
                              │ NestJS Gateway (Port 10004)      │
                              │ (Cửa khẩu an ninh duy nhất)      │
                              └────────────────┬─────────────────┘
                                               │ (Public Internet)
                                               ▼
                                  [Web Dashboard / Pilot App]
```

---

## III. GIẢI THÍCH CHI TIẾT TỪNG THÀNH PHẦN & CỔNG MẠNG

### 1. Phân hệ RTSP / RTP / RTCP (Kênh tiếp nhận từ Drone)
MediaMTX tách biệt rõ ràng giữa **kênh điều khiển** và **kênh truyền dữ liệu hình ảnh**:

* **`rtspAddress: 10.13.37.1:8554` (Control Plane - TCP/UDP):**
  * Đóng vai trò như "chiếc điều khiển từ xa". Drone gửi các lệnh bắt tay: `OPTIONS` (hỏi tính năng), `ANNOUNCE` (khai báo codec H.264), `SETUP` (thiết lập đường truyền), `RECORD` (bắt đầu phát), `TEARDOWN` (ngắt kết nối).
* **`rtpAddress: 10.13.37.1:8000` (Data Plane - UDP):**
  * RTP (*Real-time Transport Protocol*): Khi Drone phát video bằng UDP để giảm độ trễ, toàn bộ các byte hình ảnh video H.264 thực tế sẽ được bắn trực tiếp vào cổng này.
* **`rtcpAddress: 10.13.37.1:8001` (Quality Monitoring - UDP):**
  * RTCP (*RTP Control Protocol*): Drone và MediaMTX liên tục gửi các gói tin báo cáo thống kê qua lại (Packet Loss, Round Trip Time, Jitter). Script thích ứng trên Drone dựa vào cổng này để tự động giảm bitrate khi mạng 4G yếu.

---

### 2. Phân hệ WebRTC WHEP (Kênh phát siêu trễ thấp < 200ms)
* **`webrtcAddress: 127.0.0.1:8889` (HTTP WHEP Signaling):**
  * Sử dụng chuẩn **WHEP** (*WebRTC HTTP Egress Protocol*): Client gửi một bản mô tả SDP Offer dạng HTTP POST, MediaMTX trả về SDP Answer để thiết lập kênh WebRTC P2P trực tiếp.
* **`webrtcLocalUDPAddress: 127.0.0.1:8189` (ICE Candidate UDP):**
  * Cổng trao đổi gói tin truyền thông WebRTC qua UDP nội bộ.

---

### 3. Phân hệ HLS / Low-Latency HLS (Kênh phát tương thích 100%)
* **`hlsAddress: 127.0.0.1:8888` (HTTP Streaming):**
  * Tự động cắt luồng H.264 thành các phân đoạn nhỏ (segments) định dạng `.m4s` hoặc `.ts` và tạo file danh sách phát `index.m3u8`.
  * **Low-Latency HLS (`hlsVariant: lowLatency`):** Cắt nhỏ mỗi segment thành các phần siêu nhỏ (parts ~100ms), giúp giảm độ trễ của HLS từ 6s xuống chỉ còn **`0.5s - 1.5s`**.
  * Chạy hoàn toàn trên HTTP tiêu chuẩn, không bị chặn bởi bất kỳ tường lửa nào.

---

### 4. Phân hệ API Điều khiển & Quản trị
* **`apiAddress: 127.0.0.1:9997` (REST API):**
  * Cung cấp các endpoint REST JSON để NestJS Backend truy vấn:
    * `GET /v3/paths/list`: Lấy danh sách tất cả các Drone đang phát video trực tiếp.
    * `GET /v3/rtspsessions/list`: Kiểm tra chi tiết phiên kết nối RTSP của từng Drone.
    * `GET /v3/webrtcsessions/list`: Đếm số lượng người đang xem qua WebRTC.

---

## IV. CẤU TRÚC ĐỊNH TUYẾN LUỒNG (PATHS SYSTEM)

Trong MediaMTX, mỗi luồng video được quản lý dưới dạng một **Path (Đường dẫn)**:

```yaml
paths:
  # Cấu hình all_others: Cho phép MỌI Drone tự động tạo đường dẫn theo ý muốn
  all_others:
    # 1. Tự động đóng và giải phóng RAM nếu Drone ngắt kết nối sau 10 giây
    sourceOnDemandCloseAfter: 10s
    # 2. Khởi động lại luồng ngay khi có tín hiệu mới
    runOnReadyRestart: yes
```

* Khi Drone A phát vào: `rtsp://10.13.37.1:8554/live/DRONE-001`
  $\rightarrow$ MediaMTX tự động sinh ra các endpoint đầu ra tương ứng:
  * **WebRTC WHEP:** `http://127.0.0.1:8889/live/DRONE-001/whep`
  * **HLS Stream:** `http://127.0.0.1:8888/live/DRONE-001/index.m3u8`
  * **RTSP Re-stream:** `rtsp://10.13.37.1:8554/live/DRONE-001`

---

## V. CƠ CHẾ BẢO MẬT TRONG KIẾN TRÚC GOM CỔNG (PORT 10004)

Trong thiết kế kiến trúc chuẩn của dự án:
1. **MediaMTX hoàn toàn KHÔNG mở bất kỳ cổng nào ra ngoài Internet:**
   * Cổng RTSP (`8554`, `8000`, `8001`) chỉ lắng nghe trên IP VPN `10.13.37.1`.
   * Cổng HLS (`8888`), WHEP (`8889`), API (`9997`) chỉ lắng nghe trên `127.0.0.1`.
2. **NestJS đóng vai trò Reverse Proxy & Security Guard (Cổng 10004):**
   * Mọi yêu cầu xem video từ Web Dashboard hoặc App đều gửi vào `http://IP_VPS:10004/api/v1/video/:deviceId/*`.
   * NestJS kiểm tra quyền truy cập (JWT / RBAC) rồi mới lấy dữ liệu từ MediaMTX nội bộ (`127.0.0.1`) trả về cho người dùng.

---

## VI. BẢNG SO SÁNH MEDIAMTX VỚI CÁC MEDIA SERVER KHÁC

| Tiêu chí | MediaMTX | Nginx-RTMP | SRS (Simple Realtime Server) | Janus Gateway |
| :--- | :---: | :---: | :---: | :---: |
| **Ngôn ngữ phát triển** | **Golang** | C (Module) | C++ | C |
| **Tài nguyên RAM tiêu thụ** | 🟢 **~30 MB** | 🟡 ~50 MB | 🟡 ~60 MB | 🔴 ~150 MB+ |
| **Độ trễ WebRTC WHEP** | ⚡ **< 200ms** | ❌ Không hỗ trợ | ⚡ < 200ms | ⚡ < 200ms |
| **Hỗ trợ Ingest RTSP từ Drone** | 🟢 **Native (Rất mạnh)** | ❌ Cần FFmpeg phụ trợ | 🟡 Cần plugin | 🟡 Phức tạp |
| **Cài đặt & Vận hành** | 🟢 **1 file nhị phân duy nhất** | 🔴 Phải compile lại Nginx | 🟡 Cần nhiều file config | 🔴 Rất phức tạp |
| **Phù hợp hệ thống Drone/UAV** | 🌟 **Tối ưu nhất** | ⏱️ Lạc hậu | 🟢 Tốt | 🟡 Phức tạp |
