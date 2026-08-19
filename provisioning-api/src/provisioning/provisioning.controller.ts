import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ProvisioningService } from './provisioning.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

/**
 * Controller chỉ làm nhiệm vụ tiếp nhận request HTTP và kiểm tra xem URL có đúng hay không.
 * Mọi logic tính toán đều được giao phó lại cho ProvisioningService.
 */
@Controller('api/v1/provisioning') // Định tuyến (Routing): Khai báo prefix của URL
export class ProvisioningController {
  constructor(private readonly provisioningService: ProvisioningService) {}

  /**
   * Đón HTTP POST request từ Drone tại endpoint /register
   * Body của request sẽ tự động được kiểm tra kiểu dữ liệu nhờ RegisterDeviceDto
   */
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body() registerDeviceDto: RegisterDeviceDto) {
    // Chuyển việc xử lý dữ liệu cho Service
    return this.provisioningService.registerDevice(registerDeviceDto);
  }
}
