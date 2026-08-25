# CHECKLIST CÁC TASK TỐI ƯU HỆ THỐNG CLOUD & DRONE TELEMETRY
## (Lộ Trình Tối Ưu Hiệu Năng, Giảm Độ Trễ & Mở Rộng Quy Mô Lớn)

---

## 📌 BẢNG TỔNG KẾT CÁC HẠNG MỤC TỐI ƯU

| Hạng mục | Mức độ ưu tiên | Thành phần liên quan | Lợi ích đạt được |
| :--- | :---: | :--- | :--- |
| **1. Lọc dữ liệu Telemetry theo ngưỡng (Deadband Filtering)** | 🔴 **Cao** | `telemetry-ingestion-service` (Go) | Giảm **85% – 90%** tải Redis & CPU trình duyệt. |
| **2. Nâng cấp Video sang WebRTC WHEP** | 🔴 **Cao** | MediaMTX & `public/index.html` | Giảm độ trễ Video từ **1.2s xuống < 200ms**. |
| **3. Tối ưu Rendering trên Web Dashboard** | 🟡 **Trung bình** | `public/index.html` (Leaflet / HUD) | Giao diện mượt mà 60 FPS, không đơ khi có 50+ Drone. |
| **4. Tinh chỉnh Kernel Linux & WireGuard VPN** | 🟡 **Trung bình** | OS Linux VPS & WireGuard | Chống phân mảnh gói tin, tối đa hóa thông lượng 4G. |
| **5. Chuyển đổi Database & Lưu trữ Time-Series** | 🟢 **Dài hạn** | PostgreSQL / TimescaleDB / Prisma | Phục vụ lưu lịch sử đường bay (Blackbox) lâu dài. |

---

## I. NHÓM 1: TỐI ƯU NUỐT & PHÂN PHỐI TELEMETRY (GOLANG & REDIS)

### [x] Task 1.1: Bộ lọc biến thiên Telemetry (Deadband & Threshold Filtering)
- **Mục tiêu:** Không gửi các gói tin MAVLink giống hệt nhau khi Drone đứng yên hoặc bay thẳng ổn định.
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** trong `internal/state/filter.go` & `cmd/server/main.go`.
- **Cơ chế hoạt động:**
  - [x] Lưu `lastSentState` và `lastSentTime` trong RAM cho từng `deviceId`.
  - [x] Chỉ gọi `PUBLISH channel:drone:telemetry:*` khi:
    - $\Delta \text{Khoảng cách GPS} \ge 0.5\text{m}$ HOẶC $\Delta \text{Độ cao} \ge 0.3\text{m}$.
    - $\Delta \text{Heading} \ge 2^\circ$ HOẶC $\Delta \text{Roll/Pitch} \ge 1.5^\circ$.
    - $\Delta \text{Pin} \ge 1\%$ HOẶC $\Delta \text{Điện áp} \ge 100\text{mV}$.
    - **Sự kiện khẩn cấp:** Đổi `flightMode`, chuyển `ARMED/DISARMED`, cảnh báo mất GPS $\rightarrow$ Bắn NGAY LẬP TỨC.
  - [x] **Heartbeat định kỳ:** Nếu Drone đứng yên 100%, vẫn bắn tối thiểu **1 lần mỗi 2 giây** để báo hiệu Drone còn Online.

### [x] Task 1.2: Giới hạn tần số phát (Downsampling / Rate Limiting)
- **Mục tiêu:** Khống chế tần số phát của mỗi Drone ra Redis Pub/Sub ở mức tối đa **4Hz (250ms/lần)** thay vì 10Hz – 50Hz của MAVLink thô.
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** (Khống chế `minInterval: 250ms` trong `DeadbandFilter`).

### [x] Task 1.3: Gom lệnh Redis Pipeline (Batch Processing)
- **Mục tiêu:** Giảm thời gian chờ I/O mạng giữa Go Service và Redis.
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** (`pipe := p.client.Pipeline()` thực thi HSet + Publish trong 1 network roundtrip).

---

## II. NHÓM 2: TỐI ƯU TRUYỀN VIDEO LIVE (MEDIAMTX & WEBRTC WHEP)

### [x] Task 2.1: Mở cổng và cấu hình WebRTC WHEP trên VPS
- **Mục tiêu:** Kích hoạt kênh truyền video thời gian thực siêu thấp (< 30ms) thay thế cho Low-Latency HLS (~1s).
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** (Đã cấu hình MediaMTX single-port `:10005` UDP/TCP, lọc IP nội bộ).

