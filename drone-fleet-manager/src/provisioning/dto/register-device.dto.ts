import { IsString, IsNotEmpty } from 'class-validator';

/**
 * Data Transfer Object (DTO): Bộ lọc dữ liệu đầu vào.
 * NestJS sẽ dùng các hàm Decorator (@IsString, @IsNotEmpty) để tự động kiểm tra định dạng dữ liệu
 * từ body của request gửi lên trước khi cho phép vào Controller.
 */
export class RegisterDeviceDto {
  // Bắt buộc phải có mã ID thiết bị (là chuỗi)
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  // Bắt buộc phải có mã xác thực (Token) để tránh giả mạo
  @IsString()
  @IsNotEmpty()
  provisionToken: string;

  // Tùy chọn, thông tin thêm về phần cứng
  @IsString()
  @IsNotEmpty()
  hardwareModel: string;
}
