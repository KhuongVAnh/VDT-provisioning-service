# GIẢI PHÁP & HƯỚNG DẪN TRIỂN KHAI TRUYỀN VIDEO CHO DRONE (ULTRA-LOW LATENCY)

Tài liệu này hướng dẫn chi tiết kiến trúc, cách triển khai hệ thống truyền video trực tiếp (Live Video Streaming) độ trễ cực thấp (Sub-second < 500ms) từ Drone lên Cloud, phục vụ hiển thị trực tiếp trên **Web Dashboard** (Browser / Giám sát từ xa).

Tài liệu được chia làm 2 phần lớn:
1. **Phần 1:** Hướng triển khai tính năng truyền video trên hệ thống Server Cloud.
2. **Phần 2:** Hướng giả lập phát video trực tiếp trên Drone (khi chưa có module Camera vật lý).

---

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             DRONE FLIGHT SYSTEM                                  │
│  [File Video Mẫu / Camera] ──(FFmpeg / GStreamer)──► [4G/5G WireGuard VPN]       │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ RTSP / SRT (Push: rtsp://VPS:8554/live/drone_01)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             CLOUD BACKEND PLATFORM                               │
│                                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │ 1. Media Server Core (MediaMTX Engine - Native Systemd Service)          │   │
│   │    - Tiếp nhận luồng RTSP từ IP WireGuard của Drone: 10.13.37.1:8554     │   │
│   │    - Lắng nghe nội bộ 127.0.0.1 (HLS 8888, WHEP 8889)                    │   │
│   │    - ĐÓNG HOÀN TOÀN CÁC CỔNG THÔ RA INTERNET                             │   │
│   └────────────────────────────────────┬─────────────────────────────────────┘   │
│                                        │ Stream nội bộ (127.0.0.1)               │
│                                        ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │ 2. Provisioning & Video Gateway (NestJS - PORT 10004 DUY NHẤT)           │   │
│   │    - WebSocket: ws://IP_VPS:10004/socket.io/ (Kênh video:subscribe)      │   │
│   │    - HTTP Proxy: http://IP_VPS:10004/api/v1/video/:deviceId/*            │   │
│   │    - WHEP Proxy: http://IP_VPS:10004/api/v1/video/:deviceId/whep         │   │
│   └────────────────────────────────────┬─────────────────────────────────────┘   │
└────────────────────────────────────────┼─────────────────────────────────────────┘
                                         │ Duy nhất Port 10004 qua Internet
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 3. Web Dashboard / Desktop App (XBLink Model)                                    │
│    - Xem Video trực tiếp qua Gateway Port 10004                                  │
│    - Độ trễ cực thấp: 150ms - 250ms (Real-time Video)                            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

# PHẦN 1: TRIỂN KHAI TÍNH NĂNG TRUYỀN VIDEO TRÊN SERVER

## 1.1. Lựa chọn Media Server tối ưu: MediaMTX (Cài đặt Native Systemd)
Để đạt hiệu năng cao nhất và tối ưu tài nguyên, giải pháp tốt nhất là cài đặt trực tiếp **MediaMTX** dưới dạng **Systemd Service** trên VPS thay vì chạy qua Docker:
- **Ngôn ngữ Go**: Tối ưu tài nguyên CPU/RAM (chỉ chiếm ~30MB RAM).
- **Zero-Transcoding Latency**: Nhận H.264 từ RTSP và đóng gói lại sang WebRTC/HLS ngay lập tức trong bộ nhớ mà không cần render lại frame (không tốn CPU encode lại).
- **Bảo mật tuyệt đối**: Chỉ lắng nghe trên VPN `10.13.37.1:8554` và Localhost `127.0.0.1`, không mở bất kỳ cổng thô nào (`10001`, `10005`) ra Internet.

> 📖 **Xem hướng dẫn chi tiết từng bước cài đặt, cấu hình và hủy bỏ MediaMTX thủ công tại:**
> **[`huong_dan_cai_dat_mediamtx_manual.md`]**

---

## 1.2. Danh sách cổng mạng của hệ thống:
| Cổng | Giao thức | Phạm vi truy cập | Mục đích |
| :--- | :--- | :--- | :--- |
| **8554** | RTSP (TCP/UDP) | 🔒 **Nội bộ VPN WireGuard** (`10.13.37.1`) | Drone đẩy luồng video camera lên VPS |
| **10004** | HTTP / WebSocket | 🌐 **Internet Công Khai (DUY NHẤT)** | Web Dashboard & Desktop App nhận Video, Telemetry, Web SSH |
| **8888** | HLS / fMP4 | 🔒 **Nội bộ VPS** (`127.0.0.1`) | NestJS kết nối nội bộ lấy luồng stream |
| **8889** | WebRTC WHEP | 🔒 **Nội bộ VPS** (`127.0.0.1`) | NestJS làm proxy bắt tay SDP WebRTC |
| **9997** | REST API | 🔒 **Nội bộ VPS** (`127.0.0.1`) | NestJS kiểm tra trạng thái luồng |

---

## 1.3. Tích hợp Gateway phân phối Video (NestJS Backend)

Trong module [VideoModule](provisioning_service/provisioning-api/src/video/video.module.ts), NestJS cung cấp các endpoint trung tâm trên Port 10004:

```typescript
// GET /api/v1/video/:id/stream-info
@Get(':id/stream-info')
getStreamInfo(@Param('id') deviceId: string) {
  return this.videoService.getStreamEndpoints(deviceId);
}

// POST /api/v1/video/:id/whep (Proxy bắt tay SDP WebRTC)
@Post(':id/whep')
postWhepOffer(@Param('id') deviceId: string, @Req() req, @Res() res) {
  this.videoService.proxyWhepRequest(deviceId, req, res);
}
```

> **Gợi ý nhúng nhanh:** MediaMTX có sẵn trình phát WebRTC tích hợp sẵn tại `http://<VPS_PUBLIC_IP>:10001/live/<DRONE_ID>`, bạn có thể nhúng trực tiếp bằng thẻ `<iframe>` vào Web Dashboard để kiểm tra nhanh.


---


## 2.5. Hướng nâng cấp khi Drone lắp Camera thật trong tương lai

Khi Drone được gắn camera vật lý, ta chỉ cần thay đổi nguồn đầu vào của lệnh truyền mà **không cần sửa đổi bất kỳ dòng code nào trên Server Cloud**:

### 1. Nếu sử dụng USB Camera (Webcam / HDMI-to-USB Capture Card):
```bash
ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -framerate 30 -i /dev/video0 \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -g 30 -an -f rtsp -rtsp_transport tcp rtsp://<SERVER_IP>:8554/live/DRONE-001
```

### 2. Nếu sử dụng Raspberry Pi Camera Module (CSI Camera) với GStreamer tăng tốc phần cứng:
```bash
gst-launch-1.0 libcamerasrc ! video/x-raw,width=1280,height=720,framerate=30/1 ! \
  v4l2h264enc extra-controls="controls,h264_profile=4,video_bitrate=2000000" ! \
  h264parse ! rtspclientsink protocols=tcp location=rtsp://<SERVER_IP>:8554/live/DRONE-001
```

---

# PHẦN 3: GIẢI PHÁP DYNAMIC ADAPTIVE BITRATE CHO DRONE 5G BVLOS

Khi Drone bay ngoài trời qua mạng 4G/5G, cường độ sóng vô tuyến (RSRP/RSRQ) và độ trễ đường truyền liên tục biến thiên do khoảng cách, địa hình và chuyển giao trạm phát sóng (Handover). Nếu sử dụng **Bitrate cố định (Static Bitrate)**, khi sóng yếu sẽ gây tràn bộ đệm (Buffer Bloat), rớt kết nối hoặc hình ảnh bị trễ hàng chục giây.

Hệ thống cung cấp giải pháp **Dynamic Adaptive Bitrate (Điều chỉnh Bitrate thích ứng thời gian thực)**:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   COMPANION COMPUTER (RASPBERRY PI 4)                  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 1. Network Link Watchdog (Ping Probe RTT & Packet Loss)          │  │
│  │    Đo lường chất lượng đường truyền tới VPN Gateway (10.13.37.1) │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
│                                    │ Quyết định Tầng Bitrate (Tier 1-4)│
│                                    ▼                                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 2. Dynamic Rate Controller (GStreamer / V4L2 Hardware Encoder)   │  │
│  │    Cập nhật video_bitrate trực tiếp mà không ngắt luồng RTSP/SRT │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │ RTSP over TCP / SRT
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   CLOUD MEDIA SERVER (MediaMTX Engine)                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3.1. Bảng 4 Tầng Bitrate Thích Ứng (Adaptive Bitrate Policy Matrix)

| Tầng (Tier) | Mức chất lượng | Bitrate mục tiêu | Khung hình (FPS) | Điều kiện kích hoạt (RTT & Loss) | Hành vi thích ứng |
| :---: | :---: | :---: | :---: | :---: | :--- |
| **Tier 1** | 🌟 Excellent HD (720p) | **2.500 kbps** | 30 fps | RTT < 60ms và Loss = 0% | Hình ảnh sắc nét tối đa, chi tiết cao |
| **Tier 2** | 🟢 Good Standard (720p) | **1.500 kbps** | 25 fps | RTT 60 - 120ms và Loss < 3% | Cân bằng chất lượng & băng thông |
| **Tier 3** | 🟡 Fair / Moderate (720p) | **800 kbps** | 20 fps | RTT 120 - 250ms hoặc Loss 3 - 8% | Giảm tải mạng, duy trì độ trễ < 300ms |
| **Tier 4** | 🔴 Critical / Poor (480p) | **400 kbps** | 15 fps | RTT > 250ms hoặc Loss > 8% | Chế độ khẩn cấp chống rớt stream |

> **Cơ chế Chống Rung Giật (Hysteresis):**
> - **Khi mạng suy giảm (Mạng xấu đi):** Lập tức hạ Tier ngay chu kỳ đầu tiên để chống nghẽn bộ đệm.
> - **Khi mạng phục hồi (Mạng tốt lên):** Yêu cầu ổn định tối thiểu 3 chu kỳ liên tiếp (9 giây) trước khi nâng chất lượng video, tránh hiện tượng bitrate tăng giảm liên tục gây chớp hình.

---

## 3.2. Lựa chọn Giao thức: RTSP TCP vs SRT (Secure Reliable Transport)

| Tiêu chí | RTSP qua TCP | SRT (Secure Reliable Transport) | Khuyến nghị cho Drone |
| :--- | :--- | :--- | :--- |
| **Độ trễ (Latency)** | 200ms - 400ms | **100ms - 250ms** | SRT tối ưu hơn khi bay BVLOS |
| **Khả năng chống mất gói** | Dựa vào TCP retransmission | **ARQ (Selective Packet Recovery)** | SRT không bị gián đoạn toàn luồng |
| **Hỗ trợ MediaMTX** | Native (Port 8554) | Native (Port 8890) | Cả 2 đều sẵn sàng |

---

## 3.3. Hướng dẫn Triển khai trên Drone Companion Computer

### Cách 1: Chạy bằng Script Shell Giám sát (`drone_stream_adaptive.sh`)
```bash
# 1. Tải script về Raspberry Pi
cd /opt/drone
chmod +x drone_stream_adaptive.sh

# 2. Chạy thử nghiệm trực tiếp
./drone_stream_adaptive.sh
```

### Cách 2: Chạy bằng Python GStreamer Zero-Downtime Agent (`drone_stream_adaptive.py`)
```bash
# 1. Cài đặt thư viện phụ thuộc trên Ubuntu/Raspberry Pi OS
sudo apt-get update
sudo apt-get install -y python3-gi gir1.2-gstreamer-1.0 gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly v4l-utils

# 2. Chạy agent Python
python3 /opt/drone/drone_stream_adaptive.py
```

### Cách 3: Đăng ký thành Systemd Service tự động chạy khi khởi động Drone
```bash
# 1. Copy file cấu hình service vào systemd
sudo cp scripts/drone-video-adaptive.service /etc/systemd/system/

# 2. Kích hoạt và khởi chạy service
sudo systemctl daemon-reload
sudo systemctl enable --now drone-video-adaptive.service

# 3. Xem log hoạt động thời gian thực
sudo journalctl -u drone-video-adaptive.service -f
```

---

# TỔNG KẾT QUY TRÌNH KIỂM THỬ (VERIFICATION CHECKLIST)

1. **Khởi động Media Server trên Cloud**:
   ```bash
   docker compose up -d media-server
   ```
2. **Chạy Mock / Adaptive Stream trên Drone**:
   ```bash
   ./scripts/drone_stream_adaptive.sh
   ```
3. **Kiểm tra luồng phát**:
   - Truy cập `http://<IP_SERVER>:10001/live/DRONE-001` trên trình duyệt Chrome/Edge/Firefox để xem player WebRTC tích hợp.
   - Nhúng WHEP WebRTC client vào Web Dashboard và kiểm tra độ trễ hiển thị trực tiếp.

