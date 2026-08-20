# Hướng Dẫn Đọc Mã Nguồn (Code Tour)

Tài liệu này sẽ hướng dẫn bạn cách đọc và hiểu mã nguồn của dự án **Device Provisioning API & Fleet Mission Control** theo một trình tự logic nhất, từ lúc request đi vào cho đến khi kết thúc xử lý. Bạn hãy mở mã nguồn trên trình biên tập (ví dụ: VSCode) và đi theo trình tự dưới đây. Tại mỗi file, tôi đã bổ sung sẵn các comment giải thích trực tiếp trong code để bạn tiện theo dõi.

---

## Trình Tự Đọc Khuyến Nghị

### Bước 1: Điểm neo đầu tiên (Điểm khởi chạy ứng dụng)
Khi ứng dụng bật lên, nó sẽ chạy từ đâu?
*   👉 **Mở file:** `src/main.ts`
*   **Tác dụng:** Đây là "cửa ngõ" khởi chạy toàn bộ server NestJS. Tại đây, ứng dụng thiết lập cổng lắng nghe (port 10004), cấu hình `ValidationPipe` (chặn request rác) và kích hoạt `app.useStaticAssets` để phục vụ giao diện SPA Dashboard từ thư mục `public/`.

### Bước 2: Cấu trúc xương sống (App Module)
Sau khi `main.ts` chạy, nó tải "khung xương" của ứng dụng là gì?
*   👉 **Mở file:** `src/app.module.ts`
*   **Tác dụng:** File này là nơi đăng ký, lắp ghép tất cả các "bộ phận" (Modules) lại với nhau: `ConfigModule` (đọc file `.env`), `PrismaModule` (kết nối DB), `DeviceModule` (thực thể Drone), `IpPoolModule` (quản lý IP), `WireguardModule` (giao tiếp kernel), `ProvisioningModule` và `DashboardModule`.

### Bước 3: Module Quản Lý Thiết Bị (Device Module)
Nơi quản lý dữ liệu và vòng đời thực thể Drone:
*   👉 **Mở file:** `src/device/device.service.ts`
*   **Tác dụng:** Đóng gói toàn bộ các thao tác CRUD với bảng `Device` qua Prisma: tìm kiếm theo `deviceId`, tạo mới thiết bị, cập nhật Public Key (Key Rotation), thu hồi thiết bị (`revokeDevice`), kích hoạt lại (`reActivateDevice`) và giải phóng IP an toàn.

### Bước 4: Module Cấp Phát Thiết Bị (Trái tim của dự án)
Bây giờ, hãy đi sâu vào luồng chính khi Drone gửi request gọi API:
*   👉 **Mở file:** `src/provisioning/provisioning.module.ts`
    *   *Tác dụng:* Đóng gói tính năng cấp phát, kết nối `DeviceModule`, `IpPoolModule` và `WireguardModule`.
*   👉 **Mở file:** `src/provisioning/provisioning.controller.ts`
    *   *Tác dụng:* Nơi định nghĩa các API Endpoint (ví dụ `POST /api/v1/provisioning/register`). Controller chỉ đóng vai trò "tiếp tân", nhận request và chuyển xuống cho Service.
*   👉 **Mở file:** `src/provisioning/dto/register-device.dto.ts`
    *   *Tác dụng:* Định nghĩa khuôn mẫu dữ liệu (Data Transfer Object). Bất kỳ Drone nào gửi request mà thiếu `deviceId` hoặc `provisionToken` thì sẽ bị chặn lại ngay lập tức tại cửa.
*   👉 **Mở file:** `src/provisioning/provisioning.service.ts`
    *   *Tác dụng:* **Nơi chứa 100% logic nghiệp vụ cấp phát:**
        1. Xác thực token an toàn bằng `crypto.timingSafeEqual`.
        2. Nếu thiết bị đã `ACTIVE`: Tự động xoay key (**Key Rotation**) để thiết bị được cấp Private Key mới hợp lệ.
        3. Nếu thiết bị mới: Cấp IP nhỏ nhất trong pool `10.13.37.X` -> Sinh keypair WireGuard -> Nạp peer vào kernel -> Lưu DB.
        4. Tự động khôi phục cấu hình VPN lúc server khởi động (`onModuleInit`).

### Bước 5: Module Dashboard Quản Trị (Dashboard Module)
Nơi cung cấp toàn bộ REST API phục vụ cho giao diện Dashboard Mission Control:
*   👉 **Mở file:** `src/dashboard/dashboard.service.ts`
    *   *Tác dụng:* Tổng hợp số liệu KPI, tính toán trực tiếp lưu lượng băng thông thực tế (Rx/Tx bytes), trạng thái Online (dựa vào WireGuard Handshake < 3 phút), vẽ ma trận 254 ô địa chỉ IP Pool, xử lý các nút bấm Khóa/Mở Khóa/Xóa Drone.
*   👉 **Mở file:** `src/dashboard/dashboard.controller.ts`
    *   *Tác dụng:* Cung cấp các endpoint: `/api/v1/dashboard/stats`, `/api/v1/dashboard/devices`, `/api/v1/dashboard/ip-pool`, v.v.

### Bước 6: Các Dịch Vụ Phụ Trợ (Services)
*   👉 **Mở file:** `src/ip-pool/ip-pool.service.ts`
    *   *Tác dụng:* Thuật toán cấp phát IP. Nó tự động tìm ra địa chỉ IP nhỏ nhất chưa được ai sử dụng trong dải `10.13.37.2` đến `10.13.37.254` và tính toán % sử dụng IP Pool.
*   👉 **Mở file:** `src/wireguard/wireguard.service.ts`
    *   *Tác dụng:* Chuyên tương tác với hệ điều hành Linux. Đây là nơi thực thi các lệnh `wg genkey`, nạp/xóa cấu hình `sudo wg set` và bóc tách dữ liệu thống kê từ lệnh `wg show wg0 dump`.
*   👉 **Mở file:** `src/prisma/prisma.service.ts`
    *   *Tác dụng:* Trình điều khiển cơ sở dữ liệu SQLite thông qua LibSQL Adapter.

### Bước 7: Giao diện Web SPA & Phía Drone
*   👉 **Mở file:** `public/index.html`
    *   *Tác dụng:* Giao diện Single-Page Application chuẩn Aerospace/Dark Mode cực kỳ hiện đại: xem KPI, quản lý đội Drone, bản đồ ma trận 254 ô IP Pool sinh động, biểu đồ băng thông thời gian thực (Chart.js) và bộ công cụ tạo lệnh cài đặt 1-Liner.
*   👉 **Mở file:** `scripts/onboard-agent.sh`
    *   *Tác dụng:* Mã nguồn chạy trên Raspberry Pi. Quét phần cứng, thăm dò MAVLink Heartbeat, tự động cập nhật OTA siêu nhẹ (chỉ tải 2 file khi có thay đổi) và kết nối VPN.
*   👉 **Mở file:** `.github/workflows/deploy.yml`
    *   *Tác dụng:* Tự động SSH vào VPS và deploy Docker mỗi khi bạn `git push` code lên GitHub.

---
*Ghi chú: Tất cả các file có đuôi `.spec.ts` là file dùng để test tự động (Unit Test), bạn có thể kiểm tra bằng lệnh `npm test`.*
