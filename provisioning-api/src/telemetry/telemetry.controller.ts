import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DeviceOwnershipGuard } from '../auth/guards/device-ownership.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * TelemetryController cung cấp các REST API cho phép Dashboard hoặc phi công
 * truy vấn nhanh snapshot trạng thái dữ liệu bay theo quyền quản lý của tài khoản.
 */
@Controller('api/v1/telemetry')
@UseGuards(JwtAuthGuard)
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  /**
   * Lấy snapshot trạng thái các Drone thuộc quyền quản lý của User
   */
  @Get('fleet/states')
  async getFleetStates(@CurrentUser() user: any) {
    const fleet = await this.telemetryService.getAllFleetStates(user);
    return {
      status: 'success',
      count: fleet.length,
      data: fleet,
    };
  }

  /**
   * Lấy snapshot trạng thái chi tiết của 1 Drone cụ thể (Kiểm tra quyền sở hữu)
   */
  @Get(':deviceId/state')
  @UseGuards(DeviceOwnershipGuard)
  async getDeviceState(@Param('deviceId') deviceId: string) {
    const state = await this.telemetryService.getDeviceState(deviceId);
    return {
      status: 'success',
      data: state,
    };
  }
}
