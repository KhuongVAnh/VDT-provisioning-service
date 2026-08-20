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

/**
 * TelemetryGateway chịu trách nhiệm quản lý các kết nối WebSocket từ trình duyệt Web Dashboard,
 * hỗ trợ cơ chế Rooms để client có thể đăng ký xem riêng 1 drone hoặc xem toàn bộ phi đội.
 */
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class TelemetryGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TelemetryGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client WebSocket kết nối: ${client.id}`);
    // Mặc định cho client vào phòng 'all' để xem toàn phi đội
    client.join('all');
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client WebSocket ngắt kết nối: ${client.id}`);
  }

  /**
   * Client gửi yêu cầu theo dõi riêng 1 Drone cụ thể
   */
  @SubscribeMessage('subscribe:drone')
  handleSubscribeDrone(@ConnectedSocket() client: Socket, @MessageBody() data: { deviceId: string }) {
    if (data?.deviceId) {
      const room = `drone:${data.deviceId}`;
      client.join(room);
      this.logger.debug(`Client ${client.id} đã tham gia theo dõi phòng ${room}`);
      return { status: 'subscribed', room };
    }
  }

  /**
   * Client hủy theo dõi 1 Drone cụ thể
   */
  @SubscribeMessage('unsubscribe:drone')
  handleUnsubscribeDrone(@ConnectedSocket() client: Socket, @MessageBody() data: { deviceId: string }) {
    if (data?.deviceId) {
      const room = `drone:${data.deviceId}`;
      client.leave(room);
      this.logger.debug(`Client ${client.id} đã rời phòng ${room}`);
      return { status: 'unsubscribed', room };
    }
  }

  /**
   * Client đăng ký theo dõi toàn bộ phi đội Drone
   */
  @SubscribeMessage('subscribe:all')
  handleSubscribeAll(@ConnectedSocket() client: Socket) {
    client.join('all');
    return { status: 'subscribed', room: 'all' };
  }

  /**
   * Phát dữ liệu Telemetry mới nhất tới các client đang theo dõi
   */
  broadcastTelemetry(telemetryData: any) {
    if (!this.server || !telemetryData?.deviceId) return;

    const deviceRoom = `drone:${telemetryData.deviceId}`;

    // 1. Gửi tới phòng riêng của Drone đó
    this.server.to(deviceRoom).emit('telemetry:update', telemetryData);

    // 2. Gửi tới phòng tổng 'all'
    this.server.to('all').emit('telemetry:update', telemetryData);
  }
}
