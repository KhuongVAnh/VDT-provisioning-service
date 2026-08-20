# Hướng Dẫn Đọc Mã Nguồn (Code Tour)

Tài liệu này sẽ hướng dẫn bạn cách đọc và hiểu mã nguồn của dự án **Device Provisioning API** theo một trình tự logic nhất, từ lúc request đi vào cho đến khi kết thúc xử lý. Bạn hãy mở mã nguồn trên trình biên tập (ví dụ: VSCode) và đi theo trình tự dưới đây. Tại mỗi file, tôi đã bổ sung sẵn các comment giải thích trực tiếp trong code để bạn tiện theo dõi.

---

## Trình Tự Đọc Khuyến Nghị

### Bước 1: Điểm neo đầu tiên (Điểm khởi chạy ứng dụng)
Khi ứng dụng bật lên, nó sẽ chạy từ đâu?
*   👉 **Mở file:** `src/main.ts`
*   **Tác dụng:** Đây là "cửa ngõ" khởi chạy toàn bộ server NestJS. Tại đây, ứng dụng thiết lập cổng lắng nghe (port 10004) và cấu hình `ValidationPipe` (để tự động chặn các request rác gửi sai định dạng).

### Bước 2: Cấu trúc xương sống (App Module)
Sau khi `main.ts` chạy, nó tải "khung xương" của ứng dụng là gì?
*   👉 **Mở file:** `src/app.module.ts`
*   **Tác dụng:** File này là nơi đăng ký, lắp ghép tất cả các "bộ phận" (Modules) lại với nhau: `ConfigModule` (đọc file `.env`), `PrismaModule` (kết nối DB), `DeviceModule` (thực thể Drone), `IpPoolModule` (quản lý IP), `WireguardModule` (giao tiếp kernel) và `ProvisioningModule`.

### Bước 3: Module Quản Lý Thiết Bị (Device Module)
Nơi quản lý dữ liệu và vòng đời thực thể Drone:
*   👉 **Mở file:** `src/device/device.service.ts`
*   **Tác dụng:** Đóng gói toàn bộ các thao tác CRUD với bảng `Device` qua Prisma: tìm kiếm theo `deviceId`, tạo mới thiết bị, cập nhật Public Key (Key Rotation), thu hồi thiết bị (`revokeDevice`) và giải phóng IP an toàn.

### Bước 4: Module Cấp Phát Thiết Bị (Trái tim của dự án)
Bây giờ, hãy đi sâu vào luồng chính khi Drone gửi request gọi API:
*   👉 **Mở file:** `src/provisioning/provisioning.module.ts`
    *   *Tác dụng:* Đóng gói tính năng cấp phát, kết nối `DeviceModule`, `IpPoolModule` và `WireguardModule`.
*   👉 **Mở file:** `src/provisioning/provisioning.controller.ts`
    *   *Tác dụng:* Nơi định nghĩa các API Endpoint (ví dụ `POST /api/v1/provisioning/register`). Controller chỉ đóng vai trò "tiếp tân", nhận request và chuyển xuống cho Service.
*   👉 **Mở file:** `src/provisioning/dto/register-device.dto.ts`
    *   *Tác dụng:* Định nghĩa khuôn mẫu dữ liệu (Data Transfer Object). Bất kỳ Drone nào gửi request mà thiếu `deviceId` hoặc `provisionToken` thì sẽ bị chặn lại ngay lập tức tại cửa.
*   👉 **Mở file:** `src/provisioning/provisioning.service.ts`
    *   *Tác dụng:* **Đây là file quan trọng nhất.** Nơi chứa 100% logic nghiệp vụ:
        1. Xác thực token an toàn bằng `crypto.timingSafeEqual`.
        2. Nếu thiết bị đã `ACTIVE`: Tự động xoay key (**Key Rotation**) để thiết bị được cấp Private Key mới hợp lệ.
        3. Nếu thiết bị mới: Cấp IP nhỏ nhất trong pool `10.13.37.X` -> Sinh keypair WireGuard -> Nạp peer vào kernel -> Lưu DB.
        4. Tự động khôi phục cấu hình VPN lúc server khởi động (`onModuleInit`).

### Bước 5: Các Dịch Vụ Phụ Trợ (Services)
Service cấp phát (`ProvisioningService`) ở trên sử dụng các dịch vụ con khác để hoàn thành nhiệm vụ:
*   👉 **Mở file:** `src/ip-pool/ip-pool.service.ts`
    *   *Tác dụng:* Thuật toán cấp phát IP. Nó tự động tìm ra địa chỉ IP nhỏ nhất chưa được ai sử dụng trong dải `10.13.37.2` đến `10.13.37.254` (cấu hình linh hoạt qua biến môi trường `VPN_SUBNET_PREFIX`).
*   👉 **Mở file:** `src/wireguard/wireguard.service.ts`
    *   *Tác dụng:* Chuyên tương tác với hệ điều hành Linux. Đây là nơi thực thi các lệnh `wg genkey` và nạp/xóa cấu hình `sudo wg set` thẳng vào Kernel.
*   👉 **Mở file:** `src/prisma/prisma.service.ts`
    *   *Tác dụng:* Trình điều khiển cơ sở dữ liệu SQLite thông qua LibSQL Adapter.

### Bước 6: Phía thiết bị Drone (Edge Script)
Sau khi API xử lý xong, Drone sẽ làm gì tiếp?
*   👉 **Mở file:** `scripts/onboard-agent.sh`
    *   *Tác dụng:* Mã nguồn chạy trên Raspberry Pi. Nó quét phần cứng ngoại vi (thăm dò MAVLink để nhận diện đúng Flight Controller), tự động cập nhật OTA qua GitHub Raw (chỉ tải đúng 2 file `.sh` và `.service` khi có thay đổi), kích hoạt Fast Boot hoặc gọi Provisioning API.
*   👉 **Mở file:** `.github/workflows/deploy.yml`
    *   *Tác dụng:* Tự động SSH vào VPS và deploy Docker mỗi khi bạn `git push` code lên GitHub.

---
*Ghi chú: Tất cả các file có đuôi `.spec.ts` là file dùng để test tự động (Unit Test), bạn có thể kiểm tra bằng lệnh `npm test`.*
