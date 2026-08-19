import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface WireguardKeypair {
  privateKey: string;
  publicKey: string;
}

@Injectable()
export class WireguardService {
  private readonly logger = new Logger(WireguardService.name);
  private readonly interfaceName: string;

  constructor(private configService: ConfigService) {
    this.interfaceName = this.configService.get<string>('WG_INTERFACE', 'wg0');
  }

  /**
   * Tạo cặp khóa WireGuard mới bằng lệnh `wg genkey` và `wg pubkey`.
   */
  async generateKeypair(): Promise<WireguardKeypair> {
    try {
      const { stdout: privateKeyOut } = await execAsync('wg genkey');
      const privateKey = privateKeyOut.trim();

      const { stdout: publicKeyOut } = await execAsync(`echo "${privateKey}" | wg pubkey`);
      const publicKey = publicKeyOut.trim();

      return { privateKey, publicKey };
    } catch (error) {
      this.logger.error(`Failed to generate WireGuard keypair: ${error.message}`);
      throw new Error('Failed to generate WireGuard keypair');
    }
  }

  /**
   * Thêm một peer mới vào interface WireGuard (nạp trực tiếp vào kernel).
   * Cần cấu hình sudoers phù hợp do sử dụng lệnh sudo.
   */
  async addPeer(publicKey: string, assignedIp: string): Promise<void> {
    const command = `sudo wg set ${this.interfaceName} peer ${publicKey} allowed-ips ${assignedIp}/32`;
    try {
      await execAsync(command);
      this.logger.log(`Successfully added peer ${publicKey} with IP ${assignedIp} to ${this.interfaceName}`);
    } catch (error) {
      this.logger.error(`Failed to add WireGuard peer: ${error.message}`);
      throw new Error('Failed to configure WireGuard peer');
    }
  }

  /**
   * Xóa peer khỏi interface WireGuard.
   * Hữu ích khi cần rollback (hoàn tác) hoặc khi thu hồi thiết bị (revoke).
   */
  async removePeer(publicKey: string): Promise<void> {
    const command = `sudo wg set ${this.interfaceName} peer ${publicKey} remove`;
    try {
      await execAsync(command);
      this.logger.log(`Successfully removed peer ${publicKey} from ${this.interfaceName}`);
    } catch (error) {
      // Ghi log lỗi nhưng không ném ra exception vì hàm này thường dùng để rollback
      this.logger.error(`Failed to remove WireGuard peer ${publicKey}: ${error.message}`);
    }
  }
}
