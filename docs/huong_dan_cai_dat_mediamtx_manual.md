# HƯỚNG DẪN CÀI ĐẶT, VẬN HÀNH & HỦY BỎ MEDIAMTX THỦ CÔNG TRÊN UBUNTU VPS
## (Native Systemd Service - Bảo mật & Tối ưu hiệu năng)

Tài liệu này hướng dẫn chi tiết các bước **cài đặt trực tiếp MediaMTX bằng file nhị phân (Binary)** trên máy chủ Ubuntu VPS thay vì dùng Docker. Cách này giúp tối ưu hóa 100% tài nguyên phần cứng, giảm độ trễ tối đa và dễ dàng kiểm soát cổng mạng nội bộ.

Cuối tài liệu là **Quy trình Tắt và Hủy sạch sẽ dịch vụ** để giải phóng toàn bộ tài nguyên (CPU, RAM, Port, Ổ đĩa) khi bạn muốn chuyển đổi sang VPS mới.

---

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                               UBUNTU VPS CLOUD                                   │
│                                                                                  │
│   [Drone qua WireGuard]                                                          │
│        │                                                                         │
│        │ RTSP (10.13.37.1:8554 - Kênh VPN nội bộ)                                │
│        ▼                                                                         │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │ MediaMTX Service (/usr/local/bin/mediamtx - Systemd)                     │   │
│   │ • Lắng nghe RTSP nội bộ: 10.13.37.1:8554 & 127.0.0.1:8554               │   │
│   │ • Lắng nghe HLS / WHEP nội bộ: 127.0.0.1:8888 / 127.0.0.1:8889           │   │
│   │ • KHÔNG MỞ BẤT KỲ CỔNG NÀO RA INTERNET (Zero Public Ports)               │   │
│   └────────────────────────────────────┬─────────────────────────────────────┘   │
│                                        │ Stream nội bộ (127.0.0.1)               │
│                                        ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │ NestJS API & Video Gateway (Cổng duy nhất: 10004)                         │   │
│   │ • WebSocket: ws://IP_VPS:10004/ws/video/:drone_id                        │   │
│   │ • HTTP Stream Proxy: http://IP_VPS:10004/api/v1/video/:drone_id/*        │   │
│   └────────────────────────────────────┬─────────────────────────────────────┘   │
└────────────────────────────────────────┼─────────────────────────────────────────┘
                                         │ Duy nhất Port 10004
                                         ▼
                             [Web Dashboard / Trình duyệt]
```

---

## PHẦN I: CÁC BƯỚC CÀI ĐẶT MEDIAMTX THỦ CÔNG

### Bước 1: Kiểm tra kiến trúc Chip và Tải MediaMTX

Đăng nhập SSH vào VPS của bạn và thực hiện:

#### Cách 1: Kiểm tra nhanh loại Chip (Kiến trúc CPU)
Chạy lệnh sau trên terminal VPS:
```bash
uname -m
```
* Nếu kết quả in ra là **`x86_64`** $\rightarrow$ VPS dùng chip **Intel / AMD 64-bit** (Phổ biến nhất: AWS EC2, DigitalOcean, Linode, Viettel Cloud, VNPT...). Chọn gói **`linux_amd64`**.
* Nếu kết quả in ra là **`aarch64`** hoặc **`arm64`** $\rightarrow$ VPS dùng chip **ARM 64-bit** (Oracle Cloud Always Free ARM Ampere, AWS Graviton...). Chọn gói **`linux_arm64v8`**.

---

#### Cách 2: Chạy đoạn lệnh TỰ ĐỘNG nhận diện chip và cài đặt (Khuyên dùng)
Đoạn script này sẽ tự động đọc kiến trúc chip của VPS để tải đúng bản MediaMTX tương ứng:

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

# 5. Cài đặt vào /usr/local/bin
sudo mv mediamtx /usr/local/bin/mediamtx
sudo chmod +x /usr/local/bin/mediamtx

# 6. Kiểm tra phiên bản sau khi cài đặt
/usr/local/bin/mediamtx --version
```

