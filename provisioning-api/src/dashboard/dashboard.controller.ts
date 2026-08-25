import { Controller, Get, Post, Param, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DeviceOwnershipGuard } from '../auth/guards/device-ownership.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('api/v1/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Lấy tổng quan toàn bộ chỉ số KPI và trạng thái hệ thống
   */
  @Get('stats')
  async getOverviewStats(@CurrentUser() user: any) {
    const stats = await this.dashboardService.getOverviewStats(user);
    return {
      status: 'success',
      data: stats,
    };
  }

  /**
   * Lấy danh sách Đội Drone (Fleet) kèm thông số Telemetry thời gian thực
   * Pilot chỉ lấy các Drone mình sở hữu, Admin lấy toàn bộ phi đội
   */
  @Get('devices')
  async getFleet(@CurrentUser() user: any) {
    const fleet = await this.dashboardService.getFleet(user);
    return {
      status: 'success',
      count: fleet.length,
      data: fleet,
    };
  }

  /**
   * Lấy ma trận 254 ô địa chỉ IP (Chỉ dành cho ADMIN)
   */
  @Get('ip-pool')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async getIpPoolMatrix() {
    const matrix = await this.dashboardService.getIpPoolMatrix();
    return {
      status: 'success',
      data: matrix,
    };
  }

  /**
   * Lấy danh sách raw WireGuard peers từ Linux Kernel (Chỉ dành cho ADMIN)
   */
  @Get('wireguard/peers')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async getLivePeers() {
    const peers = await this.dashboardService.getLivePeers();
    return {
      status: 'success',
      count: peers.length,
      data: peers,
    };
  }

  /**
   * Lấy thông tin cấu hình hệ thống và Factory Token (Chỉ dành cho ADMIN)
   */
  @Get('config')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getSystemConfig() {
    const config = this.dashboardService.getSystemConfig();
    return {
      status: 'success',
      data: config,
    };
  }

  /**
   * Ghi danh thủ công một Drone vào hệ thống (Chỉ dành cho ADMIN)
   */
  @Post('devices/manual')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  async createManualDevice(@Body() body: { deviceId: string; vpnIp: string; hardwareModel?: string; vpnPublicKey?: string }) {
    return this.dashboardService.createManualDevice(body);
  }

  /**
   * Lấy thông tin kết nối Live Video Stream của Drone (Kiểm tra quyền sở hữu)
   */
  @Get('devices/:id/stream-info')
  @UseGuards(DeviceOwnershipGuard)
  async getStreamInfo(@Param('id') deviceId: string) {
    const streamInfo = await this.dashboardService.getStreamInfo(deviceId);
    return {
      status: 'success',
      data: streamInfo,
    };
  }
}
