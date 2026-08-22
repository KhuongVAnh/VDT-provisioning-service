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
 * VideoGateway quản lý các kết nối WebSocket xem video thời gian thực từ Web Dashboard,
 * cho phép client đăng ký phòng `video:<deviceId>` để nhận luồng hình ảnh hoặc thông báo trạng thái luồng.
 */
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class VideoGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(VideoGateway.name);

  handleConnection(client: Socket) {
    this.logger.debug(`Client kết nối Video WebSocket Gateway: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client ngắt kết nối Video WebSocket Gateway: ${client.id}`);
  }

  /**
   * Client đăng ký theo dõi luồng video của 1 Drone
   */
  @SubscribeMessage('video:subscribe')
  handleSubscribeVideo(@ConnectedSocket() client: Socket, @MessageBody() data: { deviceId: string }) {
    if (!data?.deviceId) {
      return { status: 'error', message: 'Thiếu deviceId' };
    }

    const room = `video:${data.deviceId.trim()}`;
    client.join(room);
    this.logger.log(`Client ${client.id} bắt đầu theo dõi luồng video phòng [${room}]`);

    return {
      status: 'success',
      room,
      message: `Đã kết nối luồng video ${data.deviceId}`,
    };
  }

  /**
   * Client hủy theo dõi luồng video của 1 Drone
   */
  @SubscribeMessage('video:unsubscribe')
  handleUnsubscribeVideo(@ConnectedSocket() client: Socket, @MessageBody() data: { deviceId: string }) {
    if (!data?.deviceId) {
      return { status: 'error', message: 'Thiếu deviceId' };
    }

    const room = `video:${data.deviceId.trim()}`;
    client.leave(room);
    this.logger.log(`Client ${client.id} hủy theo dõi luồng video phòng [${room}]`);

    return {
      status: 'success',
      room,
      message: `Đã hủy theo dõi luồng video ${data.deviceId}`,
    };
  }

  /**
   * Phát gói dữ liệu video (Binary Chunk / H.264 NAL / MPEG-TS) tới các client đang xem Drone này
   */
  broadcastVideoChunk(deviceId: string, chunk: Buffer | ArrayBuffer | string) {
    if (!this.server || !deviceId) return;
    const room = `video:${deviceId.trim()}`;
    this.server.to(room).emit('video:data', chunk);
  }
}
