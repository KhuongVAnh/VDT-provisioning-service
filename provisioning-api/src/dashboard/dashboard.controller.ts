import { Controller, Get, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
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
   * Ghi danh thủ công một Drone vào hệ thống (IP cấu hình bằng tay)
   */
  @Post('devices/manual')
  @HttpCode(HttpStatus.CREATED)
  async createManualDevice(@Body() body: { deviceId: string; vpnIp: string; hardwareModel?: string; vpnPublicKey?: string }) {
    return this.dashboardService.createManualDevice(body);
  }

  /**
   * Lấy thông tin kết nối Live Video Stream của Drone
   */
  @Get('devices/:id/stream-info')
  async getStreamInfo(@Param('id') deviceId: string) {
    const streamInfo = await this.dashboardService.getStreamInfo(deviceId);
    return {
      status: 'success',
      data: streamInfo,
    };
  }
}
