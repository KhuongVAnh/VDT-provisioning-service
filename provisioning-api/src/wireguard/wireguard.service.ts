import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface WireguardKeypair {
  privateKey: string;
  publicKey: string;
}

export interface WireguardPeerStats {
  publicKey: string;
  endpoint: string;
  allowedIps: string;
  latestHandshake: number; // Unix timestamp (seconds)
  transferRx: number; // Bytes received by server
  transferTx: number; // Bytes sent by server
  isOnline: boolean; // Handshake within last 180 seconds
}

export interface WireguardServerInfo {
  interfaceName: string;
  publicKey: string;
  listenPort: number;
  endpoint: string;
  isKernelActive: boolean;
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

  /**
   * Lấy thông tin trạng thái máy chủ WireGuard
   */
  async getServerInfo(): Promise<WireguardServerInfo> {
    const serverPubKey = this.configService.get<string>('WG_SERVER_PUBLIC_KEY', '');
    const serverEndpoint = this.configService.get<string>('WG_SERVER_ENDPOINT', '');
    const port = parseInt(serverEndpoint.split(':')[1] || '10006', 10);

    let isKernelActive = false;
    try {
      const { stdout } = await execAsync(`sudo wg show ${this.interfaceName} 2>/dev/null || wg show ${this.interfaceName} 2>/dev/null`);
      if (stdout.trim().length > 0) {
        isKernelActive = true;
      }
    } catch {
      isKernelActive = false;
    }

    return {
      interfaceName: this.interfaceName,
      publicKey: serverPubKey,
      listenPort: port,
      endpoint: serverEndpoint,
      isKernelActive,
    };
  }

  /**
   * Lấy số liệu thống kê thời gian thực của toàn bộ WireGuard Peers từ Linux Kernel.
   * Sử dụng lệnh `wg show <interface> dump` để bóc tách thông số handshake và băng thông Tx/Rx.
   */
  async getLivePeerStats(): Promise<Map<string, WireguardPeerStats>> {
    const statsMap = new Map<string, WireguardPeerStats>();
    const nowEpoch = Math.floor(Date.now() / 1000);

    try {
      const { stdout } = await execAsync(`sudo wg show ${this.interfaceName} dump 2>/dev/null || wg show ${this.interfaceName} dump 2>/dev/null`);
      const lines = stdout.trim().split('\n');

      // Bỏ qua dòng đầu tiên (dòng cấu hình của interface server)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Định dạng dump: <public-key>\t<preshared-key>\t<endpoint>\t<allowed-ips>\t<latest-handshake>\t<transfer-rx>\t<transfer-tx>\t<persistent-keepalive>
        const parts = line.split('\t');
        if (parts.length >= 7) {
          const publicKey = parts[0];
          const endpoint = parts[2] === '(none)' ? '' : parts[2];
          const allowedIps = parts[3];
          const latestHandshake = parseInt(parts[4], 10) || 0;
          const transferRx = parseInt(parts[5], 10) || 0;
          const transferTx = parseInt(parts[6], 10) || 0;

          // Drone được coi là ONLINE nếu có handshake trong vòng 180 giây (3 phút) gần nhất
          const isOnline = latestHandshake > 0 && (nowEpoch - latestHandshake) <= 180;

          statsMap.set(publicKey, {
            publicKey,
            endpoint,
            allowedIps,
            latestHandshake,
            transferRx,
            transferTx,
            isOnline,
          });
        }
      }
    } catch (error) {
      this.logger.debug(`Could not read kernel WireGuard stats (normal in non-Linux dev env): ${error.message}`);
    }

    return statsMap;
  }
}
