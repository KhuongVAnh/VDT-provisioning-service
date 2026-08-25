# HƯỚNG DẪN TRIỂN KHAI VÀ PHÁT VIDEO FPV CHO DRONE 5G (WEBRTC WHEP & HARDWARE ENCODE)

> **Tài liệu Kỹ thuật Triển khai Thực tế**  
> **Áp dụng cho:** Đội ngũ phát triển Cloud Backend và Kỹ sư phần cứng Drone Air Unit (Raspberry Pi / Jetson / Radxa).  
> **Kiến trúc tham chiếu:** [dac_ta_kien_truc_sbcloud_pilot_bridge_xblink.md](dac_ta_kien_truc_sbcloud_pilot_bridge_xblink.md) & [giai_thich_kien_truc_mediamtx.md](giai_thich_kien_truc_mediamtx.md).

---

## 1. TỔNG QUAN KIẾN TRÚC TRUYỀN VIDEO FPV

Hệ thống truyền video FPV thời gian thực kết hợp giữa **MediaMTX Native Systemd Core** trên Cloud và **Module Video Gateway có xác thực JWT (Port 10004 / 10005)**:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                   1. DRONE (AIR UNIT)                                    │
│   [CSI Camera / USB V4L2] ──(GStreamer / FFmpeg H.264)──► [4G/5G WireGuard VPN: 10.13.37.X]│
└────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             │ (1) RTSP Ingest (10.13.37.1:8554/live/<deviceId>)
                                             ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                2. CLOUD SERVER BACKEND                                   │
