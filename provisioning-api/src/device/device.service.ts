import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Device } from '@prisma/client';

export interface CreateDeviceInput {
  deviceId: string;
  hardwareModel: string;
  vpnIp: string;
  vpnPublicKey: string;
  status?: string;
}

export interface UpdateDeviceInput {
  hardwareModel?: string;
  vpnIp?: string | null;
  vpnPublicKey?: string;
  status?: string;
  lastSeen?: Date;
}

/**
 * DeviceService chịu trách nhiệm quản lý toàn bộ vòng đời thực thể Thiết bị (Device),
 * bao gồm truy vấn, tạo mới, cập nhật cấu hình VPN, xoay key, quản trị Dashboard, thu hồi thiết bị,
 * và tự động đồng bộ ánh xạ IP-Device vào Redis Cache (`drone:ip_map`).
 */
@Injectable()
export class DeviceService implements OnModuleInit {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  /**
   * Khi server khởi động, đồng bộ toàn bộ ánh xạ IP -> DeviceID của các Drone đang ACTIVE vào Redis
   */
  async onModuleInit() {
    if (!this.redisService) return;
    try {
      const activeDevices = await this.findActiveDevices();
      for (const dev of activeDevices) {
        if (dev.vpnIp) {
          await this.redisService.mapIpToDevice(dev.vpnIp, dev.deviceId);
        }
      }
      this.logger.log(`Đã đồng bộ ${activeDevices.length} ánh xạ IP Drone vào Redis drone:ip_map`);
    } catch (error) {
      this.logger.warn(`Không thể đồng bộ IP Mapping lúc khởi động: ${error.message}`);
    }
  }

  /**
   * Tự động ghi danh hoặc tìm kiếm thiết bị được cấu hình thủ công qua VPN / Telemetry stream
   */
  async findOrCreateManualDevice(
    deviceId: string,
    vpnIp: string,
    vpnPublicKey: string = 'MANUAL_VPN',
    hardwareModel: string = 'Manual WireGuard Drone',
  ): Promise<Device> {
    const existing = await this.findByDeviceId(deviceId);
    if (existing) {
      if (!existing.vpnIp && vpnIp) {
        return this.updateDevice(existing.id, { vpnIp, status: 'ACTIVE', lastSeen: new Date() });
      }
      return existing;
    }

    // Kiểm tra xem IP này đã bị gán cho thiết bị nào khác chưa để tránh lỗi Unique constraint
    const existingByIp = await this.prisma.device.findUnique({
      where: { vpnIp },
    });
    if (existingByIp) {
      return existingByIp;
    }

    this.logger.log(`[AUTO-DISCOVERY] Tự động ghi danh Drone cấu hình thủ công: ${deviceId} (IP: ${vpnIp})`);
    return this.createDevice({
      deviceId,
      hardwareModel,
      vpnIp,
      vpnPublicKey,
      status: 'ACTIVE',
    });
  }

  /**
   * Tìm kiếm thiết bị theo mã định danh duy nhất (CPU Serial / MAC)
   */
  async findByDeviceId(deviceId: string): Promise<Device | null> {
    return this.prisma.device.findUnique({
      where: { deviceId },
    });
  }

