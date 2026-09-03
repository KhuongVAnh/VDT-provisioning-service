import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceService } from '../device/device.service';

export interface IpPoolStats {
  subnetPrefix: string;
  gatewayIp: string;
  startIp: number;
  endIp: number;
  totalCapacity: number;
  usedCount: number;
  availableCount: number;
  utilizationPercentage: number;
}

@Injectable()
export class IpPoolService {
  private readonly logger = new Logger(IpPoolService.name);
  private readonly startIp = 2;   // Bắt đầu cấp phát từ .2 (Server WireGuard giữ .1)
  private readonly endIp = 254;   // Kết thúc tại .254
  private readonly subnet: string;

  constructor(
    private readonly deviceService: DeviceService,
    private readonly configService: ConfigService,
  ) {
    this.subnet = this.configService.get<string>('VPN_SUBNET_PREFIX', '10.13.37.');
  }

  /**
   * Cấp phát IP nhỏ nhất còn trống trong dải mạng VPN (ví dụ: 10.13.37.2 - 10.13.37.254).
   */
  async allocateIp(): Promise<string> {
    const activeIps = await this.deviceService.findActiveOrPendingIps();
    const usedIps = new Set(activeIps);

    for (let i = this.startIp; i <= this.endIp; i++) {
      const ip = `${this.subnet}${i}`;
      if (!usedIps.has(ip)) {
        this.logger.log(`Đã cấp phát địa chỉ IP trống: ${ip}`);
        return ip;
      }
    }

    this.logger.error('Không còn địa chỉ IP khả dụng trong dải mạng (IP Pool đã đầy)');
    throw new Error('Không còn địa chỉ IP khả dụng trong dải mạng (Pool đã đầy)');
  }

  /**
   * Lấy thông tin thống kê chi tiết của toàn bộ IP Pool phục vụ Dashboard
   */
  async getPoolStats(): Promise<IpPoolStats> {
    const activeIps = await this.deviceService.findActiveOrPendingIps();
    const totalCapacity = this.endIp - this.startIp + 1; // 253 IP
    const usedCount = activeIps.length;
    const availableCount = Math.max(0, totalCapacity - usedCount);
    const utilizationPercentage = Math.round((usedCount / totalCapacity) * 100 * 10) / 10;

    return {
      subnetPrefix: this.subnet,
      gatewayIp: `${this.subnet}1`,
      startIp: this.startIp,
      endIp: this.endIp,
      totalCapacity,
      usedCount,
      availableCount,
      utilizationPercentage,
    };
  }

  getSubnetPrefix(): string {
    return this.subnet;
  }
}
