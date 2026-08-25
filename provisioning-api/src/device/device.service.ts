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
   * Đồng bộ một WireGuard peer thủ công từ Linux Kernel vào Database và IP Pool lúc khởi động.
   * Tạo bản ghi Device tạm với ID theo IP (ví dụ: DRONE-IP-10-13-37-5) để khóa ô IP trong IP Pool.
   */
  async syncManualKernelPeer(
    vpnIp: string,
    vpnPublicKey: string,
    latestHandshake?: number,
  ): Promise<Device> {
    const existingByIp = await this.findByVpnIp(vpnIp);
    const lastSeenDate = latestHandshake && latestHandshake > 0 ? new Date(latestHandshake * 1000) : new Date();

    if (existingByIp) {
      // Nếu đã có bản ghi nhưng public key chưa được cập nhật hoặc là key tạm
      if (vpnPublicKey && existingByIp.vpnPublicKey !== vpnPublicKey) {
        return this.updateDevice(existingByIp.id, {
          vpnPublicKey,
          status: 'ACTIVE',
          lastSeen: lastSeenDate,
        });
      }
      return existingByIp;
    }

    // Đặt ID tạm thời theo IP
    const tempDeviceId = `DRONE-IP-${vpnIp.replace(/\./g, '-')}`;

    // Kiểm tra xem ID tạm này có bị trùng không
    const existingById = await this.findByDeviceId(tempDeviceId);
    if (existingById) {
      return this.updateDevice(existingById.id, {
        vpnIp,
        vpnPublicKey,
        status: 'ACTIVE',
        lastSeen: lastSeenDate,
      });
    }

    this.logger.log(`[KERNEL-SYNC] Tự động ghi danh & khóa IP cho WireGuard peer từ kernel: ${tempDeviceId} (IP: ${vpnIp})`);
    return this.createDevice({
      deviceId: tempDeviceId,
      hardwareModel: 'Manual WireGuard Peer',
      vpnIp,
      vpnPublicKey,
      status: 'ACTIVE',
    });
  }

  /**
   * Liên kết hoặc cập nhật định danh thật của Drone khi nhận được gói tin Telemetry.
   * Nếu có bản ghi tạm (ví dụ: DRONE-IP-10-13-37-5) đang giữ IP này, tự động cập nhật đổi deviceId thành mã thật.
   */
  async bindOrUpdateDeviceIdentity(
    realDeviceId: string,
    vpnIp: string,
    hardwareModel: string = 'Real-time Telemetry Drone',
  ): Promise<Device> {
    const cleanId = realDeviceId.trim();
    if (!cleanId) return null as any;

    // 1. Kiểm tra xem Drone đã tồn tại với mã định danh thật chưa
    const existingById = await this.findByDeviceId(cleanId);
    if (existingById) {
      if (vpnIp && existingById.vpnIp !== vpnIp) {
        // Kiểm tra xem IP có đang bị giữ bởi bản ghi tạm nào không
        const conflictDevice = await this.findByVpnIp(vpnIp);
        if (conflictDevice && conflictDevice.id !== existingById.id) {
          // Xóa bản ghi tạm giữ IP để nhường IP cho thiết bị thật
          await this.prisma.device.delete({ where: { id: conflictDevice.id } });
        }
        return this.updateDevice(existingById.id, { vpnIp, status: 'ACTIVE', lastSeen: new Date() });
      }
      return existingById;
    }

    // 2. Nếu chưa có mã thật, kiểm tra xem có bản ghi nào (ví dụ bản ghi tạm DRONE-IP-...) đang giữ IP này không
    if (vpnIp) {
      const existingByIp = await this.findByVpnIp(vpnIp);
      if (existingByIp) {
        this.logger.log(`[IDENTITY-UPGRADE] Cập nhật định danh Drone: "${existingByIp.deviceId}" ➔ "${cleanId}" (IP: ${vpnIp})`);

        // Cập nhật đổi deviceId sang mã thật trong DB
        const updated = await this.prisma.device.update({
          where: { id: existingByIp.id },
          data: {
            deviceId: cleanId,
            hardwareModel: hardwareModel || existingByIp.hardwareModel,
            status: 'ACTIVE',
            lastSeen: new Date(),
          },
        });

        // Cập nhật lại Redis mapping
        if (this.redisService) {
          await this.redisService.mapIpToDevice(vpnIp, cleanId);
        }

        return updated;
      }
    }

    // 3. Nếu chưa tồn tại cả theo ID lẫn theo IP -> Tạo mới
    this.logger.log(`[AUTO-DISCOVERY] Tự động tạo bản ghi cho Drone mới: ${cleanId} (IP: ${vpnIp || 'N/A'})`);
    return this.createDevice({
      deviceId: cleanId,
      hardwareModel,
      vpnIp: vpnIp || null,
      vpnPublicKey: 'MANUAL_TELEMETRY',
      status: 'ACTIVE',
    });
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
    return this.bindOrUpdateDeviceIdentity(deviceId, vpnIp, hardwareModel);
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
   * Tìm kiếm thiết bị theo địa chỉ IP VPN (10.13.37.X)
   */
  async findByVpnIp(vpnIp: string): Promise<Device | null> {
    return this.prisma.device.findFirst({
      where: { vpnIp },
    });
  }

  /**
   * Lấy toàn bộ danh sách thiết bị phục vụ hiển thị trên Dashboard (Hỗ trợ lọc theo User sở hữu)
   */
  async findAllDevices(userId?: string): Promise<Device[]> {
    const where = userId ? { userId } : {};
    return this.prisma.device.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Đếm số lượng thiết bị theo từng trạng thái (Hỗ trợ lọc theo User sở hữu)
   */
  async countStats(userId?: string) {
    const baseWhere = userId ? { userId } : {};
    const [total, active, revoked, pending] = await Promise.all([
      this.prisma.device.count({ where: baseWhere }),
      this.prisma.device.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
      this.prisma.device.count({ where: { ...baseWhere, status: 'REVOKED' } }),
      this.prisma.device.count({ where: { ...baseWhere, status: 'PENDING' } }),
    ]);

    return { total, active, revoked, pending };
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
}
