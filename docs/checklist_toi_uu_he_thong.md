# CHECKLIST CÁC TASK TỐI ƯU HỆ THỐNG CLOUD & DRONE TELEMETRY
## (Lộ Trình Tối Ưu Hiệu Năng, Giảm Độ Trễ & Mở Rộng Quy Mô Lớn)

---

## 📌 BẢNG TỔNG KẾT CÁC HẠNG MỤC TỐI ƯU

| Hạng mục | Mức độ ưu tiên | Thành phần liên quan | Lợi ích đạt được |
| :--- | :---: | :--- | :--- |
| **1. Lọc dữ liệu Telemetry theo ngưỡng (Deadband Filtering)** | 🔴 **Cao** | `telemetry-ingestion-service` (Go) | Giảm **85% – 90%** tải Redis & CPU trình duyệt. |
| **2. Tối ưu Đọc/Ghi & Hạ tầng Redis Quy Mô Lớn** | 🔴 **Cao** | Redis Server, Go Ingest & NestJS API | Giảm **90% – 95%** I/O Redis, triệt tiêu Stampede khi hàng ngàn User truy cập. |
| **3. Nâng cấp Video sang WebRTC WHEP** | 🔴 **Cao** | MediaMTX & `public/index.html` | Giảm độ trễ Video từ **1.2s xuống < 200ms**. |
| **4. Tối ưu Rendering trên Web Dashboard** | 🟡 **Trung bình** | `public/index.html` (Leaflet / HUD) | Giao diện mượt mà 60 FPS, không đơ khi có 50+ Drone. |
| **5. Tinh chỉnh Kernel Linux & WireGuard VPN** | 🟡 **Trung bình** | OS Linux VPS & WireGuard | Chống phân mảnh gói tin, tối đa hóa thông lượng 4G. |
| **6. Chuyển đổi Database & Lưu trữ Time-Series** | 🟢 **Dài hạn** | PostgreSQL / TimescaleDB / Prisma | Phục vụ lưu lịch sử đường bay (Blackbox) lâu dài. |

---

## I. NHÓM 1: TỐI ƯU NUỐT & PHÂN PHỐI TELEMETRY (GOLANG & REDIS)

### [x] Task 1.1: Bộ lọc biến thiên Telemetry (Deadband & Threshold Filtering)
- **Mục tiêu:** Không gửi các gói tin MAVLink giống hệt nhau khi Drone đứng yên hoặc bay thẳng ổn định.
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** trong `internal/state/filter.go` & `cmd/server/main.go`.
- **Cơ chế hoạt động:**
  - [x] Lưu `lastSentState` và `lastSentTime` trong RAM cho từng `deviceId`.
  - [x] Chỉ phát tin khi: $\Delta\text{GPS} \ge 0.5\text{m}$, $\Delta\text{Độ cao} \ge 0.3\text{m}$, $\Delta\text{Góc} \ge 2^\circ$, $\Delta\text{Pin} \ge 1\%$, hoặc đổi chế độ bay.
  - [x] **Heartbeat định kỳ:** Nếu Drone đứng yên 100%, vẫn bắn tối thiểu **1 lần mỗi 2 giây** để báo hiệu Drone còn Online.

### [x] Task 1.2: Giới hạn tần số phát (Downsampling / Rate Limiting)
- **Mục tiêu:** Khống chế tần số phát của mỗi Drone ra Redis Pub/Sub ở mức tối đa **4Hz (250ms/lần)** thay vì 10Hz – 50Hz của MAVLink thô.
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** (Khống chế `minInterval: 250ms` trong `DeadbandFilter`).

### [x] Task 1.3: Gom lệnh Redis Pipeline (Batch Processing)
- **Mục tiêu:** Giảm thời gian chờ I/O mạng giữa Go Service và Redis.
- **Trạng thái:** ✅ **ĐÃ HOÀN THÀNH** (`pipe := p.client.Pipeline()` thực thi HSet + Publish trong 1 network roundtrip).

