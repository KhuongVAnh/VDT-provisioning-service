# Hướng Dẫn Triển Khai Dịch Vụ Cấp Phát Thiết Bị & Tự Động Hóa (CI/CD & OTA)

Tài liệu này hướng dẫn chi tiết từng lệnh cần gõ để đưa mã nguồn API Cấp Phát Thiết Bị (Provisioning API) vào chạy bên trong Docker trên VPS, đồng thời thiết lập tự động hóa:
1. **CI/CD trên VPS:** Tự động pull code và rebuild Docker mỗi khi `git push` lên GitHub.
2. **OTA Auto-Update trên Drone:** Drone tự động kéo bản mới của file `.sh` và `.service` khi bật nguồn (chỉ tải đúng 2 file nếu có thay đổi để tiết kiệm 100% dung lượng).

---

## 1. Yêu Cầu Đối Với VPS (Server)

- Đã chạy sẵn giao diện mạng VPN (`wg0`) trên VPS (tức là đã chạy `wg-quick up wg0`).
- Đã cài đặt **Docker** và **Docker Compose**.

---

## 2. Các Lệnh Triển Khai Lên VPS (Lần Đầu Tiên)

### Bước 1: Tải Source Code về VPS
Mở Terminal (SSH) vào VPS của bạn và clone code từ Git:
```bash
# Di chuyển vào thư mục cài đặt
cd /opt

# Clone mã nguồn về VPS
git clone https://github.com/KhuongVAnh/VDT-provisioning-service.git

# Di chuyển vào thư mục API
cd VDT-provisioning-service/provisioning-api
```

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
- `PROVISION_SECRET_TOKEN`: Đặt mật khẩu bí mật (vd: `FACTORY_SECRET_KEY_2026`).

*Lưu xong bấm `Ctrl + O` -> `Enter` để lưu, và `Ctrl + X` để thoát.*

### Bước 3: Build và Chạy Docker
```bash
docker compose up -d --build
```
*Để xem log ứng dụng:*
```bash
docker compose logs -f
```

---

## 3. Thiết Lập Tự Động Cập Nhật VPS Khi Push GitHub (CI/CD)

Dự án đã có sẵn file Workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). Để kích hoạt tính năng tự động cập nhật mỗi khi `git push`:

1. Truy cập vào GitHub Repository của bạn trên trình duyệt.
2. Chọn **Settings** -> **Secrets and variables** -> **Actions** -> Bấm **New repository secret**.
3. Thêm 3 biến bảo mật sau:
   - `VPS_HOST`: `103.253.20.32` (hoặc IP Public VPS của bạn).
   - `VPS_USERNAME`: `root` (hoặc user quản trị có quyền chạy docker).
   - `VPS_SSH_KEY`: Dán toàn bộ nội dung file Private Key SSH (`~/.ssh/id_rsa`) của bạn vào đây.

👉 **Từ bây giờ:** Bất cứ khi nào bạn sửa code trên máy tính và gõ `git push origin main`, GitHub sẽ tự động SSH vào VPS và cập nhật Docker trong 30 giây!

---

## 4. Cài Đặt Tại Biên (Trên Drone / Raspberry Pi 4)

Gắn màn hình/phím vào Drone hoặc SSH vào nó, sau đó chạy các lệnh sau:

### Cách 1: Cài đặt siêu nhanh bằng 1 Lệnh duy nhất (Khuyên dùng)
Chỉ cần copy và paste đúng 1 dòng này vào Terminal trên Drone (Pi 4):
```bash
sudo apt update && sudo apt install -y wireguard-tools jq curl && sudo mkdir -p /opt/drone && sudo curl -fsSL https://raw.githubusercontent.com/KhuongVAnh/VDT-provisioning-service/main/provisioning-api/config/drone-onboard.service -o /etc/systemd/system/drone-onboard.service && sudo systemctl daemon-reload && sudo systemctl enable --now drone-onboard.service
```
*(Lệnh này sẽ tự cài công cụ, tự tạo service và service sẽ tự động tải file `.sh` về chạy ngay lập tức).*

---

### Cách 2: Cài đặt thủ công từng bước

#### Bước 1: Cài đặt công cụ mạng
```bash
sudo apt update
sudo apt install -y wireguard-tools jq curl
```

#### Bước 2: Chép script và service vào hệ thống
```bash
# Tạo thư mục chứa code cho drone
sudo mkdir -p /opt/drone

# Chép file script vào thư mục
sudo cp scripts/onboard-agent.sh /opt/drone/onboard-agent.sh
sudo chmod +x /opt/drone/onboard-agent.sh

# Cài đặt dịch vụ chạy tự động ở mỗi lần bật nguồn
sudo cp config/drone-onboard.service /etc/systemd/system/drone-onboard.service
sudo systemctl daemon-reload
sudo systemctl enable --now drone-onboard.service
```

👉 **Cơ chế Tự Động Cập Nhật (OTA) trên Drone:**
- Ở mỗi lần bật nguồn tiếp theo, script sẽ tự động kiểm tra xem file `onboard-agent.sh` và `drone-onboard.service` trên GitHub có thay đổi không (dùng cơ chế HTTP Caching `curl -z` chỉ tốn ~500 Byte data).
- Nếu có bản mới trên GitHub, Drone sẽ tự động tải về, kiểm tra cú pháp và tự động chạy phiên bản mới mà bạn không cần phải cắm dây vào Drone để nạp lại!

---

## 5. Lệnh Dọn Dẹp VPS (Khi không dùng nữa)
Khi bạn muốn trả VPS, vào lại thư mục chứa code và gõ:
```bash
docker compose down --rmi all -v
```
Lệnh này xóa Container, xóa Image, và xóa nốt ổ cứng ảo chứa Database. Xong việc!
