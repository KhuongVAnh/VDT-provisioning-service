Bạn là một Principal System Architect & Senior Backend Engineer chuyên về hệ thống IoT/UAV Telemetry và Cloud Infrastructure. Hãy thiết kế và viết mã nguồn hoàn chỉnh cho Module **Device Provisioning & Dynamic VPN Management** bằng **NestJS (TypeScript)**, đặt nền móng cho tầng Business & API Gateway của nền tảng quản trị đội drone công nghiệp.

---

### I. BỐI CẢNH DỰ ÁN VÀ BÀI TOÁN KỸ THUẬT (PROJECT CONTEXT)

Dự án đang xây dựng hệ thống **Drone Companion Computer thương mại** (tương tự như thiết bị XBLink-5G) phục vụ bay tầm xa ngoài tầm nhìn (BVLOS), kết nối trực tiếp với Flight Controller để truyền nhận dữ liệu bay (MAVLink Telemetry), truyền video thời gian thực và quản trị thiết bị từ xa qua mạng 5G.

#### 1. Kiến trúc phần cứng tại biên (Edge Hardware):
* **Flight Controller (Autopilot):** MicroAir H742 chạy firmware ArduPilot, xuất luồng MAVLink 2 qua cổng TELEM nối vào Raspberry Pi qua chip chuyển đổi USB-to-TTL CP2102.
* **Companion Computer:** Raspberry Pi 4 Model B (hệ điều hành Ubuntu Server 24.04 LTS 64-bit).
* **Kết nối di động:** Module SIMCom 5G (SIM8260E) cắm cổng USB 3.0, kết nối Internet qua giao thức QMI/MBIM (card mạng `wwan0`).
* **Phần mềm trên Pi:** `mavlink-router` chuyển tiếp gói tin, `wireguard` client thiết lập mạng riêng ảo và script tự động kích hoạt (Onboarding Agent).

#### 2. Bài toán sản xuất hàng loạt (Zero-Touch Provisioning):
* Thẻ nhớ SD được nạp cùng một bản **Golden Image** duy nhất cho hàng trăm thiết bị.
* Không được cấu hình thủ công từng IP hoặc nạp sẵn Private Key tĩnh trên thẻ nhớ.
* **Quy trình khi xuất xưởng/bật nguồn lần đầu:**
  1. Pi 4 khởi động, kết nối mạng 5G thành công.
  2. Script chạy nền tự động đọc mã định danh duy nhất của phần cứng (CPU Serial Number hoặc eth0 MAC Address).
  3. Pi 4 gửi request HTTP POST kèm `Device ID` và `Factory Provisioning Token` lên Cloud Provisioning API.
  4. Cloud kiểm tra hợp lệ, tự động cấp phát địa chỉ IP VPN duy nhất trong dải `10.0.0.X`, sinh cặp khóa WireGuard, nạp peer trực tiếp vào kernel Linux của VPS mà không restart dịch vụ.
  5. Cloud trả về file cấu hình hoàn chỉnh; Pi tự ghi file `/etc/wireguard/wg0.conf` và `/etc/mavlink-router/main.conf`, sau đó tự kích hoạt VPN và gửi telemetry về Cloud.

#### 3. Định hướng kiến trúc Cloud tổng thể (Future-Proof Architecture):
* **Ingestion Layer (Golang):** Đảm nhiệm nuốt gói tin MAVLink UDP binary tốc độ cao, giải mã và đẩy vào Redis Pub/Sub (triển khai ở giai đoạn sau).
* **Business & API Gateway (NestJS - GIAI ĐOẠN HIỆN TẠI):** Chịu trách nhiệm toàn bộ phần quản lý vòng đời thiết bị (Device Provisioning), IP Pool, Auth, RBAC, API quản trị và WebSocket phát dữ liệu ra Web Dashboard.

---

### II. RÀNG BUỘC HẠ TẦNG VÀ THÔNG SỐ HỆ THỐNG (INFRASTRUCTURE SPECS)

* **Cloud VPS Public IP:** `103.253.20.32` (Lưu ý: Tường lửa VPS chặn gói ICMP ping, nhưng thông các cổng TCP/UDP được chỉ định).
* **WireGuard Server:** Chạy trực tiếp trên VPS với interface `wg0`, lắng nghe tại cổng **UDP `10006`**, IP máy chủ là `10.0.0.1/24`.
* **Dải mạng VPN nội bộ:** Subnet `10.0.0.0/24`, trong đó dải cấp phát cho Drone là từ **`10.0.0.2` đến `10.0.0.254`**.
* **Dải Port NAT công khai (TCP):** Chỉ được sử dụng các cổng từ `10001` đến `10005`.
  * **Cổng NestJS Provisioning API:** Lắng nghe tại TCP **`10004`**.
* **Ingestion MAVLink Endpoint (nội bộ VPS):** UDP `10.0.0.1:14550`.

---

### III. YÊU CẦU CHI TIẾT CHO DỊCH VỤ NESTJS (PHASE 1)