### [ ] Task 1.4: Triệt tiêu ghi thừa & Gom Micro-Batching Pipeline trong Go Ingestion
- **Hạn chế hiện tại:**
  1. Ghi đúp dữ liệu vào 2 key khác nhau: vừa ghi Hash `drone:states`, vừa tạo thêm key String TTL `drone:state:<deviceId>`, khiến Redis tốn thêm CPU quản lý hàng ngàn timer hết hạn.
  2. Gửi lệnh Pipeline ngay lập tức cho từng frame đơn lẻ thay vì gom nhiều frame của các Drone trong một khung thời gian ngắn, gây lãng phí Syscall và Network roundtrips.
- **Ý tưởng khắc phục cụ thể:**
  - **Thay thế key String TTL bằng Sorted Set (`ZSET drone:heartbeats`):**
    - Loại bỏ hoàn toàn key String riêng lẻ `drone:state:<id>`.
    - Go Ingestion chỉ cập nhật 1 trường số (Score = Unix timestamp) vào `ZSET drone:heartbeats` (Member: `deviceId`, Score: `time.Now().Unix()`).
    - **Ưu điểm vượt trội:** Backend có thể lọc nhanh danh sách Drone Online (`ZRANGEBYSCORE drone:heartbeats (Now - 10) +inf`), đếm số lượng Drone đang bay (`ZCOUNT`), và dọn rác Drone ngắt kết nối lâu ngày (`ZREMRANGEBYSCORE`) chỉ bằng **1 câu lệnh duy nhất** trong nano-giây mà **không cần parse chuỗi JSON**, giảm ngay **50% tải ghi** cho Redis.
  - **Gom Micro-Batching tại Go Service:** Dùng bộ đệm hàng đợi (Buffered Channel) kết hợp Background Worker gom tất cả các frame nhận được trong chu kỳ **20ms – 30ms** (hoặc đủ 50 frames) rồi mới thực thi `pipe.Exec()` một lần duy nhất.
- **Lợi ích đạt được:** Giảm số lần gọi Pipeline từ **2,000 lần/giây xuống còn ~50 lần/giây** (với 200 Drone 10Hz), giải phóng 90% CPU I/O của Redis.


### [ ] Task 1.5: Phân luồng kênh Đa tầng (Kênh Focus 10Hz vs Kênh Lite 1Hz) & L1 Cache chống Cache Stampede
- **Hạn chế hiện tại:**
  1. Đổ chung toàn bộ dữ liệu 1,000 Drone vào 1 kênh `channel:drone:telemetry:all`, khiến NestJS đơn luồng phải nhận 10,000 tin/s và chạy `JSON.parse()` liên tục chỉ để lọc cho một vài User, gây quá tải CPU Node.js.
  2. Khi hàng ngàn User cùng F5 trang Web Dashboard (Thundering Herd / Cache Stampede), NestJS nã hàng ngàn lệnh `HGETALL drone:states` vào Redis đơn luồng, làm gián đoạn luồng stream thời gian thực.
- **Ý tưởng khắc phục cụ thể:**
  - **Quản lý phân tầng tần số qua Redis Set (`drone:focus_set`):**
    - Khi Pilot click chọn Focus 1 Drone trên Web Dashboard: Gateway thêm ID vào tập hợp Redis `SADD drone:focus_set "DRONE-001"` (khi bỏ chọn hoặc ngắt kết nối: `SREM`).
    - Go Ingestion Service đồng bộ `drone:focus_set` trong RAM:
      - *Nếu Drone nằm trong `focus_set`:* Go nuốt và phát ra **Kênh chi tiết tốc độ cao (`channel:drone:telemetry:full:<id>`) ở tần số 10Hz** (gồm đầy đủ góc nghiêng 3D, vận tốc, MAVLink).
      - *Nếu Drone KHÔNG nằm trong `focus_set`:* Go tự động bóp xuống **Kênh tóm tắt nhẹ (`channel:drone:telemetry:lite:<id>`) ở tần số 1Hz** (chỉ gửi tọa độ GPS, % pin và cờ cảnh báo cho tiểu đội / Drone nền).
  - **L1 In-Memory Cache (RAM Node.js) kết hợp SingleFlight Mutex tại NestJS:**
    - Lưu snapshot trạng thái trong RAM Node.js (TTL 500ms) được cập nhật liên tục từ Pub/Sub.
    - Khi có hàng ngàn User cùng F5 trang, **99.9% request đọc trực tiếp từ RAM Node.js (0ms Redis Latency)** thay vì gửi lệnh `HGETALL` vào Redis.
