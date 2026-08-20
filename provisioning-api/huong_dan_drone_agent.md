# Hướng Dẫn Chi Tiết Cấu Hình Onboarding Agent Trên Drone (Raspberry Pi 4)

Tài liệu này giải thích chi tiết nguyên lý hoạt động, cấu trúc mã nguồn và vòng đời thực thi của 2 file cấu hình nằm trên máy tính nhúng Companion Computer (Raspberry Pi 4) của Drone:
1. **`scripts/onboard-agent.sh`**: Script tự động hóa toàn bộ quy trình nhận diện phần cứng, thăm dò MAVLink, định tuyến ngoại vi động, cấp phát VPN và tự phục hồi khi cấu hình lỗi.
2. **`config/drone-onboard.service`**: File cấu hình dịch vụ Systemd tự động chạy ở **mỗi lần bật nguồn**, đảm bảo Drone luôn thích ứng ngay cả khi kỹ thuật viên tháo lắp/đổi cổng cắm trước chuyến bay.

---

## 1. File `scripts/onboard-agent.sh`

File script này được thiết kế theo chuẩn **Plug-and-Play, Zero-Touch Provisioning & Self-Healing (Tự chữa lỗi)** với độ tin cậy cao, tích hợp đầy đủ cơ chế Fast Boot, Thăm dò MAVLink, Retry, Rollback và Bảo mật dữ liệu.

### Chi Tiết Từng Khối Xử Lý Trong Script:

#### Khối 1: Khai báo cấu hình (`CONFIGURATION`)
- **Tác dụng:** Gom toàn bộ biến cấu hình lên đầu file (URL API, Token nhà máy, Hardware Model, Baudrate mặc định `57600`).

#### Khối 2: Kiểm tra tiền điều kiện (`PRE-FLIGHT CHECKS`)
- Kiểm tra quyền `root` (sudo) và sự hiện diện của các công cụ bắt buộc: `jq`, `curl`, `wg`, `ip`, `awk`, `grep`, `sed`, `stty`, `timeout`.

#### Khối 3: Nhận diện định danh thiết bị (`DEVICE ID DISCOVERY`)
- **Ưu tiên 1:** Đọc số `Serial` phần cứng của CPU từ file `/proc/cpuinfo`.
- **Dự phòng (Fallback):** Nếu không đọc được CPU Serial, tự động chuyển sang đọc địa chỉ MAC của cổng mạng `eth0` hoặc WiFi `wlan0`.
- **Định dạng chuẩn:** Thêm tiền tố `DRONE-` (Ví dụ: `DRONE-10000000a1b2c3d4`).

#### Khối 4: Tự động quét & thăm dò Flight Controller (`SMART AP DETECTION & MAVLINK PROBING`)
- **Hỗ trợ mọi loại chip và cổng cắm:**
  1. *Native USB Autopilot:* MicroAir, Pixhawk, Cube, PX4, ArduPilot, Holybro, CUAV, Matek, SpeedyBee, STM32 CDC...
  2. *Chip USB-to-UART:* Toàn bộ họ Silicon Labs (CP2101/CP2102/CP2104/CP2108), FTDI (FT232), WCH (CH340/CH341/CH9102), Prolific (PL2303)...
  3. *Cổng USB CDC-ACM:* `/dev/ttyACM*`.
  4. *Cổng phần cứng GPIO:* `/dev/serial0`, `/dev/ttyAMA0`.
- **Chống nhận nhầm Modem SIM:** Tự động lọc và loại trừ hoàn toàn các cổng USB Serial phụ trợ của module SIM (SIMCom AT port, NMEA port, Quectel diag...).
- **Cơ chế MAVLink Heartbeat Probing:** Nếu cắm nhiều thiết bị USB Serial cùng lúc (ví dụ vừa cắm AP vừa cắm LiDAR/Gimbal), script sẽ thăm dò tín hiệu byte `0xFD` (MAVLink v2) hoặc `0xFE` (MAVLink v1) để chọn chính xác 100% cổng của Flight Controller.
- **Khả năng bất biến:** Gán theo đường dẫn `/dev/serial/by-id/...` giúp hệ thống không bị ảnh hưởng khi cắm đổi cổng USB.

#### Khối 5: Cập nhật cấu hình định tuyến MAVLink động (`DYNAMIC MAVLINK ROUTING`)
- So sánh cổng Flight Controller hiện tại với cổng đã lưu trong `/etc/mavlink-router/main.conf`.
- Nếu phát hiện thay đổi cổng ngoại vi (ví dụ phi công đổi cổng USB trước khi bay), script tự động cập nhật `Device=` mới và khởi động lại `mavlink-router` tức thì.

#### Khối 6: Khởi động siêu tốc & Tự chữa lỗi (`FAST BOOT & SELF-HEALING`)
- **Trường hợp file chuẩn:** Nếu file `/etc/wireguard/wg0.conf` đã tồn tại và interface `wg0` bật thành công -> Drone **hoàn tất khởi động trong < 3 giây**, sẵn sàng cất cánh ngay mà không cần gọi lại Cloud API.
- **Trường hợp file lỗi (Self-Healing):** Nếu file `wg0.conf` bị hỏng, rỗng, sai cú pháp, hoặc key không khớp khiến `wg show wg0` thất bại -> Script **tự động phát hiện lỗi và chuyển sang luồng cứu hộ** (chờ 5G -> gọi Cloud API để Key Rotation và ghi đè file cấu hình chuẩn mới).

