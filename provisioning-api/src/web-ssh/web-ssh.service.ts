import { Injectable, Logger } from '@nestjs/common';
import { Client, ClientChannel } from 'ssh2';
import { DeviceService } from '../device/device.service';
import { RedisService } from '../redis/redis.service';
import { Socket } from 'socket.io';

export interface SshConnectOptions {
  deviceId: string;
  username?: string;
  password?: string;
  privateKey?: string;
  cols?: number;
  rows?: number;
}

interface SshSession {
  client: Client;
  stream: ClientChannel | null;
  deviceId: string;
  vpnIp: string;
}

/**
 * WebSshService chịu trách nhiệm:
 * 1. Mở kết nối SSH2 trực tiếp tới IP VPN `10.13.37.X:22` của Drone.
 * 2. Khởi tạo Pseudo-Terminal (PTY) `xterm-256color` và kết nối với WebSocket client.
 * 3. Chuyển tiếp phím bấm (stdin) và hiển thị kết quả (stdout/stderr) hai chiều.
 * 4. Xử lý thay đổi kích thước khung hình Terminal (Resize).
 */
@Injectable()
export class WebSshService {
  private readonly logger = new Logger(WebSshService.name);
  private readonly sessions = new Map<string, SshSession>();

  constructor(
    private readonly deviceService: DeviceService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Khởi tạo phiên kết nối SSH tới Drone qua IP VPN nội bộ
   */
  async createSshSession(socket: Socket, options: SshConnectOptions): Promise<void> {
    const socketId = socket.id;

    // 1. Dọn dẹp session cũ nếu có
    this.closeSshSession(socketId);

    // 2. Tra cứu IP VPN của Drone (từ DB, Redis, hoặc trực tiếp từ định dạng IP)
    let vpnIp = '';
    const target = (options.deviceId || '').trim();

    // 2.1. Nếu người dùng nhập trực tiếp IP dạng 10.13.37.X
    if (/^10\.13\.37\.\d+$/.test(target)) {
      vpnIp = target;
    }

    // 2.2. Nếu là Drone định danh tạm thời từ Ingestion: DRONE-IP-10-13-37-X
    if (!vpnIp && target.startsWith('DRONE-IP-')) {
      vpnIp = target.replace('DRONE-IP-', '').replace(/-/g, '.');
    }

    // 2.3. Tra cứu từ Database SQLite
    if (!vpnIp) {
      const device = await this.deviceService.findByDeviceId(target);
      if (device && device.vpnIp) {
        vpnIp = device.vpnIp;
      }
    }

    // 2.4. Tra cứu từ Redis `drone:ip_map`
    if (!vpnIp) {
      try {
        const ipMap = (await this.redisService.getClient()?.hgetall('drone:ip_map')) || {};
        for (const [ip, devId] of Object.entries(ipMap)) {
          if (devId === target) {
            vpnIp = ip;
            break;
          }
        }
      } catch {
        // Bỏ qua nếu lỗi Redis
      }
    }

    if (!vpnIp) {
      socket.emit('ssh:status', {
        status: 'error',
        message: `Không tìm thấy địa chỉ IP VPN của Drone: "${target}". Vui lòng kiểm tra lại.`,
      });
      return;
    }

    const username = options.username || 'root';
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    this.logger.log(`Bắt đầu kết nối SSH tới ${target} tại ${vpnIp}:22 (User: ${username})...`);
    socket.emit('ssh:status', {
      status: 'connecting',
      message: `Đang kết nối SSH tới ${vpnIp}:22...`,
    });

    const sshClient = new Client();
    const session: SshSession = {
      client: sshClient,
      stream: null,
      deviceId: target,
      vpnIp,
    };
    this.sessions.set(socketId, session);

    sshClient
      .on('ready', () => {
        this.logger.log(`SSH xác thực thành công với Drone ${target} (${vpnIp})`);
        socket.emit('ssh:status', {
          status: 'connected',
          message: `Kết nối thành công tới ${target} (${vpnIp})`,
        });

        // Mở Pseudo-Terminal (PTY) dạng xterm-256color
        sshClient.shell(
          {
            term: 'xterm-256color',
            cols,
            rows,
          },
          (err, stream) => {
            if (err) {
              this.logger.error(`Lỗi khi mở SSH Shell: ${err.message}`);
              socket.emit('ssh:status', {
                status: 'error',
                message: `Lỗi mở Shell: ${err.message}`,
              });
              this.closeSshSession(socketId);
              return;
            }

            session.stream = stream;

            // Nhận luồng dữ liệu từ Drone (stdout) và gửi về trình duyệt
            stream.on('data', (data: Buffer) => {
              socket.emit('ssh:data', data.toString('utf-8'));
            });

            stream.stderr.on('data', (data: Buffer) => {
              socket.emit('ssh:data', data.toString('utf-8'));
            });

            stream.on('close', () => {
              this.logger.log(`SSH Shell của ${target} đã đóng.`);
              socket.emit('ssh:status', {
                status: 'closed',
                message: 'Phiên SSH đã kết thúc.',
              });
              this.closeSshSession(socketId);
            });
          },
        );
      })
      .on('error', (err) => {
        this.logger.error(`Lỗi kết nối SSH tới ${vpnIp}: ${err.message}`);
        socket.emit('ssh:status', {
          status: 'error',
          message: `Lỗi kết nối SSH tới ${vpnIp}: ${err.message}`,
        });
        this.closeSshSession(socketId);
      })
      .on('close', () => {
        this.sessions.delete(socketId);
      });

    // Cấu hình các phương thức xác thực SSH (Password hoặc Private Key)
    const connectConfig: any = {
      host: vpnIp,
      port: 22,
      username,
      readyTimeout: 10000,
    };

    if (options.privateKey) {
      connectConfig.privateKey = options.privateKey;
    } else if (options.password) {
      connectConfig.password = options.password;
    } else {
      connectConfig.password = 'raspberry';
    }

    try {
      sshClient.connect(connectConfig);
    } catch (err) {
      this.logger.error(`Không thể thực hiện sshClient.connect: ${err.message}`);
      socket.emit('ssh:status', {
        status: 'error',
        message: `Lỗi khởi tạo SSH: ${err.message}`,
      });
      this.closeSshSession(socketId);
    }
  }

  /**
   * Xử lý ký tự người dùng gõ từ bàn phím Web Terminal gửi xuống SSH
   */
  handleInput(socketId: string, data: string): void {
    const session = this.sessions.get(socketId);
    if (session && session.stream) {
      session.stream.write(data);
    }
  }

  /**
   * Xử lý thay đổi kích thước cửa sổ Web Terminal
   */
  handleResize(socketId: string, cols: number, rows: number): void {
    const session = this.sessions.get(socketId);
    if (session && session.stream) {
      session.stream.setWindow(rows, cols, 0, 0);
    }
  }

  /**
   * Đóng và giải phóng tài nguyên phiên SSH
   */
  closeSshSession(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (session) {
      if (session.stream) {
        session.stream.end();
      }
      if (session.client) {
        session.client.end();
      }
      this.sessions.delete(socketId);
      this.logger.debug(`Đã giải phóng phiên SSH cho socket ${socketId}`);
    }
  }
}