#### 1. Kiến trúc Module (NestJS Architecture):
Xây dựng dự án NestJS với cấu trúc module hóa rõ ràng:
* `ProvisioningModule`: Tiếp nhận và điều phối luồng đăng ký thiết bị mới.
* `DeviceModule`: Quản lý thực thể thiết bị, trạng thái kích hoạt, lưu trữ Database bằng **Prisma ORM** (sử dụng SQLite hoặc PostgreSQL).
* `IpPoolService`: Quản lý danh sách IP từ `10.0.0.2` đến `10.0.0.254`, cấp phát IP chưa sử dụng, tái sử dụng IP khi thiết bị bị xóa hoặc tái đăng ký.
* `WireguardService`: Module tương tác trực tiếp với hệ điều hành:
  * Sinh cặp khóa (Private Key / Public Key) cho thiết bị.
  * Thực thi lệnh shell: `sudo wg set wg0 peer <PUBLIC_KEY> allowed-ips <ASSIGNED_IP>/32`.
  * Cung cấp cơ chế rollback nếu thực thi shell command thất bại.

#### 2. Database Schema (Prisma Model `Device`):
Bao gồm các trường:
* `id` (UUID)
* `deviceId` (String, Unique - CPU Serial của Pi)
* `hardwareModel` (String)
* `vpnIp` (String, Unique - ví dụ `10.0.0.5`)
* `vpnPublicKey` (String)
* `vpnPrivateKey` (String - mã hóa an toàn hoặc chỉ lưu tạm để trả về 1 lần)
* `status` (Enum: `PENDING`, `ACTIVE`, `REVOKED`)
* `lastSeen` (DateTime)
* `createdAt`, `updatedAt`

#### 3. API Contract:
* **Endpoint:** `POST /api/v1/provisioning/register`
* **Request Body:**
  ```json
  {
    "deviceId": "DRONE-10000000a1b2c3d4",
    "hardwareModel": "Raspberry Pi 4 Model B Rev 1.5",
    "provisionToken": "FACTORY_SECRET_KEY_2026"
  }
  ```

**Logic xử lý:**

1. Kiểm tra `provisionToken` khớp với biến môi trường `PROVISION_SECRET_TOKEN`.

2. Nếu `deviceId` đã có trong Database: Trả về thông tin cấu hình hiện tại hoặc xoay key nếu trạng thái hợp lệ.

3. Nếu `deviceId` là thiết bị mới:

   - Lấy IP trống nhỏ nhất trong IP Pool.
   - Sinh cặp khóa WireGuard.
   - Nạp peer vào kernel Linux qua lệnh `wg set`.
   - Lưu thông tin thiết bị vào Database.

**Response Payload (JSON):**

```json
{
  "status": "success",
  "data": {
    "deviceId": "DRONE-10000000a1b2c3d4",
    "assignedIp": "10.0.0.5",
    "vpn": {
      "address": "10.0.0.5/24",
      "privateKey": "<CLIENT_PRIVATE_KEY>",
      "serverPublicKey": "<SERVER_PUBLIC_KEY>",
      "serverEndpoint": "103.253.20.32:10006",
      "allowedIps": "10.0.0.0/24",
      "persistentKeepalive": 25
    },
    "mavlink": {
      "targetHost": "10.0.0.1",
      "targetPort": 14550
    }
  }
}
```

#### 4. Kịch bản Onboarding Script trên Raspberry Pi 4:

Viết file Bash script `onboard-agent.sh` chuẩn POSIX, chạy trên Raspberry Pi 4, với các chức năng sau:

1. Tự đọc CPU Serial từ `/proc/cpuinfo`.

2. Đợi card mạng `wwan0` có IP Internet 5G.

3. Gọi `curl` để gửi JSON đến `http://103.253.20.32:10004/api/v1/provisioning/register`.

4. Sử dụng `jq` để bóc tách JSON, tự động sinh và ghi file `/etc/wireguard/wg0.conf`, đồng thời cập nhật `/etc/mavlink-router/main.conf`.

5. Khởi chạy các dịch vụ `wg-quick@wg0` và `mavlink-router`.

6. Tự hủy kích hoạt dịch vụ onboarding để không chạy lại ở các lần boot sau.

#### 5. Yêu cầu phân quyền & Bảo mật (Security & Sudoers):

1. Hướng dẫn thiết lập `/etc/sudoers.d/nest-wireguard` để user chạy NestJS có thể chạy `wg set` mà không cần password root.

2. Cung cấp file cấu hình mẫu `.env.example` đầy đủ các biến cấu hình.

---

### IV. DELIVERABLES VÀ HƯỚNG DẪN TRIỂN KHAI

Hãy cung cấp đầy đủ các nội dung sau:

1. Mã nguồn hoàn chỉnh của dự án NestJS.
2. Cấu trúc thư mục rõ ràng.
3. Prisma schema và migration cần thiết.
4. File `onboard-agent.sh` hoàn chỉnh cho Raspberry Pi 4.
5. File `.env.example` với đầy đủ biến cấu hình.
6. File sudoers mẫu cho quyền thực thi WireGuard.
7. Hướng dẫn triển khai từng bước trên VPS.
8. Hướng dẫn cài đặt và kích hoạt onboarding agent trên Pi 4.
9. Hướng dẫn kiểm tra API, WireGuard peer, IP Pool và rollback khi có lỗi.