#### Khối 7: Quét mạng di động 5G/4G (`WAIT FOR CELLULAR NETWORK`)
*(Chỉ chạy khi Drone xuất xưởng lần đầu hoặc khi cấu hình VPN cũ bị lỗi cần cấp cứu)*
- Tự động nhận diện mọi dòng module SIM (SIMCom 8260/7600, Quectel RM500/RM520/EC25, Fibocom, Telit) dù chạy dưới bất kỳ chế độ mạng nào (`wwan*`, `usb*` RNDIS/ECM, `enx*`, `wwx*`, `ppp*`, `eth1/2` PCIe HAT) hoặc qua Default Gateway Internet.

#### Khối 8: Gọi Provisioning API an toàn (`CALL PROVISIONING API`)
- Đóng gói JSON (`deviceId`, `hardwareModel`, `provisionToken`) và gửi POST lên VPS qua `curl -fsS`.
- Lưu response vào file tạm ẩn (`chmod 600`) và tự xóa ngay khi kết thúc (`trap EXIT`) để bảo mật tuyệt đối Private Key.
- Tự động retry tối đa 10 lần nếu mạng 5G chập chờn lúc mới bật nguồn.

#### Khối 9 & 10: Xác thực dữ liệu & Ghi đè cấu hình WireGuard / MAVLink
- Kiểm tra toàn diện dữ liệu trả về từ Cloud.
- Tự động sao lưu bản `.bak` và ghi đè file `/etc/wireguard/wg0.conf` (`chmod 600`) cùng `/etc/mavlink-router/main.conf`.

#### Khối 11 & 12: Khởi chạy WireGuard & Hoàn tất
- Bật interface `wg0` (tự động rollback cấu hình cũ nếu khởi động lỗi).
- Khởi động dịch vụ `mavlink-router` để truyền telemetry về Cloud.

---

## 2. File `config/drone-onboard.service`

Đây là file Unit Service của Systemd, đảm bảo script chạy tự động ở **mọi lần bật nguồn** (`multi-user.target`):

```ini
[Unit]
Description=Drone Dynamic Onboarding & Peripheral Routing Agent
Documentation=https://github.com/KhuongVAnh/VDT-provisioning-service
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
# Tự động tải file script về nếu trên máy Pi chưa có sẵn (Self-Bootstrapping)
ExecStartPre=/bin/sh -c 'if [ ! -f /opt/drone/onboard-agent.sh ]; then mkdir -p /opt/drone && curl -fsSL https://raw.githubusercontent.com/KhuongVAnh/VDT-provisioning-service/main/provisioning-api/scripts/onboard-agent.sh -o /opt/drone/onboard-agent.sh && chmod +x /opt/drone/onboard-agent.sh; fi'
ExecStart=/opt/drone/onboard-agent.sh
RemainAfterExit=yes
User=root
Group=root

# Tự động thử lại sau 15s nếu gặp lỗi mạng lúc mới bật nguồn
Restart=on-failure
RestartSec=15s
TimeoutStartSec=180

[Install]
WantedBy=multi-user.target
```

---

## 3. Sơ Đồ Toàn Bộ Vòng Đời Hoạt Động (Lifecycle Diagram)

```text
                        +------------------------------------+
                        |       BẬT NGUỒN DRONE (Pi 4)       |
                        +-----------------┬------------------+
                                          │
                                          ▼
                        +------------------------------------+
                        | 1. QUÉT & THĂM DÒ FLIGHT CONTROLLER|
                        |    - Quét /dev/serial/by-id/       |
                        |    - Thăm dò MAVLink (0xFD / 0xFE) |
                        |    - Loại trừ các cổng Modem SIM   |
                        +-----------------┬------------------+
                                          │
                                          ▼
                        +------------------------------------+
                        | 2. CẬP NHẬT MAIN.CONF NẾU ĐỔI CỔNG |
                        |    (Đổi cổng USB -> Tự reload)     |
                        +-----------------┬------------------+
                                          │
                                          ▼
                        Kiểm tra /etc/wireguard/wg0.conf ?
                                     /          \
                         (Đã có)    /            \   (Chưa có / Xuất xưởng)
                                   /              \
                                  ▼                \
                     Thử khởi động interface wg0   \
                             /          \           \
                 (Thành công)           (Thất bại)   \
                     /                     \          \
                    ▼                       ▼          ▼
         +--------------------+     +------------------------------------+
         |   FAST BOOT OK     |     |   CƠ CHẾ TỰ PHỤC HỒI (SELF-HEALING)|
         | - VPN wg0 đã chạy  |     |   (File lỗi, hỏng key, chưa cấp IP)|
         | - Bật mavlink      |     |                                    |
         | (Sẵn sàng bay <3s!)|     | 3. QUÉT CARD MẠNG 5G / SIM         |
         +----------┬---------+     |    (wwan*, usb*, enx*, Gateway...) |
                    │               +------------------┬-----------------+
                    │                                  │
                    │                                  ▼
                    │               +------------------------------------+
                    │               | 4. GỬI POST LÊN CLOUD PROVISIONING |
                    │               |    - Server nhận diện Device ID    |
                    │               |    - Server tự động Key Rotation   |
                    │               |    - Nhận IP & Private Key mới     |
                    │               +------------------┬-----------------+
                    │                                  │
                    │                                  ▼
                    │               +------------------------------------+
                    │               | 5. GHI ĐÈ FILE & BẬT LẠI WIREGUARD |
                    │               |    - Ghi đè file /etc/wireguard... |
                    │               |    - Kích hoạt lại wg-quick@wg0    |
                    │               +------------------┬-----------------+
                    │                                  │
                    +─────────────────┬────────────────+
                                      │
                                      ▼
            +---------------------------------------------------+
            |  MẠNG VPN THÔNG SUỐT & TRUYỀN DỮ LIỆU BAY VỀ CLOUD |
            |  - IP Drone  : 10.13.37.X                         |
            |  - Server VPN: 10.13.37.1                         |
            |  - MAVLink   : 10.13.37.1:14550                   |
            +---------------------------------------------------+
```