---

### Bước 2: Tạo file cấu hình bảo mật `mediamtx.yml`

Tạo thư mục cấu hình tại `/etc/mediamtx` và thiết lập các thông số chỉ cho phép truy cập nội bộ (bảo mật tuyệt đối, không lộ port ra ngoài):

```bash
# 1. Tạo thư mục chứa cấu hình
sudo mkdir -p /etc/mediamtx

# 2. Tạo file cấu hình mediamtx.yml
sudo tee /etc/mediamtx/mediamtx.yml > /dev/null << 'EOF'
#################################################################
# MEDIAMTX CONFIGURATION - DRONE FLEET INDUSTRIAL SYSTEM
# Kiến trúc: Chỉ lắng nghe nội bộ VPN và Localhost (Zero Public Ports)
#################################################################

# Chế độ Log (debug, info, warn, error)
logLevel: info
logDestinations: [stdout]

#################################################################
# 1. Giao thức RTSP (Nhận luồng Video trực tiếp từ Drone qua WireGuard)
#################################################################
rtsp: yes
rtspDisable: no
protocols: [tcp, udp]
encryption: "no"

# Cổng 8554 (TCP/UDP): Bắt tay và điều khiển luồng RTSP từ Drone
rtspAddress: 10.13.37.1:8554

# Cổng 8000 (UDP): Tiếp nhận các khung hình Video H.264 thực tế (RTP Payload) khi Drone phát qua UDP
rtpAddress: 10.13.37.1:8000

# Cổng 8001 (UDP): Đo lường chất lượng mạng, độ trễ và tỷ lệ mất gói tin (RTCP)
rtcpAddress: 10.13.37.1:8001


#################################################################
# 2. Giao thức RTMP (Tùy chọn)
#################################################################
rtmp: no

#################################################################
# 3. Giao thức HLS / LL-HLS (Cho NestJS HTTP Stream Proxy)
#################################################################
hls: yes
hlsAddress: 127.0.0.1:8888
hlsAlwaysRemux: yes
hlsVariant: lowLatency
hlsSegmentCount: 7
hlsSegmentDuration: 500ms
hlsPartDuration: 100ms

#################################################################
# 4. Giao thức WebRTC / WHEP (Chỉ lắng nghe localhost cho Gateway)
#################################################################
webrtc: yes
webrtcAddress: 127.0.0.1:8889
webrtcEncryption: no
webrtcLocalUDPAddress: 127.0.0.1:8189

#################################################################
# 5. API Điều khiển nội bộ
#################################################################
api: yes
apiAddress: 127.0.0.1:9997

#################################################################
# 6. Cấu hình luồng (Paths)
#################################################################
paths:
  # Cấu hình all_others cho phép mọi Drone tự động đẩy luồng động (ví dụ: live/<drone_id>)
  all_others:
    # Tự động giải phóng bộ nhớ đệm sau 10 giây nếu Drone ngắt kết nối
    sourceOnDemandCloseAfter: 10s
    runOnReadyRestart: yes
EOF
```

> **Giải thích cấu hình:**
> - `rtspAddress: 10.13.37.1:8554`: Drone gửi RTSP thẳng vào IP VPN của VPS.
> - `hlsAddress: 127.0.0.1:8888` & `webrtcAddress: 127.0.0.1:8889`: Chỉ mở cho NestJS (`127.0.0.1`) lấy dữ liệu.
> - `Zero Public Ports`: Không có cổng nào bị lộ ra Internet công cộng.

---

### Bước 3: Tạo Systemd Service tự khởi động cùng VPS

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

### Bước 4: Khởi chạy và kích hoạt dịch vụ

```bash
# 1. Tải lại cấu hình systemd
sudo systemctl daemon-reload

# 2. Kích hoạt tự khởi động khi bật VPS
sudo systemctl enable mediamtx

# 3. Bắt đầu chạy dịch vụ
sudo systemctl start mediamtx

# 4. Kiểm tra trạng thái đang chạy (Active: active (running))
sudo systemctl status mediamtx --no-pager
```

