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
│   │ 1. Media Server Core (MediaMTX Engine)                                   │   │
│   │    - Tiếp nhận luồng RTSP từ IP WireGuard của Drone                      │   │
│   │    - Chuyển đổi giao thức tức thời (Zero-Transcoding Delay)              │   │
│   │    - Cung cấp luồng WebRTC (WHEP) cho Web Dashboard                      │   │
│   └────────────────────────────────────┬─────────────────────────────────────┘   │
│                                        │                                         │
│   ┌────────────────────────────────────▼─────────────────────────────────────┐   │
│   │ 2. Provisioning & Gateway API (NestJS)                                   │   │
│   │    - Quản lý trạng thái Online/Offline của luồng video                   │   │
│   │    - Cấp phát URL stream WebRTC an toàn theo Drone ID                    │   │
│   └────────────────────────────────────┬─────────────────────────────────────┘   │
└────────────────────────────────────────┼─────────────────────────────────────────┘
                                         │ WebRTC WHEP (Port 8889)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 3. Web Dashboard (Frontend React/Vue/HTML5)                                      │
│    - Xem Video trực tiếp qua WebRTC WHEP                                         │
│    - Độ trễ cực thấp: 150ms - 300ms (Real-time Video)                            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

# PHẦN 1: TRIỂN KHAI TÍNH NĂNG TRUYỀN VIDEO TRÊN SERVER

## 1.1. Lựa chọn Media Server tối ưu: MediaMTX
Để đạt hiệu năng cao nhất, giải pháp tối ưu là sử dụng **MediaMTX** (trước đây là `rtsp-simple-server`):
- **Ngôn ngữ Go**: Tối ưu tài nguyên CPU/RAM (chỉ chiếm ~30MB RAM), tương thích hoàn hảo với kiến trúc Microservices hiện tại.
- **Zero-Transcoding Latency**: Nhận H.264 từ RTSP và đóng gói lại sang WebRTC/HLS ngay lập tức trong bộ nhớ mà không cần render lại frame (không tốn CPU encode lại).
- **Đa giao thức**:
  - **Drone -> Server**: Dùng **RTSP qua TCP** hoặc **SRT** (chống mất gói trên mạng di động 4G).
  - **Server -> Web Dashboard**: Dùng **WebRTC (WHEP)** cho độ trễ < 300ms trực tiếp trên trình duyệt Web.
- **Dynamic Stream Paths**: Tự động mở endpoint theo ID Drone (`/live/<drone_id>`) khi Drone bắt đầu đẩy stream lên.

---

## 1.2. Cấu hình triển khai trên Docker Compose

Tích hợp trực tiếp service `media-server` vào tệp [docker-compose.yml]
```yaml
services:
  # ... (redis, telemetry-ingestion, provisioning-api)

  # 4. Ultra-Low Latency Video Streaming Server (MediaMTX)
  media-server:
    image: bluenviron/mediamtx:latest
    container_name: drone-media-server
    restart: unless-stopped
    network_mode: "host"
    environment:
      # Kích hoạt các giao thức
      - MTX_PROTOCOLS=tcp,udp
      # IP Public của VPS để WebRTC STUN/ICE thiết lập kết nối với Client ngoài Internet
      - MTX_WEBRTCADDITIONALHOSTS=${VPS_PUBLIC_IP:-127.0.0.1}
      # Cổng dịch vụ
      - MTX_RTSPADDRESS=:8554
      - MTX_WEBRTCADDRESS=:8889
      - MTX_HLSADDRESS=:8888
      - MTX_API=yes
      - MTX_APIADDRESS=:9997
```

### Danh sách cổng hoạt động của Media Server:
| Cổng | Giao thức | Mục đích | Đối tượng sử dụng |
| :--- | :--- | :--- | :--- |
| **8554** | RTSP (TCP/UDP) | Cổng tiếp nhận luồng video đẩy lên từ Drone | Drone đẩy stream |
| **8889** | WebRTC / WHEP | Truyền video độ trễ thấp đến trình duyệt | Web Dashboard / Mobile Web |
| **8888** | HLS | Video streaming dự phòng | Trình duyệt Safari iOS nếu WebRTC bị chặn |
| **9997** | REST API | Kiểm tra danh sách drone đang live | NestJS Backend kiểm tra trạng thái |

---

## 1.3. Tích hợp xác thực và API điều khiển (NestJS Backend)

