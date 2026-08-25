import { IsNotEmpty, IsString } from 'class-validator';

export class ClaimDroneDto {
  @IsString({ message: 'Mã định danh Drone (deviceId) phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Mã định danh Drone (deviceId) không được để trống' })
  deviceId: string;
}
