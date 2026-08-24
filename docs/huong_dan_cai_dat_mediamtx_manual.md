# HƯỚNG DẪN CÀI ĐẶT, CẤU HÌNH WEBRTC WHEP & VẬN HÀNH MEDIAMTX THỦ CÔNG TRÊN UBUNTU VPS
## (Native Systemd Service - Tối ưu Ultra-Low Latency < 30ms cho Drone BVLOS)

Tài liệu này hướng dẫn chi tiết các bước **cài đặt và cấu hình trực tiếp MediaMTX bằng file nhị phân (Binary)** trên máy chủ Ubuntu VPS. Cách cài đặt Native Systemd này giúp:
1. Tối ưu hóa 100% tài nguyên phần cứng (CPU, RAM), loại bỏ hoàn toàn độ trễ trung gian của Docker Bridge.
2. Hỗ trợ chuẩn **WebRTC WHEP (WebRTC HTTP Egress Protocol)** truyền video thời gian thực siêu tốc (**`< 30ms`**) qua cổng **10005 (UDP/TCP)** với kỹ thuật **Client-First UDP Hole Punching**.
3. Bảo mật tuyệt đối luồng dữ liệu thông qua **NestJS Video Gateway Token Guard (Cổng 10004)**.
4. Cung cấp quy trình **Quản trị, Kiểm tra gói tin & Hủy bỏ sạch sẽ** khi chuyển đổi VPS.

---