### [x] Task 2.2: Nâng cấp hàm phát Video trên Web Dashboard (`public/index.html` & `public/js/video.js`)
- **Mục tiêu:** Trình duyệt tự động bắt tay qua `POST /api/v1/video/:id/whep`.
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** (Đã tích hợp WHEP, kỹ thuật **Client-First UDP Hole Punching**, hiển thị OSD HUD độ trễ chuẩn W3C và Fallback HLS).

### [ ] Task 2.3: Tối ưu truyền video thích ứng trên Drone (Dynamic Adaptive Bitrate)
- **Mục tiêu:** Drone tự động hạ độ phân giải / bitrate khi sóng 4G/5G bị yếu, không làm đứt luồng video.
- **Giải pháp:** Hoàn thiện vòng lặp kiểm tra RTCP / Ping trong script [`drone_stream_adaptive.sh`](../scripts/drone_stream_adaptive.sh) để tự đổi bitrate encoder V4L2/GStreamer on-the-fly.

---

## III. NHÓM 3: TỐI ƯU HIỆU NĂNG GIAO DIỆN WEB DASHBOARD (`public/js/`)

### [x] Task 3.1: Tối ưu chu kỳ vẽ giao diện bằng `requestAnimationFrame`
- **Mục tiêu:** Tránh re-render DOM liên tục khi có nhiều sự kiện WebSocket `telemetry:update` ùa về.
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** trong `public/js/socket.js` (Hàng đợi `telemetryRenderQueue` đồng bộ vẽ theo tần số làm tươi 60 FPS).

### [x] Task 3.2: Gom nhóm Icon bản đồ (Canvas Renderer)
- **Mục tiêu:** Bản đồ Leaflet không bị giật khi hiển thị trên 50+ Drone đồng thời.
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** trong `public/js/map.js` (Bật `preferCanvas: true` cho Leaflet Map).

### [x] Task 3.3: Giới hạn độ dài vệt đường bay (Flight Trail Truncation)
- **Mục tiêu:** Không làm tràn RAM trình duyệt khi Drone bay liên tục nhiều giờ.
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** trong `public/js/socket.js` (Giới hạn tối đa **150 điểm tọa độ gần nhất** cho Polyline).

---

## IV. NHÓM 4: TINH CHỈNH HẠ TẦNG MẠNG & WIREGUARD VPN (LINUX KERNEL)

### [ ] Task 4.1: Chống phân mảnh gói tin WireGuard (MTU Tuning = 1360 bytes)
- **Mục tiêu:** Tránh làm vỡ và phân mảnh gói tin UDP (IP Fragmentation) khi truyền video H.264 qua sóng 4G/LTE.

#### 🛠️ 1. Cách làm thực hiện:
* **Thiết bị áp dụng:** Cả **Drone (Companion Computer)** và **VPS** *(quan trọng nhất là Drone)*.
* **Cấu hình file tĩnh:** Thêm dòng `MTU = 1360` vào khối `[Interface]` trong `/etc/wireguard/wg0.conf` trên cả 2 thiết bị:
  ```ini
  [Interface]
  PrivateKey = <YOUR_PRIVATE_KEY>
  Address = 10.13.37.X/24
  MTU = 1360
  ```
* **Áp dụng nhanh trực tiếp (Runtime - Không cần restart mạng):**
  ```bash
  sudo ip link set dev wg0 mtu 1360
  ```

#### 📖 2. Giải thích ngắn gọn cơ chế kỹ thuật:
* **Vấn đề của con số mặc định 1500:**  
  Hạ tầng mạng chuẩn Ethernet chỉ cho phép gói tin tối đa **1500 bytes**. Nếu giữ nguyên 1500, khi cộng thêm phần phụ phí mã hóa của WireGuard (~60–80 bytes) và phần đóng gói ngầm của nhà mạng 4G/LTE (GTP-U/IPv6, ~60–80 bytes), tổng kích thước gói sẽ vượt quá 1500 bytes $\rightarrow$ **Trạm BTS 4G buộc phải xé nhỏ gói tin (IP Fragmentation) hoặc vứt bỏ (Drop).**
