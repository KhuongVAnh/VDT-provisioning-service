import { Controller, Get, Post, Delete, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Lấy tổng quan toàn bộ chỉ số KPI và trạng thái hệ thống
   */
  @Get('stats')
  async getOverviewStats() {
    const stats = await this.dashboardService.getOverviewStats();
    return {
      status: 'success',
      data: stats,
    };
  }

  /**
   * Lấy danh sách toàn bộ Đội Drone (Fleet) kèm thông số Telemetry thời gian thực
   */
  @Get('devices')
  async getFleet() {
    const fleet = await this.dashboardService.getFleet();
    return {
      status: 'success',
      count: fleet.length,
      data: fleet,
    };
  }

  /**
   * Lấy ma trận 254 ô địa chỉ IP (10.13.37.1 - 10.13.37.254)
   */
  @Get('ip-pool')
  async getIpPoolMatrix() {
    const matrix = await this.dashboardService.getIpPoolMatrix();
    return {
      status: 'success',
      data: matrix,
    };
  }

  /**
   * Lấy danh sách raw WireGuard peers từ Linux Kernel
   */
  @Get('wireguard/peers')
  async getLivePeers() {
    const peers = await this.dashboardService.getLivePeers();
    return {
      status: 'success',
      count: peers.length,
      data: peers,
    };
  }

  /**
   * Lấy thông tin cấu hình hệ thống và Factory Token
   */
  @Get('config')
  getSystemConfig() {
    const config = this.dashboardService.getSystemConfig();
    return {
      status: 'success',
      data: config,
    };
  }

  /**
   * Thu hồi quyền truy cập của một Drone (Khóa thiết bị & giải phóng IP)
   */
  @Post('devices/:deviceId/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeDevice(@Param('deviceId') deviceId: string) {
    return this.dashboardService.revokeDevice(deviceId);
  }

  /**
   * Kích hoạt lại Drone bị thu hồi (Cấp IP mới & nạp lại vào WireGuard)
   */
  @Post('devices/:deviceId/reactivate')
  @HttpCode(HttpStatus.OK)
  async reActivateDevice(@Param('deviceId') deviceId: string) {
    return this.dashboardService.reActivateDevice(deviceId);
  }

  /**
   * Xóa vĩnh viễn Drone khỏi hệ thống
   */
  @Delete('devices/:deviceId')
  @HttpCode(HttpStatus.OK)
  async deleteDevice(@Param('deviceId') deviceId: string) {
    return this.dashboardService.deleteDevice(deviceId);
  }
}
