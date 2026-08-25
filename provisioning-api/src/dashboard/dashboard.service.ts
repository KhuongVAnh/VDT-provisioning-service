import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { DeviceService } from '../device/device.service';
import { IpPoolService, IpPoolStats } from '../ip-pool/ip-pool.service';
import { WireguardService, WireguardServerInfo } from '../wireguard/wireguard.service';
import { RedisService } from '../redis/redis.service';
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
    @Optional() private readonly redisService?: RedisService,
  ) {}

  /**
   * Lấy tổng quan toàn bộ chỉ số KPI của hệ thống phục vụ Dashboard (Lọc theo quyền Pilot/Admin)
   */
  async getOverviewStats(user?: any): Promise<DashboardOverviewStats> {
    const userId = user && user.role !== 'ADMIN' ? user.id : undefined;
    const [deviceCounts, ipPoolStats, livePeerMap, serverInfo] = await Promise.all([
      this.deviceService.countStats(userId),
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
  async getFleet(user?: any): Promise<DeviceFleetItem[]> {
    const userId = user && user.role !== 'ADMIN' ? user.id : undefined;
    const [devices, livePeerMap] = await Promise.all([
      this.deviceService.findAllDevices(userId),
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
    const [devices, livePeerMap, redisStates] = await Promise.all([
      this.deviceService.findAllDevices(),
      this.wireguardService.getLivePeerStats(),
      this.redisService ? this.redisService.getAllTelemetryStates().catch(() => ({})) : Promise.resolve({}),
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
        const telemetry = redisStates[device.deviceId] || (device.vpnIp ? redisStates[device.vpnIp] : null);
        const now = Date.now();
        
        // Drone được coi là ĐANG BAY (Xanh) nếu có telemetry thời gian thực trong vòng 15 giây gần nhất
        const isOnline = telemetry && telemetry.connected !== false && telemetry.timestamp && (now - telemetry.timestamp < 15000);

        matrix.push({
          ip,
          hostNumber: host,
          status: 'active',
          deviceId: device.deviceId,
          hardwareModel: device.hardwareModel,
          isOnline: !!isOnline,
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
    const mavlinkPort = this.configService.get<number>('MAVLINK_TARGET_PORT', 14551);
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

  /**
   * Cung cấp thông tin endpoint xem video stream trực tiếp cho Drone.
   * Toàn bộ các luồng được gom về Port 10004 duy nhất của NestJS Gateway.
   */
  async getStreamInfo(deviceId: string) {
    const cleanId = deviceId.trim();
    const vpsPublicIp = this.configService.get<string>('VPS_PUBLIC_IP') || '127.0.0.1';
    const gatewayPort = this.configService.get<string>('PORT') || '10004';
    const rtspPort = this.configService.get<string>('INTERNAL_MTX_RTSP_PORT') || '8554';

    return {
      deviceId: cleanId,
      streamPath: `live/${cleanId}`,
      whepEndpoint: `http://${vpsPublicIp}:${gatewayPort}/api/v1/video/${cleanId}/whep`,
      hlsUrl: `http://${vpsPublicIp}:${gatewayPort}/api/v1/video/${cleanId}/index.m3u8`,
      httpStreamUrl: `http://${vpsPublicIp}:${gatewayPort}/api/v1/video/${cleanId}/live.mp4`,
      wsEndpoint: `ws://${vpsPublicIp}:${gatewayPort}/socket.io/`,
      rtspInternalUrl: `rtsp://10.13.37.1:${rtspPort}/live/${cleanId}`,
    };
  }
}