* **Tác hại nghiêm trọng lên Video H.264:**  
  Video nén H.264 truyền qua UDP nếu bị xé mảnh mà rớt dù chỉ 1 mảnh nhỏ sẽ làm hỏng toàn bộ khung hình, gây rách hình (tearing), giật lag và mất frame FPV nghiêm trọng.
* **Ý nghĩa con số 1360 bytes:**  
  Là kích thước ruột dữ liệu an toàn sau khi đã trừ hao toàn bộ các lớp vỏ bọc:
  $$\text{1500 (Gốc)} - \text{80 (Overhead 4G)} - \text{60 (Overhead WireGuard)} = \mathbf{1360\text{ bytes}}$$
  * **Trên Drone:** Ép luồng video H.264 cắt thành các block $\le 1360$ bytes để khi bọc mã hóa gửi qua sóng 4G không bị vỡ gói.
  * **Trên VPS:** Giới hạn dữ liệu điều khiển (MAVLink, lệnh bay) gửi ngược về Drone không bị nghẽn dọc đường.

### [ ] Task 4.2: Kích hoạt thuật toán điều khiển tắc nghẽn TCP BBR (Google Congestion Control)
- **Mục tiêu:** Tối đa hóa thông lượng mạng, triệt tiêu độ trễ hàng đợi và chống tụt bitrate video khi sóng 4G chập chờn.

#### 🛠️ 1. Cách làm thực hiện trên Ubuntu VPS:
Chạy 3 dòng lệnh sau trong Terminal VPS:
```bash
echo "net.core.default_qdisc=fq" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_congestion_control=bbr" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```
*Kiểm tra kích hoạt thành công (kết quả trả về `bbr`):*
```bash
sysctl net.ipv4.tcp_congestion_control
```

#### 📖 2. Tại sao BBR vượt trội hoàn toàn và bắt buộc phải bật?
* **Vấn đề của thuật toán cũ (CUBIC mặc định trên Linux):**  
  CUBIC dùng cơ chế kiểm soát theo "mất gói". Khi Drone bay trong vùng sóng 4G/5G, hiện tượng rớt gói ngẫu nhiên do nhiễu sóng là bình thường. Nhưng CUBIC lại **hiểu nhầm là nghẽn mạng $\rightarrow$ tự động bóp 50% băng thông truyền**, đồng thời nhồi nhét đầy các bộ đệm trung gian (Bufferbloat) khiến độ trễ video vọt từ **30ms lên 500ms – 1000ms**, gây đứng hình FPV.
* **Đột phá công nghệ của Google BBR:**
  1. ⚡ **Bơm dữ liệu ở tốc độ trần tối đa:** BBR đo liên tục băng thông thực tế và RTT nhỏ nhất để truyền tải mượt mà, **triệt tiêu 100% độ trễ hàng đợi (Bufferbloat)**.
  2. 🛡️ **Kháng mất gói 4G/LTE:** BBR vẫn duy trì **100% tốc độ truyền** ngay cả khi sóng không dây bị rớt gói ngẫu nhiên tới 15% – 20%.
  3. 🚀 **Hiệu quả thực tế:** Tăng tốc độ bắt tay WebRTC WHEP, giảm giật lag luồng video dự phòng HLS và giúp đường truyền điều khiển MAVLink phản hồi tức thì.

### [ ] Task 4.3: Nới rộng bộ đệm Socket mạng lên 16MB (Socket Buffer & BDP Optimization)
- **Mục tiêu:** Cung cấp đủ "sức chứa" bộ nhớ RAM trên VPS để không làm nghẽn băng thông khi truyền tải dữ liệu và luồng video liên tục.

