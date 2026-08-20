import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceService } from '../device/device.service';

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
    // Lấy danh sách toàn bộ các IP đang được sử dụng bởi các thiết bị PENDING hoặc ACTIVE
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
}
