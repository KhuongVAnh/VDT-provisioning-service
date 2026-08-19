import { Injectable, UnauthorizedException, ConflictException, Logger, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { IpPoolService } from '../ip-pool/ip-pool.service';
import { WireguardService } from '../wireguard/wireguard.service';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class ProvisioningService implements OnModuleInit {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly ipPoolService: IpPoolService,
    private readonly wireguardService: WireguardService,
  ) {}

  /**
   * Tự động chạy mỗi khi NestJS khởi động thành công.
   * Chức năng: Đọc toàn bộ thiết bị đang ACTIVE trong SQLite và nạp lại vào WireGuard (Kernel).
   * Giúp khôi phục mạng VPN ngay lập tức nếu VPS hoặc Docker bị mất điện/restart.
   */
  async onModuleInit() {
    this.logger.log('Bắt đầu đồng bộ VPN: Khôi phục cấu hình peer từ Database vào WireGuard...');
    try {
      const activeDevices = await this.prisma.device.findMany({
        where: { status: 'ACTIVE' },
      });
      
      let restoredCount = 0;
      for (const device of activeDevices) {
        if (device.vpnPublicKey && device.vpnIp) {
          try {
            await this.wireguardService.addPeer(device.vpnPublicKey, device.vpnIp);
            restoredCount++;
          } catch (err) {
            this.logger.error(`Không thể khôi phục peer cho thiết bị ${device.deviceId}: ${err.message}`);
          }
        }
      }
      this.logger.log(`Hoàn tất đồng bộ VPN! Đã khôi phục thành công ${restoredCount}/${activeDevices.length} thiết bị.`);
    } catch (error) {
      this.logger.error('Lỗi khi đồng bộ VPN lúc khởi động', error);
    }
  }

  async registerDevice(dto: RegisterDeviceDto) {
    this.logger.log(`Received provisioning request for device: ${dto.deviceId}`);
    
    // 1. Xác thực Token (Validate Token)
    const expectedToken = this.configService.get<string>('PROVISION_SECRET_TOKEN');
    if (!expectedToken) {
      this.logger.error('PROVISION_SECRET_TOKEN is not configured on the server');
      throw new InternalServerErrorException('Server configuration error');
    }

    if (!this.secureCompare(dto.provisionToken, expectedToken)) {
      this.logger.warn(`Invalid provision token for device: ${dto.deviceId}`);
      throw new UnauthorizedException('Invalid provisioning token');
    }

    // 2. Kiểm tra xem thiết bị đã tồn tại trong Database chưa
    const existingDevice = await this.prisma.device.findUnique({
      where: { deviceId: dto.deviceId },
    });

    if (existingDevice) {
      if (existingDevice.status === 'ACTIVE') {
        this.logger.log(`Device ${dto.deviceId} is already ACTIVE. Returning existing config.`);
        return this.formatResponse(
          dto.deviceId,
          existingDevice.vpnIp,
          '<PRIVATE_KEY_NOT_STORED_FOR_SECURITY>',
          existingDevice.vpnPublicKey
        );
      } else if (existingDevice.status === 'REVOKED') {
        this.logger.warn(`Device ${dto.deviceId} is REVOKED. Requires manual intervention or explicit re-registration.`);
        throw new ConflictException('Device is revoked. Cannot provision.');
      } else {
        // Trạng thái PENDING: Có thể coi như đang cài đặt dở dang.
        // Ở pha này, ta sẽ ghi đè và cấp phát lại.
      }
    }

    // 3. Cấp phát IP và cấu hình cho thiết bị mới
    const vpnIp = await this.ipPoolService.allocateIp();
    this.logger.log(`Allocated IP ${vpnIp} for device ${dto.deviceId}`);

    const keypair = await this.wireguardService.generateKeypair();
    
    // 4. Nạp peer mới vào giao diện WireGuard (kernel)
    try {
      await this.wireguardService.addPeer(keypair.publicKey, vpnIp);
    } catch (error) {
      this.logger.error(`Failed to add WireGuard peer for ${dto.deviceId}. Aborting provisioning.`);
      throw new InternalServerErrorException('Failed to configure VPN');
    }

    // 5. Lưu thông tin thiết bị vào Database
    try {
      if (existingDevice) {
        await this.prisma.device.update({
          where: { id: existingDevice.id },
          data: {
            hardwareModel: dto.hardwareModel,
            vpnIp,
            vpnPublicKey: keypair.publicKey,
            status: 'ACTIVE',
            lastSeen: new Date(),
          },
        });
      } else {
        await this.prisma.device.create({
          data: {
            deviceId: dto.deviceId,
            hardwareModel: dto.hardwareModel,
            vpnIp,
            vpnPublicKey: keypair.publicKey,
            status: 'ACTIVE',
          },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to save device ${dto.deviceId} to database. Rolling back WireGuard peer.`);
      // Rollback (Hoàn tác): Xóa peer khỏi WireGuard nếu lỗi DB
      await this.wireguardService.removePeer(keypair.publicKey);
      throw new InternalServerErrorException('Database error during provisioning');
    }

    this.logger.log(`Successfully provisioned device ${dto.deviceId} with IP ${vpnIp}`);

    // 6. Trả về thông tin cấu hình VPN và MAVLink cho thiết bị
    return this.formatResponse(dto.deviceId, vpnIp, keypair.privateKey, keypair.publicKey);
  }

  private formatResponse(deviceId: string, assignedIp: string, privateKey: string, clientPublicKey: string) {
    const serverEndpoint = this.configService.get<string>('WG_SERVER_ENDPOINT');
    const allowedIps = this.configService.get<string>('WG_SERVER_ALLOWED_IPS');
    const persistentKeepalive = parseInt(this.configService.get<string>('WG_SERVER_PERSISTENT_KEEPALIVE', '25'), 10);
    const serverPublicKey = this.configService.get<string>('WG_SERVER_PUBLIC_KEY');
    
    const mavlinkHost = this.configService.get<string>('MAVLINK_TARGET_HOST', '10.0.0.1');
    const mavlinkPort = parseInt(this.configService.get<string>('MAVLINK_TARGET_PORT', '14550'), 10);

    return {
      status: 'success',
      data: {
        deviceId,
        assignedIp,
        vpn: {
          address: `${assignedIp}/24`,
          privateKey,
          serverPublicKey,
          serverEndpoint,
          allowedIps,
          persistentKeepalive,
        },
        mavlink: {
          targetHost: mavlinkHost,
          targetPort: mavlinkPort,
        },
      },
    };
  }

  private secureCompare(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) {
      return false;
    }
    return timingSafeEqual(aBuf, bBuf);
  }
}