  /**
   * Lấy toàn bộ danh sách thiết bị phục vụ hiển thị trên Dashboard
   */
  async findAllDevices(): Promise<Device[]> {
    return this.prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Lấy danh sách toàn bộ các IP đang được gán cho các thiết bị PENDING hoặc ACTIVE.
   * Dùng cho thuật toán cấp phát IP của IpPoolService.
   */
  async findActiveOrPendingIps(): Promise<string[]> {
    const devices = await this.prisma.device.findMany({
      where: {
        status: {
          in: ['PENDING', 'ACTIVE'],
        },
        vpnIp: {
          not: null,
        },
      },
      select: {
        vpnIp: true,
      },
    });

    return devices
      .map((d) => d.vpnIp)
      .filter((ip): ip is string => ip !== null && ip !== undefined);
  }

  /**
   * Lấy toàn bộ danh sách các thiết bị đang ACTIVE (để khôi phục WireGuard peers khi server khởi động).
   */
  async findActiveDevices(): Promise<Device[]> {
    return this.prisma.device.findMany({
      where: {
        status: 'ACTIVE',
        vpnIp: { not: null },
      },
    });
  }

  /**
   * Đếm tổng số thiết bị theo trạng thái phục vụ KPI Dashboard
   */
  async countStats(): Promise<{ total: number; active: number; revoked: number; pending: number }> {
    const [total, active, revoked, pending] = await Promise.all([
      this.prisma.device.count(),
      this.prisma.device.count({ where: { status: 'ACTIVE' } }),
      this.prisma.device.count({ where: { status: 'REVOKED' } }),
      this.prisma.device.count({ where: { status: 'PENDING' } }),
    ]);

    return { total, active, revoked, pending };
  }

  /**
   * Tạo bản ghi thiết bị mới và nạp ánh xạ IP vào Redis
   */
  async createDevice(input: CreateDeviceInput): Promise<Device> {
    this.logger.log(`Tạo thiết bị mới trong Database: ${input.deviceId} với IP ${input.vpnIp}`);
    const device = await this.prisma.device.create({
      data: {
        deviceId: input.deviceId,
        hardwareModel: input.hardwareModel,
        vpnIp: input.vpnIp,
        vpnPublicKey: input.vpnPublicKey,
        status: input.status || 'ACTIVE',
      },
    });

    // Đồng bộ ánh xạ IP vào Redis
    if (this.redisService && input.vpnIp) {
      await this.redisService.mapIpToDevice(input.vpnIp, input.deviceId);
    }

    return device;
  }

  /**
   * Cập nhật thông tin thiết bị (cập nhật trạng thái, xoay public key, v.v.)
   */
  async updateDevice(id: string, input: UpdateDeviceInput): Promise<Device> {
    this.logger.log(`Cập nhật thông tin thiết bị ID: ${id}`);
    const device = await this.prisma.device.update({
      where: { id },
      data: {
        ...(input.hardwareModel && { hardwareModel: input.hardwareModel }),
        ...(input.vpnIp !== undefined && { vpnIp: input.vpnIp }),
        ...(input.vpnPublicKey && { vpnPublicKey: input.vpnPublicKey }),
        ...(input.status && { status: input.status }),
        ...(input.lastSeen && { lastSeen: input.lastSeen }),
      },
    });

    // Cập nhật ánh xạ IP vào Redis
    if (this.redisService && device.vpnIp) {
      await this.redisService.mapIpToDevice(device.vpnIp, device.deviceId);
    }

    return device;
  }

  /**
   * Thu hồi thiết bị (Revoke) và giải phóng IP an toàn
   */
  async revokeDevice(deviceId: string): Promise<Device> {
    this.logger.warn(`Thu hồi thiết bị: ${deviceId}`);
    const existing = await this.findByDeviceId(deviceId);
    if (existing?.vpnIp && this.redisService) {
      await this.redisService.removeIpMapping(existing.vpnIp);
    }

    return this.prisma.device.update({
      where: { deviceId },
      data: {
        status: 'REVOKED',
        vpnIp: null, // Giải phóng IP để trả về IP Pool mà không gây xung đột Unique Key
      },
    });
  }

  /**
   * Kích hoạt lại thiết bị bị thu hồi (Reactivate) với IP mới
   */
  async reActivateDevice(deviceId: string, newVpnIp: string): Promise<Device> {
    this.logger.log(`Kích hoạt lại thiết bị: ${deviceId} với IP mới: ${newVpnIp}`);
    const device = await this.prisma.device.update({
      where: { deviceId },
      data: {
        status: 'ACTIVE',
        vpnIp: newVpnIp,
        lastSeen: new Date(),
      },
    });

    if (this.redisService) {
      await this.redisService.mapIpToDevice(newVpnIp, deviceId);
    }

    return device;
  }

  /**
   * Xóa vĩnh viễn thiết bị khỏi hệ thống
   */
  async deleteDevice(deviceId: string): Promise<Device> {
    this.logger.warn(`Xóa vĩnh viễn thiết bị: ${deviceId}`);
    const existing = await this.findByDeviceId(deviceId);
    if (existing?.vpnIp && this.redisService) {
      await this.redisService.removeIpMapping(existing.vpnIp);
    }

    return this.prisma.device.delete({
      where: { deviceId },
    });
  }
}
