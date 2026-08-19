# Hướng Dẫn Triển Khai Dịch Vụ Cấp Phát Thiết Bị Bằng Docker (Sạch Gọn)

Tài liệu này hướng dẫn chi tiết từng lệnh cần gõ để đưa mã nguồn API Cấp Phát Thiết Bị (Provisioning API) vào chạy bên trong Docker trên con VPS đã có sẵn WireGuard.

---

## 1. Yêu Cầu Đối Với VPS (Server)

- Đã chạy sẵn giao diện mạng VPN (`wg0`) trên VPS (tức là đã chạy `wg-quick up wg0`).
- Đã cài đặt **Docker** và **Docker Compose**.

---

## 2. Các Lệnh Triển Khai Lên VPS

### Bước 1: Tải Source Code về VPS
Mở Terminal (SSH) vào VPS của bạn và chạy lệnh clone code từ Git (nếu bạn dùng Git):
```bash
# Di chuyển vào thư mục cài đặt (ví dụ: /opt)
cd /opt

# Clone mã nguồn về VPS (Thay bằng link Github thật của bạn)
git clone https://github.com/KhuongVAnh/VDT-provisioning-service.git

# Di chuyển vào thư mục API
cd VDT-provisioning-service/provisioning-api
```
*(Nếu bạn không dùng Git, hãy dùng công cụ WinSCP hoặc lệnh `scp` để ném toàn bộ thư mục `provisioning-api` từ máy tính Windows của bạn lên thư mục `/opt` của VPS).*

### Bước 2: Cấu hình biến môi trường
Vẫn ở trong thư mục `provisioning-api` trên VPS, gõ lệnh copy file mẫu:
```bash
cp .env.example .env
```
Mở file bằng trình soạn thảo `nano`:
```bash
nano .env
```
Trong màn hình `nano`, hãy sửa các giá trị sau:
- `WG_SERVER_PUBLIC_KEY`: Điền Public Key của cái VPS mà bạn đang có.
- `WG_SERVER_ENDPOINT`: Đổi thành `IP_Public_Của_VPS:10006` (Ví dụ: `103.253.20.32:10006`).
- `PROVISION_SECRET_TOKEN`: Đặt mật khẩu bí mật (vd: `FACTORY_SECRET_2026`).

*Lưu xong bấm `Ctrl + O` -> `Enter` để lưu, và `Ctrl + X` để thoát.*

### Bước 3: Build và Chạy Docker (1 Lệnh duy nhất)
Gõ lệnh sau:
```bash
docker-compose up -d --build
```
Lệnh này sẽ tự động tải các gói cần thiết, thiết lập Database SQLite trong thư mục `data/` và chạy Server ngầm ở cổng `10004`.

*Để xem ứng dụng đã chạy lên chưa, gõ lệnh xem log:*
```bash
docker-compose logs -f
```
*(Bấm `Ctrl + C` để thoát màn hình log).*

---

## 3. Các Lệnh Cài Đặt Tại Biên (Trên Drone / Raspberry Pi)

Gắn màn hình/phím vào Drone hoặc SSH vào nó, sau đó chạy các lệnh sau:

### Bước 1: Cài đặt công cụ mạng
```bash
sudo apt update
sudo apt install -y wireguard-tools jq curl
```

### Bước 2: Chuyển script tự động vào hệ thống
(Giả sử bạn đã copy file `onboard-agent.sh` vào Drone).
```bash
# Tạo thư mục chứa code cho drone
sudo mkdir -p /opt/drone

# Chép file script vào thư mục
sudo cp onboard-agent.sh /opt/drone/onboard-agent.sh

# Cấp quyền cho phép file thực thi (chạy như phần mềm)
sudo chmod +x /opt/drone/onboard-agent.sh
```

### Bước 3: Khai báo IP của VPS
```bash
sudo nano /opt/drone/onboard-agent.sh
```
Sửa dòng `API_URL="http://10.0.0.1:10004/api/v1/provisioning/register"` thành IP Public của VPS. Cùng với đó là chỉnh sửa Token cho khớp với file `.env` trên Server.

### Bước 4: Chạy kích hoạt
```bash
sudo /opt/drone/onboard-agent.sh
```
Drone sẽ tự động gọi lên VPS, lấy IP và cấu hình, rồi tự động kết nối mạng VPN!

---

## 4. Lệnh Dọn Dẹp VPS (Khi không dùng nữa)
Khi bạn muốn trả VPS, vào lại thư mục chứa code và gõ:
```bash
docker-compose down --rmi all -v
```
Lệnh này xóa Container, xóa Image, và xóa nốt ổ cứng ảo chứa Database. Xong việc!
