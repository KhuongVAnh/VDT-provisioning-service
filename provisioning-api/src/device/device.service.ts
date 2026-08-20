import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
 * bao gồm truy vấn, tạo mới, cập nhật cấu hình VPN, xoay key và thu hồi thiết bị.
 */
@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tìm kiếm thiết bị theo mã định danh duy nhất (CPU Serial / MAC)
   */
  async findByDeviceId(deviceId: string): Promise<Device | null> {
    return this.prisma.device.findUnique({
      where: { deviceId },
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
   * Tạo bản ghi thiết bị mới
   */
  async createDevice(input: CreateDeviceInput): Promise<Device> {
    this.logger.log(`Tạo thiết bị mới trong Database: ${input.deviceId} với IP ${input.vpnIp}`);
    return this.prisma.device.create({
      data: {
        deviceId: input.deviceId,
        hardwareModel: input.hardwareModel,
        vpnIp: input.vpnIp,
        vpnPublicKey: input.vpnPublicKey,
        status: input.status || 'ACTIVE',
      },
    });
  }

  /**
   * Cập nhật thông tin thiết bị (cập nhật trạng thái, xoay public key, v.v.)
   */
  async updateDevice(id: string, input: UpdateDeviceInput): Promise<Device> {
    this.logger.log(`Cập nhật thông tin thiết bị ID: ${id}`);
    return this.prisma.device.update({
      where: { id },
      data: {
        ...(input.hardwareModel && { hardwareModel: input.hardwareModel }),
        ...(input.vpnIp !== undefined && { vpnIp: input.vpnIp }),
        ...(input.vpnPublicKey && { vpnPublicKey: input.vpnPublicKey }),
        ...(input.status && { status: input.status }),
        ...(input.lastSeen && { lastSeen: input.lastSeen }),
      },
    });
  }

  /**
   * Thu hồi thiết bị (Revoke) và giải phóng IP an toàn
   */
  async revokeDevice(deviceId: string): Promise<Device> {
    this.logger.warn(`Thu hồi thiết bị: ${deviceId}`);
    return this.prisma.device.update({
      where: { deviceId },
      data: {
        status: 'REVOKED',
        vpnIp: null, // Giải phóng IP để trả về IP Pool mà không gây xung đột Unique Key
      },
    });
  }
}