Trong service [provisioning-api](file:///d:/huster%20document/VDT/remote%20ID/server_cloud/provisioning_service/provisioning-api), bổ sung API trả về thông tin luồng phát cho người dùng:

```typescript
// GET /api/v1/devices/:id/stream-info
@Get(':id/stream-info')
@UseGuards(JwtAuthGuard)
async getStreamInfo(@Param('id') deviceId: string, @Req() req: Request) {
  // 1. Kiểm tra quyền sở hữu thiết bị
  await this.deviceService.verifyOwnership(req.user.id, deviceId);

  // 2. Trả về các endpoint xem video cho Web Dashboard
  const vpsHost = process.env.VPS_PUBLIC_IP || 'localhost';
  return {
    deviceId: deviceId,
    webrtcUrl: `http://${vpsHost}:8889/live/${deviceId}`,
    whepEndpoint: `http://${vpsHost}:8889/live/${deviceId}/whep`,
    hlsUrl: `http://${vpsHost}:8888/live/${deviceId}/index.m3u8`
  };
}
```

---

## 1.4. Hiển thị Video phía Web Dashboard qua WebRTC WHEP

Sử dụng thẻ `<video>` HTML5 kết hợp JavaScript WHEP Client tiêu chuẩn để phát trực tiếp với độ trễ cực thấp (< 300ms):

```html
<video id="drone-video" autoplay muted playsinline controls style="width: 100%; max-width: 800px; border-radius: 8px;"></video>

<script>
async function startWebRTC(whepUrl) {
  const videoEl = document.getElementById('drone-video');
  const peerConnection = new RTCPeerConnection();

  peerConnection.addTransceiver('video', { direction: 'recvonly' });

  peerConnection.ontrack = (event) => {
    videoEl.srcObject = event.streams[0];
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  // Gửi SDP Offer lên MediaMTX qua WHEP endpoint
  const response = await fetch(whepUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offer.sdp
  });

  const answerSdp = await response.text();
  await peerConnection.setRemoteDescription(new RTCSessionDescription({
    type: 'answer',
    sdp: answerSdp
  }));
}

// Bắt đầu phát luồng của Drone DRONE-001
startWebRTC('http://<VPS_PUBLIC_IP>:8889/live/DRONE-001/whep');
</script>
```

> **Gợi ý nhúng nhanh:** MediaMTX có sẵn trình phát WebRTC tích hợp sẵn tại `http://<VPS_PUBLIC_IP>:8889/live/<DRONE_ID>`, bạn có thể nhúng trực tiếp bằng thẻ `<iframe>` vào Web Dashboard để kiểm tra nhanh.

---

# PHẦN 2: HƯỚNG GIẢ LẬP TRUYỀN VIDEO TRÊN DRONE (MOCK STREAMING)

Khi Drone phần cứng chưa gắn camera hoặc đang test giả lập, ta sử dụng **FFmpeg** để đọc file video MP4 có sẵn và đẩy stream lên Server với đúng thông số kỹ thuật như camera thật.

---

## 2.1. Chuẩn bị file video mẫu
- Tìm một file video flycam / drone quay góc nhìn từ trên cao (định dạng `.mp4`).
- Tải về và đổi tên thành `drone_sample.mp4`.

---

## 2.2. Lệnh FFmpeg giả lập Drone Live Stream tối ưu

Chạy lệnh FFmpeg sau trên máy tính (hoặc trên mạch Raspberry Pi / Companion PC của Drone):

```bash
ffmpeg -re -stream_loop -1 -i drone_sample.mp4 \
  -c:v libx264 \
  -preset ultrafast \
  -tune zerolatency \
  -profile:v baseline \
  -b:v 2000k \
  -maxrate 2500k \
  -bufsize 4000k \
  -pix_fmt yuv420p \
  -g 30 \
  -an \
  -f rtsp \
  -rtsp_transport tcp \
  rtsp://<VPS_PUBLIC_IP_HOAC_IP_WIREGUARD>:8554/live/DRONE-001
```