│                                                                                          │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│   │ A. MediaMTX Core (Native Systemd Service):                                       │   │
│   │    • RTSP Ingest nội bộ VPN     : 10.13.37.1:8554 (H.264 Ingest)                  │   │
│   │    • WHEP Signaling nội bộ      : 127.0.0.1:8889                                  │   │
│   │    • HLS / LL-HLS nội bộ        : 127.0.0.1:8888                                  │   │
│   │    • WebRTC Media Data Server   : 0.0.0.0:10005 (UDP & TCP Single-Port Multiplex) │   │
│   └────────────────────────┬─────────────────────────────────┬───────────────────────┘   │
│                            │                                 │                           │
│                            │ (2) Proxy Signaling WHEP        │ (4) Lấy HLS Segment       │
│                            ▼                                 ▼                           │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│   │ B. NestJS Video Gateway (Cửa khẩu an ninh Port 10004):                           │   │
│   │    • Xác thực JWT Token & Quyền sở hữu Drone (DeviceOwnershipGuard).             │   │
│   │    • WHEP Signaling Endpoint   : POST /api/v1/video/:deviceId/whep               │   │
│   │    • HLS Fallback Stream       : GET  /api/v1/video/:deviceId/hls/*              │   │
│   └────────────────────────┬─────────────────────────────────┬───────────────────────┘   │
└────────────────────────────┼─────────────────────────────────┼───────────────────────────┘
                             │                                 │
         [Bắt tay WHEP SDP]  │                                 │ [HLS Fallback]
         POST Port 10004     │                                 │ GET Port 10004
         (Bearer JWT Token)  │                                 │
                             ▼                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                 3. CÁC MÁY KHÁCH ĐẦU CUỐI                                │
│                                                                                          │
│  ┌────────────────────────────────────────┐  ┌────────────────────────────────────────┐  │
│  │ A. Web Dashboard (Trình duyệt Web)     │  │ B. Pilot Bridge (Qt6 Desktop App)      │  │
│  │  • Nhận WebRTC WHEP UDP Port 10005     │  │  • Bắt tay WHEP WebRTC qua Port 10004  │  │
│  │  • Độ trễ siêu tốc: 25ms - 35ms        │  │  • Bắn RTP H.264 sang UDP 127.0.0.1:5600│  │
│  │  • Hiển thị buồng lái FPV OSD / HUD    │  │  • QGroundControl tự động phát Video!  │  │
│  └────────────────────────────────────────┘  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. MA TRẬN CỔNG MẠNG HỆ THỐNG VIDEO

| Cổng (Port) | Giao thức | Phạm vi truy cập | Mục đích |
| :--- | :---: | :--- | :--- |
| **8554** | RTSP (TCP/UDP) | 🔒 **Nội bộ VPN WireGuard** (`10.13.37.1`) | Drone đẩy luồng video H.264 lên Cloud |
| **10004** | HTTPS / WSS | 🌐 **Internet Công Khai** | Bắt tay SDP WHEP (kèm JWT Token), HLS Fallback, MAVLink Relay |
| **10005** | WebRTC (UDP/TCP) | 🌐 **Internet Công Khai** | Truyền tải dòng gói tin Media RTP H.264 độ trễ siêu tốc `< 30ms` |
| **8888** | HLS / fMP4 | 🔒 **Nội bộ VPS** (`127.0.0.1`) | MediaMTX sinh segment HLS trong RAM cho NestJS Proxy |
| **8889** | WHEP Signaling | 🔒 **Nội bộ VPS** (`127.0.0.1`) | MediaMTX nhận bản tin SDP Offer nội bộ từ NestJS |
| **9997** | REST API | 🔒 **Nội bộ VPS** (`127.0.0.1`) | NestJS kiểm tra danh sách Drone đang phát sóng |

---

## 3. HƯỚNG DẪN CẤU HÌNH PHÁT VIDEO TRÊN DRONE AIR UNIT

Khi Drone được gắn camera vật lý, SBC Companion (Raspberry Pi / Jetson) sẽ sử dụng phần cứng chuyên dụng để mã hóa H.264 và đẩy luồng RTSP vào địa chỉ Gateway VPN:

### 3.1. Đối với USB Camera (V4L2 Webcam / HDMI Capture Card)
Sử dụng **FFmpeg** với chế độ không đệm (`zerolatency`):
```bash
ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -framerate 30 -i /dev/video0 \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -g 30 -an -f rtsp -rtsp_transport tcp rtsp://10.13.37.1:8554/live/DRONE-001
```

### 3.2. Đối với Raspberry Pi CSI Camera (Tăng tốc phần cứng GPU)
Sử dụng **GStreamer** với plugin `libcamerasrc` và bộ mã hóa phần cứng `v4l2h264enc`:
```bash
gst-launch-1.0 libcamerasrc ! video/x-raw,width=1280,height=720,framerate=30/1 ! \
  v4l2h264enc extra-controls="controls,h264_profile=4,video_bitrate=2000000" ! \
  h264parse ! rtspclientsink protocols=tcp location=rtsp://10.13.37.1:8554/live/DRONE-001
```

### 3.3. Đối với NVIDIA Jetson (Jetson Nano / Xavier / Orin)
Sử dụng bộ giải mã phần cứng `nvarguscamerasrc` và `nvv4l2h264enc`:
```bash
gst-launch-1.0 nvarguscamerasrc ! 'video/x-raw(memory:NVMM),width=1280,height=720,framerate=30/1' ! \
  nvv4l2h264enc bitrate=2000000 insert-sps-pps=true ! \
  h264parse ! rtspclientsink protocols=tcp location=rtsp://10.13.37.1:8554/live/DRONE-001
```

---

## 4. GIẢI PHÁP DYNAMIC ADAPTIVE BITRATE CHO DRONE 5G BVLOS

Khi Drone bay tầm xa ngoài tầm nhìn (BVLOS) qua sóng 4G/5G, chất lượng sóng liên tục biến đổi. Để chống tràn bộ đệm (Buffer Bloat) gây giật lag hoặc mất hình:

### 4.1. Ma trận 4 Tầng Bitrate Thích Ứng

| Tầng (Tier) | Chất lượng | Bitrate mục tiêu | FPS | Điều kiện kích hoạt (RTT & Loss) | Hành vi |
| :---: | :---: | :---: | :---: | :---: | :--- |
| **Tier 1** | 🌟 Excellent HD (720p) | **2.500 kbps** | 30 | RTT < 60ms & Loss = 0% | Độ nét tối đa cho trinh sát |
| **Tier 2** | 🟢 Good Standard (720p) | **1.500 kbps** | 25 | RTT 60 - 120ms & Loss < 3% | Cân bằng chất lượng & băng thông |
| **Tier 3** | 🟡 Moderate (720p) | **800 kbps** | 20 | RTT 120 - 250ms hoặc Loss 3 - 8% | Giảm tải mạng, giữ độ trễ < 50ms |
| **Tier 4** | 🔴 Emergency (480p) | **400 kbps** | 15 | RTT > 250ms hoặc Loss > 8% | Chống rớt luồng khẩn cấp |

> **Cơ chế Chống Rung Giật (Hysteresis):**
> * **Mạng suy giảm:** Lập tức hạ Tier ngay chu kỳ đầu tiên để bảo vệ luồng bay.
> * **Mạng phục hồi:** Yêu cầu ổn định tối thiểu 3 chu kỳ liên tiếp (9 giây) trước khi nâng chất lượng, tránh hiện tượng chớp nháy video.

---

## 5. TỰ ĐỘNG CHẠY STREAM DƯỚI DẠNG SYSTEMD SERVICE TRÊN DRONE

Tạo file dịch vụ systemd trên SBC Companion của Drone:
```ini
# /etc/systemd/system/drone-video.service
[Unit]
Description=Drone Video Streaming Agent
After=network.target wg-quick@wg0.service
Wants=wg-quick@wg0.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/drone
ExecStart=/usr/bin/gst-launch-1.0 libcamerasrc ! video/x-raw,width=1280,height=720,framerate=30/1 ! v4l2h264enc extra-controls="controls,h264_profile=4,video_bitrate=2000000" ! h264parse ! rtspclientsink protocols=tcp location=rtsp://10.13.37.1:8554/live/DRONE-001
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Kích hoạt dịch vụ:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now drone-video.service
```

---

## 6. XÁC THỰC LUỒNG VIDEO TRÊN CLIENT

1. **Trên Web Dashboard:**
   * Đăng nhập tài khoản phi công $\rightarrow$ Vào tab **Tác Chiến & FPV** $\rightarrow$ Bấm nút **FPV** của Drone $\rightarrow$ Video phát mượt mà qua WebRTC WHEP UDP `< 30ms`.
2. **Trên Pilot Bridge & QGroundControl:**
   * Mở app **Pilot Bridge** $\rightarrow$ Đăng nhập và chọn Drone $\rightarrow$ App tự động bắt tay WHEP và đẩy stream sang `127.0.0.1:5600`.
   * Mở **QGroundControl** $\rightarrow$ *Application Settings ➔ Video ➔ UDP h.264 Video Stream (Port 5600)* $\rightarrow$ Video hiển thị trực tiếp trên bản đồ bay.
