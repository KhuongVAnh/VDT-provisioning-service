import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WebSshService, SshConnectOptions } from './web-ssh.service';
import { JwtService } from '@nestjs/jwt';
import { DeviceService } from '../device/device.service';

/**
 * WebSshGateway quản lý các kết nối WebSocket Terminal từ trình duyệt Web Dashboard,
 * nhận phím gõ từ `xterm.js` và chuyển tiếp trực tiếp vào luồng SSH trên Drone.
 * Bảo mật: Chỉ ADMIN hoặc PILOT sở hữu Drone mới được mở Terminal SSH vào Linux của Drone.
 */
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@Injectable()
export class WebSshGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebSshGateway.name);

  constructor(
    private readonly webSshService: WebSshService,
    private readonly jwtService: JwtService,
    private readonly deviceService: DeviceService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client kết nối Web SSH Gateway: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client Web SSH ngắt kết nối: ${client.id}`);
    this.webSshService.closeSshSession(client.id);
  }

  /**
   * Client yêu cầu mở phiên SSH tới Drone (Kiểm tra xác thực & quyền sở hữu)
   */
  @SubscribeMessage('ssh:connect')
  async handleConnect(@ConnectedSocket() client: Socket, @MessageBody() options: SshConnectOptions & { token?: string }) {
    if (!options?.deviceId) {
      client.emit('ssh:status', {
        status: 'error',
        message: 'Thiếu deviceId của Drone.',
      });
      return;
    }

    const rawToken =
      options?.token ||
      (client.handshake?.auth?.token as string) ||
      (client.handshake?.query?.token as string) ||
      (client.handshake?.headers?.authorization as string);

    let token = rawToken;
    if (token && token.startsWith('Bearer ')) {
      token = token.substring(7);
    }

    if (!token) {
      client.emit('ssh:status', {
        status: 'error',
        message: 'Yêu cầu đăng nhập và cung cấp token xác thực trước khi mở SSH.',
      });
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      if (payload && payload.role !== 'ADMIN') {
        let device: any = await this.deviceService.findByDeviceId(options.deviceId);

        // Nếu người dùng nhập IP trực tiếp, tìm theo vpnIp
        if (!device) {
          device = await this.deviceService.findByVpnIp(options.deviceId);
        }

        if (!device || device.userId !== payload.sub) {
          client.emit('ssh:status', {
            status: 'error',
            message: `Quyền truy cập bị từ chối: Bạn không sở hữu Drone [${options.deviceId}] để mở SSH!`,
          });
          return;
        }
      }
    } catch (err) {
      client.emit('ssh:status', {
        status: 'error',
        message: 'Token xác thực không hợp lệ hoặc đã hết hạn.',
      });
      return;
    }

    await this.webSshService.createSshSession(client, options);
  }

  /**
   * Client yêu cầu ngắt kết nối SSH chủ động
   */
  @SubscribeMessage('ssh:disconnect')
  handleDisconnectSession(@ConnectedSocket() client: Socket) {
    this.logger.log(`Client ${client.id} yêu cầu ngắt kết nối SSH.`);
    this.webSshService.closeSshSession(client.id);
    client.emit('ssh:status', {
      status: 'closed',
      message: 'Đã ngắt kết nối SSH thành công.',
    });
  }

  /**
   * Client gửi ký tự phím bấm (stdin) từ Web Terminal
   */
  @SubscribeMessage('ssh:input')
  handleInput(@ConnectedSocket() client: Socket, @MessageBody() payload: { data: string }) {
    if (payload?.data !== undefined) {
      this.webSshService.handleInput(client.id, payload.data);
    }
  }

  /**
   * Client thay đổi kích thước cửa sổ Web Terminal (Cols/Rows)
   */
  @SubscribeMessage('ssh:resize')
  handleResize(@ConnectedSocket() client: Socket, @MessageBody() payload: { cols: number; rows: number }) {
    if (payload?.cols && payload?.rows) {
      this.webSshService.handleResize(client.id, payload.cols, payload.rows);
    }
  }
}