### Bảng giải thích chi tiết các tham số quan trọng:
| Tham số | Ý nghĩa kỹ thuật | Vì sao cần cho Drone? |
| :--- | :--- | :--- |
| `-re` | Đọc file theo tốc độ thời gian thực (Realtime rate). | Ngăn FFmpeg đọc hết toàn bộ file trong vài giây; ép phát đúng 30fps như camera thật. |
| `-stream_loop -1` | Lặp lại file vô tận. | Khi hết video, FFmpeg tự động quay lại đầu file để duy trì luồng Live 24/7. |
| `-c:v libx264` | Sử dụng bộ mã hóa H.264 tiêu chuẩn. | Được 100% trình duyệt WebRTC hỗ trợ native mà không cần cài thêm plugin. |
| `-preset ultrafast` | Tốc độ mã hóa nhanh nhất, giảm tải CPU. | Tối ưu cho vi xử lý nhúng (Raspberry Pi/Jetson) trên Drone. |
| `-tune zerolatency` | Tắt buffer nội bộ, xuất frame ngay khi render. | Giảm thiểu độ trễ tối đa cho mục đích giám sát thời gian thực. |
| `-g 30` | Chu kỳ khung hình chính (GOP / Keyframe) = 30 frames (1 giây nếu 30fps). | Giúp người dùng khi vừa mở Web lên là **nhìn thấy hình ảnh ngay trong 0.5s**, không bị đen màn hình chờ I-frame. |
| `-b:v 2000k` | Giới hạn Bitrate trung bình 2 Mbps. | Tiết kiệm băng thông gói cước 4G/5G khi bay ngoài trời. |
| `-an` | Loại bỏ âm thanh (Audio). | Drone thường chỉ cần hình ảnh, bỏ audio giúp giảm thêm 10-15% băng thông. |
| `-rtsp_transport tcp` | Đẩy luồng RTSP qua giao thức TCP. | Chống hiện tượng vỡ hạt/mất gói hình ảnh khi sóng 4G chập chờn. |

---

## 2.3. Tạo Script tự động hóa giả lập (Mock Stream Service)

Để không phải gõ lại lệnh FFmpeg mỗi lần test, tạo script chạy tự động kèm tính năng tự kết nối lại nếu bị đứt mạng.

### Tạo file `mock_drone_stream.sh` (Linux / Raspberry Pi / macOS):
```bash
#!/bin/bash

# Cấu hình
SERVER_IP="10.13.37.1" # IP VPN WireGuard hoặc IP Public Server
DRONE_ID="DRONE-001"
VIDEO_FILE="./drone_sample.mp4"

echo "=== BẮT ĐẦU GIẢ LẬP TRUYỀN VIDEO CHO $DRONE_ID ==="

while true; do
    echo "[$(date)] Đang đẩy stream lên rtsp://$SERVER_IP:8554/live/$DRONE_ID ..."
    ffmpeg -re -stream_loop -1 -i "$VIDEO_FILE" \
      -c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline \
      -b:v 2000k -maxrate 2500k -bufsize 4000k \
      -pix_fmt yuv420p -g 30 -an \
      -f rtsp -rtsp_transport tcp \
      "rtsp://$SERVER_IP:8554/live/$DRONE_ID"
    
    echo "[$(date)] Mất kết nối! Thử kết nối lại sau 3 giây..."
    sleep 3
done
```

Cấp quyền thực thi và chạy:
```bash
chmod +x mock_drone_stream.sh
./mock_drone_stream.sh
```

---

## 2.4. Đóng gói Drone Mock Streamer bằng Docker (Chạy 1 chạm)

Nếu muốn test nhanh trên máy tính bất kỳ mà không cần cài FFmpeg, sử dụng Dockerfile sau:

### Tạo file `Dockerfile.drone-mock`:
```dockerfile
FROM linuxserver/ffmpeg:latest

WORKDIR /app
COPY drone_sample.mp4 /app/drone_sample.mp4

ENV SERVER_IP=127.0.0.1
ENV DRONE_ID=DRONE-001

CMD ffmpeg -re -stream_loop -1 -i /app/drone_sample.mp4 \
    -c:v libx264 -preset ultrafast -tune zerolatency \
    -b:v 2000k -maxrate 2500k -bufsize 4000k \
    -pix_fmt yuv420p -g 30 -an \
    -f rtsp -rtsp_transport tcp \
    rtsp://${SERVER_IP}:8554/live/${DRONE_ID}
```

Chạy container giả lập:
```bash
# Build image
docker build -f Dockerfile.drone-mock -t drone-video-mock .

# Run mock stream
docker run -d --name mock-drone-01 \
  -e SERVER_IP="YOUR_SERVER_IP" \
  -e DRONE_ID="DRONE-001" \
  drone-video-mock
```

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

# TỔNG KẾT QUY TRÌNH KIỂM THỬ (VERIFICATION CHECKLIST)

1. **Khởi động Media Server trên Cloud**:
   ```bash
   docker compose up -d media-server
   ```
2. **Chạy Mock Stream trên máy test**:
   ```bash
   ./mock_drone_stream.sh
   ```
3. **Kiểm tra luồng phát**:
   - Truy cập `http://<IP_SERVER>:8889/live/DRONE-001` trên trình duyệt Chrome/Edge/Firefox để xem player WebRTC tích hợp.
   - Nhúng WHEP WebRTC client vào Web Dashboard và kiểm tra độ trễ hiển thị trực tiếp.
