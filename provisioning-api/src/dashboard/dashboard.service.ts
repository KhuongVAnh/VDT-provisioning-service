import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DeviceService } from '../device/device.service';
import { IpPoolService, IpPoolStats } from '../ip-pool/ip-pool.service';
import { WireguardService, WireguardServerInfo } from '../wireguard/wireguard.service';
import { ConfigService } from '@nestjs/config';

export interface DeviceFleetItem {
  id: string;
  deviceId: string;
  hardwareModel: string;
  vpnIp: string | null;
  vpnPublicKey: string;
  status: string;
  isOnline: boolean;
  latestHandshake: number;
  transferRx: number;
  transferTx: number;
  endpoint: string;
  lastSeen: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IpMatrixCell {
  ip: string;
  hostNumber: number;
  status: 'gateway' | 'active' | 'available';
  deviceId?: string;
  hardwareModel?: string;
  isOnline?: boolean;
}

export interface DashboardOverviewStats {
  devices: {
    total: number;
    active: number;
    revoked: number;
    pending: number;
    onlineNow: number;
  };
  ipPool: IpPoolStats;
  wireguard: WireguardServerInfo & {
    totalRxBytes: number;
    totalTxBytes: number;
    activePeersCount: number;
  };
  serverTime: string;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly deviceService: DeviceService,
    private readonly ipPoolService: IpPoolService,
    private readonly wireguardService: WireguardService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Lấy tổng quan toàn bộ chỉ số KPI của hệ thống phục vụ Dashboard
   */
  async getOverviewStats(): Promise<DashboardOverviewStats> {
    const [deviceCounts, ipPoolStats, livePeerMap, serverInfo] = await Promise.all([
      this.deviceService.countStats(),
      this.ipPoolService.getPoolStats(),
      this.wireguardService.getLivePeerStats(),
      this.wireguardService.getServerInfo(),
    ]);

    let onlineNow = 0;
    let totalRxBytes = 0;
    let totalTxBytes = 0;

    for (const peer of livePeerMap.values()) {
      if (peer.isOnline) onlineNow++;
      totalRxBytes += peer.transferRx;
      totalTxBytes += peer.transferTx;
    }

    return {
      devices: {
        ...deviceCounts,
        onlineNow,
      },
      ipPool: ipPoolStats,
      wireguard: {
        ...serverInfo,
        totalRxBytes,
        totalTxBytes,
        activePeersCount: livePeerMap.size,
      },
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Lấy danh sách toàn bộ Đội Drone (Fleet), kết hợp dữ liệu DB và Telemetry thời gian thực từ WireGuard
   */
  async getFleet(): Promise<DeviceFleetItem[]> {
    const [devices, livePeerMap] = await Promise.all([
      this.deviceService.findAllDevices(),
      this.wireguardService.getLivePeerStats(),
    ]);

    return devices.map((device) => {
      const peerStats = livePeerMap.get(device.vpnPublicKey);

      return {
        id: device.id,
        deviceId: device.deviceId,
        hardwareModel: device.hardwareModel,
        vpnIp: device.vpnIp,
        vpnPublicKey: device.vpnPublicKey,
        status: device.status,
        isOnline: peerStats ? peerStats.isOnline : false,
        latestHandshake: peerStats ? peerStats.latestHandshake : 0,
        transferRx: peerStats ? peerStats.transferRx : 0,
        transferTx: peerStats ? peerStats.transferTx : 0,
        endpoint: peerStats ? peerStats.endpoint : '',
        lastSeen: device.lastSeen,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt,
      };
    });
  }

  /**
   * Tạo ma trận 254 ô địa chỉ IP (10.13.37.1 đến 10.13.37.254) để vẽ bản đồ trực quan
   */
  async getIpPoolMatrix(): Promise<IpMatrixCell[]> {
    const subnet = this.ipPoolService.getSubnetPrefix();
    const [devices, livePeerMap] = await Promise.all([
      this.deviceService.findAllDevices(),
      this.wireguardService.getLivePeerStats(),
    ]);

    // Tạo Map từ vpnIp -> Device
    const ipDeviceMap = new Map<string, typeof devices[0]>();
    for (const d of devices) {
      if (d.vpnIp && (d.status === 'ACTIVE' || d.status === 'PENDING')) {
        ipDeviceMap.set(d.vpnIp, d);
      }
    }

    const matrix: IpMatrixCell[] = [];

    // 1. Ô Gateway (10.13.37.1)
    matrix.push({
      ip: `${subnet}1`,
      hostNumber: 1,
      status: 'gateway',
      deviceId: 'VPN Gateway Server',
      hardwareModel: 'Linux WireGuard Host',
      isOnline: true,
    });

    // 2. Các ô từ 2 đến 254
    for (let host = 2; host <= 254; host++) {
      const ip = `${subnet}${host}`;
      const device = ipDeviceMap.get(ip);

      if (device) {
        const peerStats = livePeerMap.get(device.vpnPublicKey);
        matrix.push({
          ip,
          hostNumber: host,
          status: 'active',
          deviceId: device.deviceId,
          hardwareModel: device.hardwareModel,
          isOnline: peerStats ? peerStats.isOnline : false,
        });
      } else {
        matrix.push({
          ip,
          hostNumber: host,
          status: 'available',
        });
      }
    }

    return matrix;
  }

  /**
   * Thu hồi (Khóa) Drone từ Dashboard: Xóa khỏi WireGuard Kernel + Đổi trạng thái DB sang REVOKED
   */
  async revokeDevice(deviceId: string) {
    const device = await this.deviceService.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException(`Không tìm thấy thiết bị có ID: ${deviceId}`);
    }

    if (device.status === 'REVOKED') {
      throw new BadRequestException(`Thiết bị ${deviceId} đã ở trạng thái REVOKED trước đó.`);
    }

    // 1. Gỡ peer khỏi Linux Kernel WireGuard
    if (device.vpnPublicKey) {
      await this.wireguardService.removePeer(device.vpnPublicKey);
    }

    // 2. Cập nhật DB sang REVOKED và giải phóng vpnIp
    const updated = await this.deviceService.revokeDevice(deviceId);
    this.logger.warn(`Admin đã thu hồi quyền truy cập của thiết bị: ${deviceId}`);

    return {
      status: 'success',
      message: `Đã thu hồi thiết bị ${deviceId} và giải phóng IP an toàn.`,
      device: updated,
    };
  }

  /**
   * Kích hoạt lại (Reactivate) Drone bị khóa: Cấp IP mới + Nạp lại vào WireGuard Kernel
   */
  async reActivateDevice(deviceId: string) {
    const device = await this.deviceService.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException(`Không tìm thấy thiết bị có ID: ${deviceId}`);
    }

    if (device.status === 'ACTIVE') {
      throw new BadRequestException(`Thiết bị ${deviceId} đang ở trạng thái ACTIVE.`);
    }

    // 1. Cấp phát IP mới từ Pool
    const newIp = await this.ipPoolService.allocateIp();

    // 2. Nạp lại vào WireGuard Kernel
    if (device.vpnPublicKey) {
      await this.wireguardService.addPeer(device.vpnPublicKey, newIp);
    }

    // 3. Cập nhật DB
    const updated = await this.deviceService.reActivateDevice(deviceId, newIp);
    this.logger.log(`Admin đã kích hoạt lại thiết bị: ${deviceId} với IP mới: ${newIp}`);

    return {
      status: 'success',
      message: `Đã kích hoạt lại thiết bị ${deviceId} với IP ${newIp}.`,
      device: updated,
    };
  }

