import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DeviceOwnershipGuard } from '../auth/guards/device-ownership.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * ==============================================================================
 * TELEMETRY CONTROLLER (REST API GATEWAY)
 * ==============================================================================
 * Cung cấp các Endpoint HTTP REST API để Web Dashboard hoặc Client truy vấn nhanh:
 * 1. GET /api/v1/telemetry/fleet/states: Lấy snapshot toàn bộ phi đội (ADMIN xem tất cả, PILOT xem tiểu đội).
 *    - Tích hợp L1 RAM Cache (500ms) + SingleFlight Mutex: 99.9% request đọc trực tiếp từ RAM Node.js (0ms).
 * 2. GET /api/v1/telemetry/:deviceId/state: Lấy snapshot chi tiết của 1 Drone cụ thể (có kiểm tra quyền sở hữu).
 */
@Controller('api/v1/telemetry')
@UseGuards(JwtAuthGuard)
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  /**
   * ============================================================================
   * 1. GET /api/v1/telemetry/fleet/states
   * ============================================================================
   * Lấy snapshot trạng thái tức thời của toàn bộ Drone thuộc quyền quản lý của User:
   * - ADMIN: Nhận đầy đủ tất cả Drone trong hệ thống.
   * - PILOT: Chỉ nhận danh sách các Drone do chính User đó sở hữu.
   * - Hiệu năng: Đọc trực tiếp từ L1 RAM Cache (500ms) chống hiện tượng nghẽn Redis khi nhiều User F5.
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
   * ============================================================================
   * 2. GET /api/v1/telemetry/:deviceId/state
   * ============================================================================
   * Lấy snapshot trạng thái chi tiết của 1 Drone cụ thể:
   * - DeviceOwnershipGuard: Kiểm tra quyền sở hữu (PILOT chỉ được xem Drone của mình, ADMIN xem tất cả).
   * - Hiệu năng: Đọc từ RAM `inMemoryCache` trước, nếu chưa có mới fallback sang Redis `HGET drone:states`.
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