- **Lợi ích đạt được:** Triệt tiêu hoàn toàn nghẽn CPU Node.js và Go Service, tiết kiệm băng thông mạng và bảo vệ Redis an toàn tuyệt đối khi lưu lượng truy cập tăng đột biến.


### [ ] Task 1.6: Kiến trúc Đăng ký Kênh Động theo Nhu cầu & Phân quyền Admin / Pilot (On-Demand Dynamic Subscription)
- **Hạn chế hiện tại:**
  1. `MavlinkRelayGateway` đang dùng `psubscribe('channel:drone:raw:*')` để bắt toàn bộ byte nhị phân của mọi Drone kể cả khi không có ai xem, gây lãng phí tài nguyên socket và CPU Redis.
  2. Chưa có cơ chế phân luồng linh hoạt giữa chế độ xem toàn tiểu đội và xem chi tiết từng Drone cho cả luồng JSON lẫn luồng Raw Binary MAVLink.
- **Ý tưởng khắc phục cụ thể:**
  - **Chuẩn hóa kênh Raw MAVLink ánh xạ 1-1 với kênh JSON:**
    - Kênh MAVLink nhị phân được chia thành: `channel:drone:raw:full:<id>` (10–20Hz đầy đủ gói bay/cần lái) và `channel:drone:raw:lite:<id>` (1Hz chỉ lọc Heartbeat & GPS vị trí cho QGroundControl Multi-Vehicle).
  - **Định tuyến thông minh tại NestJS Gateway (On-Demand Sub):**
    - **Khi Pilot xem cả tiểu đội (Squad Mode trên Web & QGC):** Gateway gửi lệnh gom nhóm `SUBSCRIBE` các kênh `lite` ($D1, D2, D3$) cả bản JSON lẫn Raw MAVLink Lite. QGC và Web nhận tọa độ nhẹ để vẽ đồng thời 3 máy bay, tắt Video FPV và Raw Full để tiết kiệm 95% băng thông.
    - **Khi Pilot xem riêng 1 Drone (Focus / Cockpit Mode):**
      - *Với Drone Focus ($D1$):* Gateway `SUBSCRIBE` kênh `telemetry:full:D1` + kênh Raw MAVLink thô `raw:full:D1` (cho cần lái joystick) + bắt tay WebRTC WHEP phát Video Live FPV (< 200ms).
      - *Với các Drone nền ($D2, D3$):* Vẫn duy trì kênh `telemetry:lite` và `raw:lite` (1Hz) để cập nhật tọa độ nền, pin và kích hoạt còi báo động khẩn cấp nếu có sự cố.
    - **Khi Admin xem toàn bộ hệ thống (1,000+ Drone):** Gateway dùng `PSUBSCRIBE channel:drone:telemetry:lite:*` (cho Web) hoặc `PSUBSCRIBE channel:drone:raw:lite:*` (cho QGC) để giám sát toàn cảnh vùng trời ở mức tải nhẹ nhất.
- **Lợi ích đạt được:** Tiết kiệm tối đa băng thông mạng 4G, triệt tiêu việc xử lý tin nhắn thừa và cho phép hệ thống mở rộng lên hàng chục ngàn Drone.


### [ ] Task 1.7: Tinh chỉnh Cấu hình Lưu trữ & Quản lý Bộ nhớ Redis (Disable AOF & Memory Eviction)
- **Hạn chế hiện tại:**
  1. `docker-compose.yml` đang bật `--appendonly yes`, khiến mỗi cập nhật Telemetry ở tần số cao (10Hz – 50Hz) đều kích hoạt ghi đĩa AOF `fsync`, gây nghẽn Disk I/O và làm chậm chu trình xử lý RAM của Redis.
  2. Chưa cấu hình giới hạn dung lượng RAM trần (`maxmemory`) và chính sách dọn dẹp bộ nhớ, có nguy cơ bị Linux Kernel OOM-Killer tắt tiến trình khi đầy RAM.