  /**
   * Xóa vĩnh viễn Drone khỏi hệ thống
   */
  async deleteDevice(deviceId: string) {
    const device = await this.deviceService.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException(`Không tìm thấy thiết bị có ID: ${deviceId}`);
    }

    // Gỡ khỏi WireGuard kernel nếu đang có
    if (device.vpnPublicKey) {
      await this.wireguardService.removePeer(device.vpnPublicKey);
    }

    await this.deviceService.deleteDevice(deviceId);
    this.logger.warn(`Admin đã xóa vĩnh viễn thiết bị: ${deviceId}`);

    return {
      status: 'success',
      message: `Đã xóa vĩnh viễn thiết bị ${deviceId} khỏi hệ thống.`,
    };
  }

  /**
   * Đăng ký thủ công một Drone vào hệ thống (dành cho Drone cấu hình VPN bằng tay)
   */
  async createManualDevice(dto: { deviceId: string; vpnIp: string; hardwareModel?: string; vpnPublicKey?: string }) {
    const deviceId = dto.deviceId.trim();
    const vpnIp = dto.vpnIp.trim();
    const hardwareModel = dto.hardwareModel?.trim() || 'Manual Configured Drone';
    const vpnPublicKey = dto.vpnPublicKey?.trim() || 'MANUAL_PUBLIC_KEY';

    if (!deviceId) throw new BadRequestException('Mã Device ID không được để trống.');
    if (!vpnIp) throw new BadRequestException('Địa chỉ IP VPN không được để trống.');

    const device = await this.deviceService.findOrCreateManualDevice(
      deviceId,
      vpnIp,
      vpnPublicKey,
      hardwareModel,
    );

    return {
      status: 'success',
      message: `Đã ghi danh thành công Drone ${deviceId} với IP ${vpnIp}.`,
      data: device,
    };
  }

  /**
   * Lấy danh sách Live WireGuard Peers từ kernel
   */
  async getLivePeers() {
    const peerMap = await this.wireguardService.getLivePeerStats();
    return Array.from(peerMap.values());
  }

  /**
   * Lấy cấu hình hệ thống công khai (không lộ secret key)
   */
  getSystemConfig() {
    const token = this.configService.get<string>('PROVISION_SECRET_TOKEN', 'FACTORY_SECRET_KEY_2026');
    const maskedToken = token.length > 6 ? `${token.substring(0, 3)}***${token.substring(token.length - 3)}` : '***';
    const serverEndpoint = this.configService.get<string>('WG_SERVER_ENDPOINT', '103.253.20.32:10006');
    const mavlinkHost = this.configService.get<string>('MAVLINK_TARGET_HOST', '10.13.37.1');
    const mavlinkPort = this.configService.get<number>('MAVLINK_TARGET_PORT', 14550);
    const subnetPrefix = this.ipPoolService.getSubnetPrefix();

    return {
      provisionSecretToken: token,
      maskedToken,
      serverEndpoint,
      mavlinkHost,
      mavlinkPort,
      subnetPrefix,
    };
  }
}
