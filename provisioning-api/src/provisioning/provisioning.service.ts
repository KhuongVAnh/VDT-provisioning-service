import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { ConfigService } from '@nestjs/config';
import { DeviceService } from '../device/device.service';
import { IpPoolService } from '../ip-pool/ip-pool.service';
import { WireguardService } from '../wireguard/wireguard.service';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class ProvisioningService implements OnModuleInit {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly deviceService: DeviceService,
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
      const activeDevices = await this.deviceService.findActiveDevices();
      
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

  /**
   * Tiếp nhận request đăng ký từ Drone và thực hiện cấp phát / xoay key VPN.
   */
  async registerDevice(dto: RegisterDeviceDto) {
    this.logger.log(`Received provisioning request for device: ${dto.deviceId}`);
    
    // 1. Xác thực Factory Provisioning Token
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
    const existingDevice = await this.deviceService.findByDeviceId(dto.deviceId);

    // 3. Xử lý theo từng trạng thái của thiết bị
    if (existingDevice) {
      if (existingDevice.status === 'REVOKED') {
        this.logger.warn(`Device ${dto.deviceId} is REVOKED. Requires manual intervention or explicit re-registration.`);
        throw new ConflictException('Device is revoked. Cannot provision.');
      }

      // Nếu thiết bị đã ACTIVE hoặc PENDING: Thực hiện Key Rotation (Xoay key an toàn)
      return this.handleReProvisioning(existingDevice, dto);
    }

    // 4. Nếu là thiết bị mới hoàn toàn: Cấp phát mới từ đầu
    return this.handleNewProvisioning(dto);
  }

  /**
   * Xử lý cấp phát cho thiết bị mới hoàn toàn
   */
  private async handleNewProvisioning(dto: RegisterDeviceDto) {
    const vpnIp = await this.ipPoolService.allocateIp();
    this.logger.log(`Allocated IP ${vpnIp} for new device ${dto.deviceId}`);

    const keypair = await this.wireguardService.generateKeypair();
    
    // Nạp peer mới vào giao diện WireGuard (kernel)
    try {
      await this.wireguardService.addPeer(keypair.publicKey, vpnIp);
    } catch (error) {
      this.logger.error(`Failed to add WireGuard peer for ${dto.deviceId}. Aborting provisioning.`);
      throw new InternalServerErrorException('Failed to configure VPN');
    }

    // Lưu thông tin thiết bị vào Database qua DeviceService
    try {
      await this.deviceService.createDevice({
        deviceId: dto.deviceId,
        hardwareModel: dto.hardwareModel,
        vpnIp,
        vpnPublicKey: keypair.publicKey,
        status: 'ACTIVE',
      });
    } catch (error) {
      this.logger.error(`Failed to save device ${dto.deviceId} to database. Rolling back WireGuard peer.`);
      // Rollback (Hoàn tác): Xóa peer khỏi WireGuard nếu lỗi DB
      await this.wireguardService.removePeer(keypair.publicKey);
      throw new InternalServerErrorException('Database error during provisioning');
    }

    this.logger.log(`Successfully provisioned device ${dto.deviceId} with IP ${vpnIp}`);
    return this.formatResponse(dto.deviceId, vpnIp, keypair.privateKey, keypair.publicKey);
  }

  /**
   * Xử lý cấp phát lại (Key Rotation) khi thiết bị đã tồn tại trong hệ thống.
   * Giữ nguyên IP đã cấp, sinh cặp khóa mới, cập nhật WireGuard kernel & DB.
   */
  private async handleReProvisioning(existingDevice: any, dto: RegisterDeviceDto) {
    this.logger.log(`Re-provisioning / Key Rotation for existing device: ${dto.deviceId}`);
    
    // Giữ nguyên IP cũ hoặc cấp phát nếu chưa có
    const vpnIp = existingDevice.vpnIp || (await this.ipPoolService.allocateIp());
    const oldPublicKey = existingDevice.vpnPublicKey;

    // Sinh cặp khóa mới cho lượt đăng ký này
    const keypair = await this.wireguardService.generateKeypair();

    // 1. Xóa peer cũ khỏi WireGuard nếu có
    if (oldPublicKey) {
      await this.wireguardService.removePeer(oldPublicKey);
    }

    // 2. Nạp peer mới vào kernel
    try {
      await this.wireguardService.addPeer(keypair.publicKey, vpnIp);
    } catch (error) {
      this.logger.error(`Failed to update WireGuard peer during key rotation for ${dto.deviceId}.`);
      // Rollback: Phục hồi lại peer cũ nếu có
      if (oldPublicKey) {
        await this.wireguardService.addPeer(oldPublicKey, vpnIp).catch(() => {});
      }
      throw new InternalServerErrorException('Failed to configure VPN during key rotation');
    }

    // 3. Cập nhật khóa mới vào DB qua DeviceService
    try {
      await this.deviceService.updateDevice(existingDevice.id, {
        hardwareModel: dto.hardwareModel,
        vpnIp,
        vpnPublicKey: keypair.publicKey,
        status: 'ACTIVE',
        lastSeen: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to update DB for ${dto.deviceId}. Rolling back WireGuard peer.`);
      await this.wireguardService.removePeer(keypair.publicKey);
      if (oldPublicKey) {
        await this.wireguardService.addPeer(oldPublicKey, vpnIp).catch(() => {});
      }
      throw new InternalServerErrorException('Database error during key rotation');
    }

    this.logger.log(`Key rotation successful for device ${dto.deviceId} with IP ${vpnIp}`);
    return this.formatResponse(dto.deviceId, vpnIp, keypair.privateKey, keypair.publicKey);
  }

  private async formatResponse(deviceId: string, assignedIp: string, privateKey: string, clientPublicKey: string) {
    const serverEndpoint = this.configService.get<string>('WG_SERVER_ENDPOINT', '103.253.20.32:10006');
    const allowedIps = this.configService.get<string>('WG_SERVER_ALLOWED_IPS', '10.13.37.0/24');
    const persistentKeepalive = parseInt(this.configService.get<string>('WG_SERVER_PERSISTENT_KEEPALIVE', '25'), 10);
    
    // Tự động lấy Public Key trực tiếp từ Kernel của VPS qua WireguardService
    const serverPublicKey = await this.wireguardService.getServerPublicKey();
    
    const mavlinkHost = this.configService.get<string>('MAVLINK_TARGET_HOST', '10.13.37.1');
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
