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
- **Giải pháp:** Hoàn thiện vòng lặp kiểm tra RTCP / Ping trong script [`drone_stream_adaptive.sh`](file:///home/kva_linux_os/project/provisioning_service/scripts/drone_stream_adaptive.sh) để tự đổi bitrate encoder V4L2/GStreamer on-the-fly.

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

### [ ] Task 4.1: Chống phân mảnh gói tin WireGuard (MTU Tuning)
- **Mục tiêu:** Tránh làm vỡ gói tin UDP khi truyền video H.264 qua 4G/LTE.
- **Giải pháp:** Đặt MTU card mạng `wg0` chuẩn xác là **`1420 bytes`** (hoặc `1360 bytes` cho mạng 4G có nhiều header đóng gói).

### [ ] Task 4.2: Kích hoạt thuật toán điều khiển tắc nghẽn BBR trên VPS
- **Mục tiêu:** Tăng tốc độ truyền tải video và giảm độ trễ hàng đợi trên Linux VPS.
- **Lệnh thực hiện trên Ubuntu VPS:**
  ```bash
  echo "net.core.default_qdisc=fq" | sudo tee -a /etc/sysctl.conf
  echo "net.ipv4.tcp_congestion_control=bbr" | sudo tee -a /etc/sysctl.conf
  sudo sysctl -p
  ```

### [ ] Task 4.3: Nới rộng bộ đệm Socket mạng (Network Buffer Optimization)
- **Lệnh thực hiện:**
  ```bash
  sudo sysctl -w net.core.rmem_max=16777216
  sudo sysctl -w net.core.wmem_max=16777216
  ```

---

## V. NHÓM 5: TỐI ƯU CƠ SỞ DỮ LIỆU & LƯU TRỮ LỊCH SỬ BAY (DATA PERSISTENCE)

### [ ] Task 5.1: Chuyển đổi Database từ SQLite sang PostgreSQL
- **Mục tiêu:** Đảm bảo khả năng chịu tải ghi đồng thời (Concurrency Write) khi có nhiều thiết bị onboard cùng lúc.
- **Giải pháp:** Cập nhật file [`schema.prisma`](file:///home/kva_linux_os/project/provisioning_service/provisioning-api/prisma/schema.prisma) chuyển provider sang `postgresql` và chạy `npx prisma migrate deploy`.

### [ ] Task 5.2: Lưu trữ lịch sử chuyến bay (Flight Blackbox Logs)
- **Mục tiêu:** Xem lại lộ trình chuyến bay (Flight Replay / Audit).
- **Giải pháp:** Sử dụng cơ chế ghi theo khối (Batch Insert) sau mỗi chuyến bay hoặc tích hợp **TimescaleDB / InfluxDB** để lưu tọa độ GPS theo chuỗi thời gian mà không làm phình bảng SQL chính.

---

## VI. NHÓM 6: DỌN DẸP & TỐI ƯU CODEBASE (CODE REFACTORING)

### [x] Task 6.1: Tinh gọn MAVLink & WebSockets
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** (Đã xây dựng `MavlinkRelayGateway` chuyển tiếp nhị phân trực tiếp trên Port 10004).

### [x] Task 6.2: Đồng bộ tài liệu và kiến trúc
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** (Đã cập nhật toàn bộ tài liệu MediaMTX, WHEP NAT, Redis Data Architecture và XBLink spec).