---

### Bước 5: Kiểm tra cổng mạng và xem log thời gian thực

```bash
# 1. Kiểm tra các cổng đang lắng nghe (đảm bảo chỉ nghe trên 10.13.37.1 và 127.0.0.1)
sudo netstat -tulpn | grep mediamtx
# Hoặc:
sudo ss -tulpn | grep mediamtx

# 2. Xem log hoạt động thời gian thực của MediaMTX
sudo journalctl -u mediamtx -f
```

---

## PHẦN II: HƯỚNG DẪN QUẢN TRỊ & BẢO TRÌ

| Thao tác | Câu lệnh thực thi |
| :--- | :--- |
| **Xem trạng thái** | `sudo systemctl status mediamtx` |
| **Khởi động lại** | `sudo systemctl restart mediamtx` |
| **Dừng tạm thời** | `sudo systemctl stop mediamtx` |
| **Xem log 100 dòng cuối** | `sudo journalctl -u mediamtx -n 100 --no-pager` |
| **Xem log realtime** | `sudo journalctl -u mediamtx -f` |
| **Sửa file cấu hình** | `sudo nano /etc/mediamtx/mediamtx.yml && sudo systemctl restart mediamtx` |

---

## PHẦN III: HƯỚNG DẪN TẮT VÀ HỦY SẠCH SẼ (DECOMMISSIONING GUIDE)
*(Thực hiện khi muốn đổi sang VPS khác, giải phóng 100% tài nguyên CPU, RAM, Port, Ổ đĩa)*

Khi bạn chuyển dự án sang máy chủ VPS khác hoặc không còn nhu cầu sử dụng MediaMTX trên VPS hiện tại, hãy chạy tuần tự các bước sau để dọn dẹp sạch sẽ:

### Bước 1: Dừng dịch vụ và hủy tự khởi động
```bash
# 1. Dừng tiến trình MediaMTX đang chạy
sudo systemctl stop mediamtx

# 2. Vô hiệu hóa tính năng tự khởi động cùng hệ điều hành
sudo systemctl disable mediamtx
```

### Bước 2: Xóa bỏ File Systemd Service và File cấu hình
```bash
# 1. Xóa file unit systemd
sudo rm -f /etc/systemd/system/mediamtx.service

# 2. Tải lại daemon của systemd để loại bỏ service khỏi danh sách quản lý
sudo systemctl daemon-reload
sudo systemctl reset-failed

# 3. Xóa thư mục chứa cấu hình mediamtx.yml
sudo rm -rf /etc/mediamtx
```

### Bước 3: Xóa file thực thi nhị phân (Binary) và thư mục tạm
```bash
# 1. Xóa file binary MediaMTX khỏi /usr/local/bin
sudo rm -f /usr/local/bin/mediamtx

# 2. Dọn dẹp các file cài đặt tạm thời (nếu còn)
sudo rm -rf /tmp/mediamtx*
```

### Bước 4: Kiểm tra xác nhận đã giải phóng 100% tài nguyên
```bash
# 1. Kiểm tra tiến trình (Không còn bất kỳ tiến trình mediamtx nào chạy ngầm)
ps aux | grep mediamtx | grep -v grep

# 2. Kiểm tra các cổng mạng (Cổng 8554, 8888, 8889 đã được giải phóng hoàn toàn)
sudo ss -tulpn | grep -E '8554|8888|8889|9997'

# 3. Kiểm tra trạng thái dịch vụ (Hệ thống báo Unit mediamtx.service could not be found)
sudo systemctl status mediamtx
```

✅ **Kết quả:** VPS của bạn đã được dọn dẹp hoàn toàn sạch sẽ như ban đầu, không để lại bất kỳ file rác, tiến trình chạy ngầm hay cổng mạng nào bị chiếm dụng.
