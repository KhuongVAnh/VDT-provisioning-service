import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WebSshService, SshConnectOptions } from './web-ssh.service';

/**
 * WebSshGateway quản lý các kết nối WebSocket Terminal từ trình duyệt Web Dashboard,
 * nhận phím gõ từ `xterm.js` và chuyển tiếp trực tiếp vào luồng SSH trên Drone.
 */
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class WebSshGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebSshGateway.name);

  constructor(private readonly webSshService: WebSshService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client kết nối Web SSH Gateway: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client Web SSH ngắt kết nối: ${client.id}`);
    this.webSshService.closeSshSession(client.id);
  }

  /**
   * Client yêu cầu mở phiên SSH tới Drone
   */
  @SubscribeMessage('ssh:connect')
  async handleConnect(@ConnectedSocket() client: Socket, @MessageBody() options: SshConnectOptions) {
    if (!options?.deviceId) {
      client.emit('ssh:status', {
        status: 'error',
        message: 'Thiếu deviceId của Drone.',
      });
      return;
    }
    await this.webSshService.createSshSession(client, options);
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
