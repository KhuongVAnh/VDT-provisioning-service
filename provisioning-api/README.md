# Cấp Phát Thiết Bị Drone & Quản Lý VPN Động (NestJS)

Đây là API Cấp phát (Provisioning API) trung tâm dành cho Drone Companion Computer. Ứng dụng điều phối quá trình đăng ký thiết bị tự động (zero-touch), cấp phát động địa chỉ IP VPN nội bộ, thiết lập các peer WireGuard, và trả về các thông số kết nối cho drone.

## Yêu cầu hệ thống

- Node.js 18+
- npm hoặc yarn
- SQLite (Cho Giai đoạn 1) hoặc PostgreSQL
- Đã cài đặt `wireguard-tools` trên máy chủ (`wg` commands)

## Cài đặt

```bash
$ npm install
```

## Thiết lập & Cấu hình

1. Copy file `.env.example` sang `.env` và điền các thông tin bảo mật cần thiết.
   ```bash
   cp .env.example .env
   ```
2. Khởi tạo cơ sở dữ liệu Prisma.
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

## Chạy ứng dụng

```bash
# môi trường phát triển (development)
$ npm run start

# chế độ tự tải lại (watch mode)
$ npm run start:dev

# chế độ sản xuất (production)
$ npm run start:prod
```

## Triển khai

Vui lòng tham khảo [DEPLOYMENT.md](./DEPLOYMENT.md) để xem hướng dẫn đầy đủ, từng bước về cách thiết lập máy chủ VPS, cấu hình quyền sudo, khởi tạo interface máy chủ WireGuard, và cấu hình thiết bị Drone tại biên.

## Kiểm thử (Testing)

```bash
# chạy unit tests
$ npm run test

# chạy e2e tests
$ npm run test:e2e

# tính độ phủ code (test coverage)
$ npm run test:cov
```
