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
*   **Tác dụng:** File này là nơi đăng ký, lắp ghép tất cả các "bộ phận" (Modules) lại với nhau: `ConfigModule` (đọc file `.env`), `PrismaModule` (kết nối DB), `ProvisioningModule`, v.v. Nhìn vào đây bạn sẽ thấy bức tranh tổng thể của các modules.

### Bước 3: Module Cấp Phát Thiết Bị (Trái tim của dự án)
Bây giờ, hãy đi sâu vào luồng chính khi Drone gửi request gọi API.
*   👉 **Mở file:** `src/provisioning/provisioning.module.ts`
    *   *Tác dụng:* Đóng gói tính năng cấp phát. Nhìn vào đây sẽ thấy tính năng này cần dùng đến Database (`Prisma`), `IpPool` và `Wireguard`.
*   👉 **Mở file:** `src/provisioning/provisioning.controller.ts`
    *   *Tác dụng:* Nơi định nghĩa các API Endpoint (ví dụ `POST /api/v1/provisioning/register`). Controller chỉ đóng vai trò "tiếp tân", nhận request và chuyển xuống cho "chuyên viên" là Service.
*   👉 **Mở file:** `src/provisioning/dto/register-device.dto.ts`
    *   *Tác dụng:* Định nghĩa khuôn mẫu dữ liệu (Data Transfer Object). Bất kỳ Drone nào gửi request mà thiếu `deviceId` hoặc `provisionToken` thì sẽ bị chặn lại ngay lập tức tại cửa.
*   👉 **Mở file:** `src/provisioning/provisioning.service.ts`
    *   *Tác dụng:* **Đây là file quan trọng nhất.** Nơi chứa 100% logic nghiệp vụ: Xác thực token -> Cấp phát IP -> Kích hoạt VPN -> Trả về kết quả. (Vui lòng đọc các comment step-by-step trong file này).

### Bước 4: Các Dịch Vụ Phụ Trợ (Services)
Service cấp phát (`ProvisioningService`) ở trên phải nhờ vả các dịch vụ con khác để hoàn thành nhiệm vụ. Hãy xem các dịch vụ con này hoạt động ra sao:
*   👉 **Mở file:** `src/ip-pool/ip-pool.service.ts`
    *   *Tác dụng:* Thuật toán cấp phát IP. Nó tự động tìm ra địa chỉ IP nhỏ nhất chưa được ai sử dụng trong dải `10.13.37.x`.
*   👉 **Mở file:** `src/wireguard/wireguard.service.ts`
    *   *Tác dụng:* Chuyên tương tác với hệ điều hành Linux. Đây là nơi thực thi các lệnh `wg genkey` và nạp cấu hình `sudo wg set` thẳng vào Kernel.
*   👉 **Mở file:** `src/prisma/prisma.service.ts`
    *   *Tác dụng:* Trình điều khiển cơ sở dữ liệu. Giúp kết nối tới file SQLite `dev.db` thông qua `LibSQL Adapter`.

### Bước 5: Phía thiết bị Drone (Edge Script)
Sau khi API xử lý xong, Drone sẽ làm gì tiếp?
*   👉 **Mở file:** `scripts/onboard-agent.sh`
    *   *Tác dụng:* Đây là mã nguồn chạy trên Raspberry Pi. Nó lấy ID phần cứng, gọi API của NestJS, nhận JSON trả về và tự động tạo ra file `/etc/wireguard/wg0.conf` rồi bật kết nối lên.

---
*Ghi chú: Tất cả các file có đuôi `.spec.ts` là file dùng để test tự động (Unit Test), bạn có thể bỏ qua nếu chỉ muốn hiểu logic hoạt động chính.*
