import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IpPoolService {
  private readonly startIp = 2; // 10.13.37.2
  private readonly endIp = 254; // 10.13.37.254
  private readonly subnet = '10.13.37.';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cấp phát IP nhỏ nhất còn trống trong dải mạng 10.13.37.2 - 10.13.37.254.
   */
  async allocateIp(): Promise<string> {
    // Lấy danh sách tất cả các IP đang được sử dụng từ Database.
    // Chỉ xét các thiết bị đang có trạng thái PENDING hoặc ACTIVE.
    // (Yêu cầu: "Giải phóng IP khi thiết bị bị xóa/thu hồi vĩnh viễn" -> không xét các IP của thiết bị REVOKED)
    const devices = await this.prisma.device.findMany({
      where: {
        status: {
          in: ['PENDING', 'ACTIVE'],
        },
      },
      select: {
        vpnIp: true,
      },
    });

    const usedIps = new Set(devices.map((d) => d.vpnIp));

    for (let i = this.startIp; i <= this.endIp; i++) {
      const ip = `${this.subnet}${i}`;
      if (!usedIps.has(ip)) {
        return ip;
      }
    }

    throw new Error('Không còn địa chỉ IP khả dụng trong dải mạng (Pool đã đầy)');
  }
}