#### 🛠️ 1. Cách làm thực hiện trên Ubuntu VPS:
Ghi cấu hình vĩnh viễn vào `/etc/sysctl.conf` và kích hoạt ngay:
```bash
echo "net.core.rmem_max=16777216" | sudo tee -a /etc/sysctl.conf
echo "net.core.wmem_max=16777216" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_rmem=4096 87380 16777216" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_wmem=4096 65536 16777216" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

#### 📖 2. Vấn đề của cấu hình mặc định trên Linux:
* **Mặc định:** Kernel Linux chỉ cấp cho mỗi socket mạng một bộ nhớ đệm (buffer) rất nhỏ, thường chỉ khoảng **128 KB – 212 KB**.
* **Cơ chế hoạt động:**
  * Khi VPS gửi dữ liệu (**Send Buffer - `wmem`**): Dữ liệu phải nằm ở buffer này cho đến khi nhận được gói xác nhận (ACK) từ phía nhận.
  * Khi VPS nhận dữ liệu (**Receive Buffer - `rmem`**): Dữ liệu từ mạng sẽ tạm trú ở buffer này trước khi ứng dụng (MediaMTX / WireGuard) kịp đọc và xử lý.
* **Hậu quả:** Khi truyền video bitrate cao hoặc luồng FPV qua mạng có độ trễ (như 4G/LTE), buffer vài trăm KB này sẽ bị **đầy ngay lập tức**. Khi buffer đầy:
  * Bên gửi buộc phải phanh gấp, ngừng truyền để đợi bên nhận dọn trống buffer.
  * Tốc độ truyền tải thực tế bị tụt thảm hại, dù đường truyền của VPS có thể là **1 Gbps**.

#### 📐 3. Công thức BDP (Bandwidth-Delay Product) chứng minh vì sao cần 16 MB:
Khả năng truyền tải dữ liệu tối đa mà không bị nghẽn phụ thuộc vào lượng dữ liệu có thể tồn tại đồng thời trên "đường ống" nối giữa 2 máy (*in-flight data*):
$$\text{BDP} = \text{Băng thông (Bandwidth)} \times \text{Độ trễ khứ hồi (RTT)}$$

* **Ví dụ tính toán thực tế:**
  * Băng thông VPS: $1\text{ Gbps} = 125\text{ MB/s}$
  * Ping qua sóng 4G/LTE: $100\text{ ms} = 0.1\text{ giây}$
  * **Dung lượng bộ đệm tối thiểu cần có:**
    $$\text{BDP} = 125\text{ MB/s} \times 0.1\text{ s} = \mathbf{12.5\text{ MB}} \quad (\text{Làm tròn cấu hình: } \mathbf{16\text{ MB}})$$

* **Hậu quả nếu chỉ giữ buffer mặc định 212 KB:**  
  Tốc độ tối đa bạn có thể đạt được qua mạng ping 100ms chỉ là:
  $$\text{Tốc độ tối đa} = \frac{212\text{ KB}}{0.1\text{ s}} \approx 2.12\text{ MB/s} \approx \mathbf{17\text{ Mbps}}$$
  *(Tức là thuê VPS mạng 1 Gbps nhưng thực tế truyền đi chỉ được ~17 Mbps vì bị thắt cổ chai ở bộ đệm Socket của Linux).*

---

## V. NHÓM 5: TỐI ƯU CƠ SỞ DỮ LIỆU & LƯU TRỮ LỊCH SỬ BAY (DATA PERSISTENCE)

### [x] Task 5.1: Chuyển đổi Database từ SQLite sang PostgreSQL
- **Mục tiêu:** Đảm bảo khả năng chịu tải ghi đồng thời (Concurrency Write) khi có nhiều thiết bị onboard cùng lúc.
- **Giải pháp & Hiện trạng:** Đã hoàn tất chuyển đổi `datasource` trong [`schema.prisma`](../provisioning-api/prisma/schema.prisma) sang `postgresql` qua adapter `@prisma/adapter-pg`. Thêm PostgreSQL container `postgres:16-alpine` với healthcheck vào Docker Compose, tự động đồng bộ schema và seed tài khoản Admin (`admin@gmail.com` / `admin`) khi container khởi động.

### [ ] Task 5.2: Lưu trữ lịch sử chuyến bay (Flight Blackbox Logs)
- **Mục tiêu:** Xem lại lộ trình chuyến bay (Flight Replay / Audit).
- **Giải pháp:** Sử dụng cơ chế ghi theo khối (Batch Insert) sau mỗi chuyến bay hoặc tích hợp **TimescaleDB / InfluxDB** để lưu tọa độ GPS theo chuỗi thời gian mà không làm phình bảng SQL chính.

---

## VI. NHÓM 6: DỌN DẸP & TỐI ƯU CODEBASE (CODE REFACTORING)

### [x] Task 6.1: Tinh gọn MAVLink & WebSockets
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** (Đã xây dựng `MavlinkRelayGateway` chuyển tiếp nhị phân trực tiếp trên Port 10004).

### [x] Task 6.2: Đồng bộ tài liệu và kiến trúc
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** (Đã cập nhật toàn bộ tài liệu MediaMTX, WHEP NAT, Redis Data Architecture và XBLink spec).
