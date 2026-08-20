import { Controller, Get, Param } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';

/**
 * TelemetryController cung cấp các REST API cho phép Dashboard hoặc bên thứ ba
 * truy vấn nhanh snapshot trạng thái dữ liệu bay của toàn bộ phi đội hoặc từng drone riêng biệt.
 */
@Controller('api/v1/telemetry')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  /**
   * Lấy snapshot trạng thái toàn bộ phi đội Drone
   */
  @Get('fleet/states')
  async getFleetStates() {
    const fleet = await this.telemetryService.getAllFleetStates();
    return {
      status: 'success',
      count: fleet.length,
      data: fleet,
    };
  }

  /**
   * Lấy snapshot trạng thái chi tiết của 1 Drone cụ thể
   */
  @Get(':deviceId/state')
  async getDeviceState(@Param('deviceId') deviceId: string) {
    const state = await this.telemetryService.getDeviceState(deviceId);
    return {
      status: 'success',
      data: state,
    };
  }
}