## 🏗️ SƠ ĐỒ KIẾN TRÚC TỔNG THỂ HỆ THỐNG TRUYỀN HÌNH ẢNH

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                     UBUNTU VPS CLOUD                                     │
│                                                                                          │
│   [Drone qua WireGuard VPN]                                                              │
│        │                                                                                 │
│        │ 1. RTSP Video H.264 (10.13.37.1:8554 - Kênh mã hóa nội bộ)                      │
│        ▼                                                                                 │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐   │
│   │ MediaMTX Service (/usr/local/bin/mediamtx - Native Systemd)                      │   │
│   │ • RTSP Server nội bộ VPN: 10.13.37.1:8554 & 127.0.0.1:8554                      │   │
│   │ • HLS / WHEP Signaling nội bộ: 127.0.0.1:8888 & 127.0.0.1:8889                   │   │
│   │ • WebRTC Media Streaming: 0.0.0.0:10005 (UDP & TCP Multiplexing)                 │   │
│   │ • Single Public Host: 103.253.20.32:10005 (Đã lọc sạch IP nội bộ rác)           │   │
│   └──────────────────────┬───────────────────────────────────┬───────────────────────┘   │
│                          │                                   │                           │
│                          │ Bắt tay WHEP (127.0.0.1:8889)     │                           │
│                          ▼                                   │                           │
│   ┌──────────────────────────────────────────────────────┐   │                           │
│   │ NestJS Provisioning API & Video Gateway (Cổng 10004) │   │                           │
│   │ • Xác thực Token / Quyền phi công                    │   │                           │
│   │ • WHEP Proxy: POST /api/v1/video/:drone_id/whep      │   │                           │
│   │ • HLS Proxy:  GET  /api/v1/video/:drone_id/hls/*     │   │                           │
│   └──────────────────────┬───────────────────────────────┘   │                           │
└──────────────────────────┼───────────────────────────────────┼───────────────────────────┘
                           │                                   │
           [1. Bắt tay Signaling WHEP qua HTTP]                │ [2. Luồng Video WebRTC RTP]
           http://IP_VPS:10004/api/v1/video/:id/whep           │ udp://IP_VPS:10005 (< 30ms)
                           │                                   │
                           ▼                                   ▼
                ┌─────────────────────────────────────────────────────────┐
                │          [Web Dashboard - Cockpit Mission FPV]          │
                │ • Kỹ thuật Client-First UDP Hole Punching               │
                │ • Đo RTT Latency, Bitrate, Resolution thời gian thực    │
                │ • Tự động chuyển đổi camera khi chọn Drone trên bản đồ  │
                └─────────────────────────────────────────────────────────┘
```

---

## PHẦN I: CÁC BƯỚC CÀI ĐẶT MEDIAMTX THỦ CÔNG

### Bước 1: Kiểm tra kiến trúc Chip và Tải MediaMTX

Đăng nhập SSH vào VPS của bạn và chạy đoạn script tự động nhận diện kiến trúc CPU:

```bash
# 1. Cập nhật hệ thống và cài đặt công cụ cần thiết
sudo apt-get update
sudo apt-get install -y wget tar curl

# 2. Tạo thư mục tạm
mkdir -p /tmp/mediamtx_install && cd /tmp/mediamtx_install

# 3. Tự động phát hiện chip và tải phiên bản phù hợp
VERSION="v1.9.3"
ARCH=$(uname -m)

if [ "$ARCH" = "x86_64" ]; then
    FILE_ARCH="linux_amd64"
elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    FILE_ARCH="linux_arm64v8"
else
    FILE_ARCH="linux_armv7"
fi

echo "[INFO] Đang tải MediaMTX ${VERSION} cho kiến trúc: ${FILE_ARCH}..."
wget "https://github.com/bluenviron/mediamtx/releases/download/${VERSION}/mediamtx_${VERSION}_${FILE_ARCH}.tar.gz"

# 4. Giải nén
tar -zxvf mediamtx_${VERSION}_${FILE_ARCH}.tar.gz

# 5. Cài đặt file nhị phân vào /usr/local/bin
sudo mv mediamtx /usr/local/bin/mediamtx
sudo chmod +x /usr/local/bin/mediamtx

# 6. Kiểm tra phiên bản sau khi cài đặt
/usr/local/bin/mediamtx --version
```

---

### Bước 2: Tạo file cấu hình chuẩn WebRTC WHEP `mediamtx.yml`

Tạo thư mục cấu hình tại `/etc/mediamtx` và thiết lập các thông số tối ưu cho đường truyền BVLOS:

> ⚠️ **Lưu ý quan trọng:** Thay thế `IP_PUBLIC_CUA_VPS` ở dòng `webrtcAdditionalHosts` bằng IP Public thực tế của VPS bạn (ví dụ: `103.253.20.32`).

```bash
# 1. Tạo thư mục chứa cấu hình
sudo mkdir -p /etc/mediamtx

# 2. Tạo file cấu hình mediamtx.yml
sudo tee /etc/mediamtx/mediamtx.yml > /dev/null << 'EOF'
#################################################################
# MEDIAMTX CONFIGURATION - DRONE FLEET INDUSTRIAL SYSTEM
# Kiến trúc: WebRTC WHEP Ultra-Low Latency + Single-Port Multiplexing
#################################################################

logLevel: info
logDestinations: [stdout]

#################################################################
# 1. Giao thức RTSP (Nhận luồng Video trực tiếp từ Drone qua WireGuard)
#################################################################
rtsp: yes
rtspDisable: no
protocols: [tcp, udp]
encryption: "no"

# Cổng 8554 (TCP/UDP): Bắt tay và điều khiển luồng RTSP từ Drone trên VPN
rtspAddress: 10.13.37.1:8554

# Cổng 8000 (UDP): Tiếp nhận RTP Payload khung hình H.264
rtpAddress: 10.13.37.1:8000

# Cổng 8001 (UDP): Đo lường chất lượng mạng và tỷ lệ mất gói RTCP
rtcpAddress: 10.13.37.1:8001


#################################################################
# 2. Giao thức RTMP
#################################################################
rtmp: no


#################################################################
# 3. Giao thức HLS (Kênh dự phòng Fallback khi client chặn UDP)
#################################################################
hls: yes
hlsAddress: 127.0.0.1:8888
hlsAlwaysRemux: yes
hlsVariant: lowLatency
hlsSegmentCount: 7
hlsSegmentDuration: 500ms
hlsPartDuration: 100ms


#################################################################
# 4. Giao thức WebRTC / WHEP (< 30ms cho Phi công BVLOS)
#################################################################
webrtc: yes
webrtcAddress: 127.0.0.1:8889
webrtcEncryption: no

# Cổng UDP chính để truyền nhận gói tin Video RTP thời gian thực
webrtcLocalUDPAddress: :10005

# Cổng TCP dự phòng (giúp giải cứu 100% kết nối khi người dùng ở mạng chặn UDP)
webrtcLocalTCPAddress: :10005

# 🛑 1. TẮT TỰ ĐỘNG QUÉT CÁC CARD MẠNG NỘI BỘ VÀ DOCKER TRÊN VPS:
# Giúp loại bỏ 20 IP nội bộ rác (Docker, K8s, WireGuard) trong bản tin SDP
webrtcIPsFromInterfaces: no

# ✅ 2. KHAI BÁO IP PUBLIC VPS DUY NHẤT:
# Thay IP_PUBLIC_CUA_VPS bằng địa chỉ IP Public thực tế của bạn (ví dụ: 103.253.20.32)
webrtcAdditionalHosts: [ "IP_PUBLIC_CUA_VPS" ]



#################################################################
# 5. API Điều khiển nội bộ
#################################################################
api: yes
apiAddress: 127.0.0.1:9997


#################################################################
# 6. Cấu hình luồng (Paths)
#################################################################
paths:
  # Cho phép mọi Drone tự động đẩy luồng động (ví dụ: live/<drone_id>)
  all_others:
    sourceOnDemandCloseAfter: 10s
    runOnReadyRestart: yes
EOF
```

---

### Bước 3: Mở cổng Firewall trên VPS

Cho phép cổng `10005` (UDP và TCP) đi qua tường lửa của Ubuntu VPS:

```bash
# 1. Mở cổng UDP 10005 (Kênh truyền video chính)
sudo ufw allow 10005/udp

# 2. Mở cổng TCP 10005 (Kênh dự phòng)
sudo ufw allow 10005/tcp

# 3. Tải lại cấu hình tường lửa
sudo ufw reload

# 4. Kiểm tra trạng thái tường lửa
sudo ufw status
```

---

### Bước 4: Tạo Systemd Service tự khởi động cùng VPS

Tạo file service quản trị tại `/etc/systemd/system/mediamtx.service`:

```bash
sudo tee /etc/systemd/system/mediamtx.service > /dev/null << 'EOF'
[Unit]
Description=MediaMTX Realtime Video Media Server
After=network.target network-online.target wg-quick@wg0.service
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/mediamtx /etc/mediamtx/mediamtx.yml
Restart=always
RestartSec=3s
LimitNOFILE=65536

# Bảo mật tiến trình
ProtectSystem=full
ProtectHome=yes

[Install]
WantedBy=multi-user.target
EOF
```

---

### Bước 5: Khởi chạy và kiểm tra dịch vụ

```bash
# 1. Tải lại cấu hình systemd
sudo systemctl daemon-reload

# 2. Kích hoạt tự khởi động khi bật VPS
sudo systemctl enable mediamtx

# 3. Bắt đầu chạy dịch vụ
sudo systemctl restart mediamtx

# 4. Kiểm tra trạng thái đang chạy (Active: active (running))
sudo systemctl status mediamtx --no-pager
```

Kiểm tra các cổng mạng đang mở:
```bash
sudo ss -ulpn | grep mediamtx
# Kết quả chuẩn: 
# *:10005 (UDP WebRTC)
# 10.13.37.1:8554 (RTSP VPN)
# 127.0.0.1:8889 (WHEP Localhost)
```

---

## PHẦN II: HƯỚNG DẪN QUẢN TRỊ, DEBUG & BẮT GÓI TIN

### 1. Bảng lệnh quản trị nhanh

| Thao tác | Câu lệnh thực thi |
| :--- | :--- |
| **Xem trạng thái** | `sudo systemctl status mediamtx` |
| **Khởi động lại** | `sudo systemctl restart mediamtx` |
| **Dừng tạm thời** | `sudo systemctl stop mediamtx` |
| **Xem log realtime** | `sudo journalctl -u mediamtx -f` |
| **Xem 50 dòng log cuối**| `sudo journalctl -u mediamtx -n 50 --no-pager` |
| **Sửa file cấu hình** | `sudo nano /etc/mediamtx/mediamtx.yml && sudo systemctl restart mediamtx` |

---

### 2. Kỹ thuật Debug bắt gói tin UDP bằng `tcpdump`

Để kiểm tra trực tiếp xem gói tin WebRTC UDP giữa Drone, VPS và Máy tính phi công có thông suốt hay không:

```bash
# Theo dõi gói tin UDP trên cổng 10005
sudo tcpdump -i ens192 -n "udp port 10005"
```

**Dấu hiệu nhận biết kết nối thành công:**
1. Thấy gói tin `112 byte` từ IP máy bạn gửi lên cổng `10005` (Trình duyệt bắn STUN Request trước).
2. Thấy gói tin `64 byte` và `100 byte` từ VPS trả về đúng IP/Port máy bạn (MediaMTX phản hồi STUN Response & DTLS).
3. Luồng gói tin video RTP liên tục được đẩy về máy bạn với tốc độ 30 FPS.

---

## PHẦN III: HƯỚNG DẪN TẮT VÀ HỦY SẠCH SẼ (DECOMMISSIONING GUIDE)
*(Thực hiện khi muốn đổi sang VPS mới, giải phóng 100% CPU, RAM, Port, Ổ đĩa)*

```bash
# 1. Dừng và vô hiệu hóa dịch vụ
sudo systemctl stop mediamtx
sudo systemctl disable mediamtx

# 2. Xóa file unit systemd và cấu hình
sudo rm -f /etc/systemd/system/mediamtx.service
sudo rm -rf /etc/mediamtx
sudo systemctl daemon-reload
sudo systemctl reset-failed

# 3. Xóa file thực thi nhị phân
sudo rm -f /usr/local/bin/mediamtx
sudo rm -rf /tmp/mediamtx*

# 4. Xác nhận dọn dẹp sạch sẽ 100%
ps aux | grep mediamtx | grep -v grep
sudo ss -tulpn | grep -E '8554|8888|8889|10005'
```

✅ **Kết quả:** Máy chủ được giải phóng hoàn toàn sạch sẽ, không còn bất kỳ file rác hay tiến trình chạy ngầm nào! 🚀