- **Ý tưởng khắc phục cụ thể:**
  - **Tắt AOF cho Redis Telemetry:** Cấu hình `--appendonly no` và `--save ""` trong Docker Compose / `redis.conf`. Vì Telemetry là dữ liệu tức thời (dữ liệu bền vững đã nằm trong PostgreSQL), việc chạy 100% In-Memory giúp triệt tiêu nghẽn đĩa và đạt tốc độ hàng trăm ngàn Ops/giây.
  - **Cấu hình trần RAM & Eviction Policy:** Thiết lập `maxmemory 2gb` và `maxmemory-policy allkeys-lru` để Redis tự động giải phóng key ít dùng khi đầy bộ nhớ thay vì làm tràn RAM máy chủ.
  - **Nén bảng băm Listpack:** Cấu hình `hash-max-listpack-entries 1024` giúp nén các bảng băm `drone:ip_map`, `drone:sys_map` và `drone:states` dưới dạng `Listpack`, giảm 60% – 70% dung lượng RAM.
- **Lợi ích đạt được:** Loại bỏ hoàn toàn nghẽn đĩa `fsync`, tối ưu dung lượng RAM và bảo vệ Redis hoạt động ổn định 24/7.

### [ ] Task 1.8: Kích hoạt Redis Multi-Threading I/O & Tinh chỉnh Linux Kernel cho Redis
- **Hạn chế hiện tại:** Redis mặc định xử lý socket I/O đơn luồng, khi có hàng ngàn kết nối đồng thời từ các Gateway sẽ bị nghẽn thông lượng mạng. Linux Kernel mặc định có thể chặn cấp phát bộ nhớ khi Redis fork hoặc làm trễ độ trễ (latency spikes) do Transparent Huge Pages.
- **Ý tưởng khắc phục cụ thể:**
  - **Bật Redis Multi-Threaded I/O:** Cấu hình `io-threads 4` và `io-threads-do-reads yes` trong `redis.conf` để chia tải đọc/ghi socket mạng trên 4 core CPU (lõi thực thi lệnh vẫn an toàn đơn luồng).
  - **Tinh chỉnh Linux Kernel OS VPS:** Thiết lập `vm.overcommit_memory = 1` (tránh lỗi cấp phát RAM), `net.core.somaxconn = 1024` (tăng hàng đợi kết nối TCP), và tắt Transparent Huge Pages (`echo never > /sys/kernel/mm/transparent_hugepage/enabled`) để triệt tiêu hiện tượng giật độ trễ.
- **Lợi ích đạt được:** Tăng 2.5 – 3 lần thông lượng mạng Socket I/O và đảm bảo độ trễ Redis luôn ở mức micro-giây.

### [ ] Task 1.9: Kiến trúc Tách Đọc/Ghi (Master-Replica Replication) & Sharded Pub/Sub (Redis 7+) cho Quy Mô Siêu Lớn
- **Hạn chế hiện tại:** Một Node Redis duy nhất sẽ cạn kiệt băng thông khi hệ thống mở rộng lên hàng chục ngàn User. Trong cụm Redis Cluster, Pub/Sub truyền thống bị hiện tượng "bão broadcast" (Broadcast storm) làm nghẽn mạng giữa các Node.
- **Ý tưởng khắc phục cụ thể:**
  - **Mô hình Master - Read Replicas:** Node Master chỉ nhận luồng Ghi từ Go Ingestion Service; các Node Read Replicas nhận đồng bộ không đồng bộ để phục vụ hàng loạt NestJS Gateway Đọc và Subscribe, chia nhỏ tải mạng.
  - **Nâng cấp Sharded Pub/Sub (Redis 7.x `SSUBSCRIBE` / `SPUBLISH`):** Giới hạn phạm vi phát tin nhắn trong đúng slot quản lý của từng Drone, triệt tiêu 100% bão broadcast liên node trong cụm Cluster.
- **Lợi ích đạt được:** Cho phép hệ thống mở rộng quy mô phục vụ **50,000+ người dùng và hàng ngàn Drone đồng thời**.

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
