import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import * as dgram from 'dgram';
import { RedisService } from '../redis/redis.service';
import { DeviceService } from '../device/device.service';

/**
 * MavlinkRelayGateway chịu trách nhiệm làm cầu nối nhị phân 2 chiều (Binary MAVLink Relay):
 * 1. Downlink (Drone -> QGC): Nhận byte MAVLink thô từ Redis `channel:drone:raw:<droneId>` và bắn xuống WebSocket.
 * 2. Uplink (QGC -> Drone): Nhận byte điều khiển từ WebSocket và bắn UDP Socket xuống `10.13.37.X:14550`.
 * 3. Bảo mật: Yêu cầu JWT token xác thực quyền sở hữu Drone trước khi cho phép kết nối điều khiển.
 * 
 * Endpoint: ws://<IP_VPS>:10004/mavlink?token=JWT_TOKEN&droneId=DRONE_ID
 */
@WebSocketGateway({
  namespace: '/mavlink',
  cors: {
    origin: '*',
  },
})
@Injectable()
export class MavlinkRelayGateway implements OnGatewayInit, OnModuleInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MavlinkRelayGateway.name);
  private udpSocket: dgram.Socket;
  private readonly uplinkPort: number;
  // Cờ đánh dấu trạng thái đăng ký Redis Pub/Sub (tránh duplicate subscription)
  private isRedisSubscribed = false;
  // Lưu danh sách client đang theo dõi từng drone: droneId -> Set<Socket>
  private droneClients = new Map<string, Set<Socket>>();

  constructor(
    private readonly redisService: RedisService,
    private readonly deviceService: DeviceService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.uplinkPort = Number(this.configService.get<number>('DRONE_UPLINK_UDP_PORT', 14551));
  }

  /**
   * Hook vòng đời Module NestJS: Đảm bảo đăng ký Redis Pub/Sub sau khi các Provider (RedisService) đã khởi tạo
   */
  onModuleInit() {
    this.initRedisSubscription();
  }

  /**
   * Hook vòng đời WebSocket Gateway: Khởi tạo UDP Socket và kích hoạt đăng ký Redis
   */
  afterInit() {
    this.udpSocket = dgram.createSocket('udp4');
    this.udpSocket.on('error', (err) => {
      this.logger.error(`Lỗi UDP Uplink Socket: ${err.message}`);
    });
    this.logger.log(`✅ MAVLink Relay Gateway đã khởi tạo trên namespace /mavlink (Uplink Port: ${this.uplinkPort})`);

    this.initRedisSubscription();
  }

  /**
   * Lắng nghe kênh Redis Pub/Sub chứa luồng byte nhị phân MAVLink thô từ Go Ingestion Service.
   * Tích hợp cơ chế Auto-Retry (Polling 500ms) để xử lý triệt để Race Condition khi WebSocket Gateway
   * khởi tạo trước thời điểm Redis Connection sẵn sàng.
   */
  private initRedisSubscription() {
    // Nếu đã đăng ký thành công trước đó thì bỏ qua (tránh double listener)
    if (this.isRedisSubscribed) return;

    const subscriber = this.redisService.getSubscriber();
    if (!subscriber) {
      this.logger.warn('Redis Subscriber chưa sẵn sàng, sẽ tự động thử lại sau 500ms...');
      setTimeout(() => this.initRedisSubscription(), 500);
      return;
    }

    this.isRedisSubscribed = true;

    // Đăng ký pattern tất cả các kênh drone raw: channel:drone:raw:*
    subscriber.psubscribe('channel:drone:raw:*', (err) => {
      if (err) {
        this.logger.error(`Lỗi psubscribe channel:drone:raw:*: ${err.message}`);
        this.isRedisSubscribed = false; // Reset cờ để cho phép thử lại nếu lỗi
      } else {
        this.logger.log('✅ Đã đăng ký lắng nghe Redis Pattern: channel:drone:raw:*');
      }
    });

    // Lắng nghe pmessageBuffer để giữ nguyên dạng nhị phân thô không bị lỗi chuỗi UTF-8
    subscriber.on('pmessageBuffer', (patternBuf: Buffer, channelBuf: Buffer, messageBuf: Buffer) => {
      const channel = channelBuf.toString();
      const prefix = 'channel:drone:raw:';
      if (channel.startsWith(prefix)) {
        const droneId = channel.substring(prefix.length);
        this.broadcastDownlink(droneId, messageBuf);
      }
    });
  }

  async handleConnection(client: Socket) {
    // 1. Lấy droneId và token từ query params hoặc headers
    const droneId = (client.handshake?.query?.droneId as string) || (client.handshake?.headers?.['x-drone-id'] as string);
    const rawToken =
      (client.handshake?.query?.token as string) ||
      (client.handshake?.headers?.authorization as string) ||
      (client.handshake?.headers?.['x-token'] as string);

    if (!droneId) {
      this.logger.warn(`Client ${client.id} bị từ chối kết nối do thiếu tham số droneId (?droneId=...)`);
      client.emit('error', { message: 'Thiếu tham số droneId trong query params (?droneId=DRONE_ID)' });
      client.disconnect(true);
      return;
    }

    // 2. Xác thực JWT Token & Quyền sở hữu Drone
    let token = rawToken;
    if (token && token.startsWith('Bearer ')) {
      token = token.substring(7);
    }

    if (!token) {
      this.logger.warn(`Client ${client.id} bị từ chối kết nối do thiếu token xác thực`);
      client.emit('error', { message: 'Yêu cầu token xác thực JWT (?token=... hoặc Header Authorization)' });
      client.disconnect(true);
      return;
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(token);
      if (payload && payload.role !== 'ADMIN') {
        // Kiểm tra xem User có sở hữu Drone này không
        const device: any = await this.deviceService.findByDeviceId(droneId);

        if (!device || device.userId !== payload.sub) {
          this.logger.warn(`Client ${client.id} (User: ${payload.email}) bị từ chối: Không sở hữu Drone [${droneId}]`);
          client.emit('error', { message: `Bạn không có quyền điều khiển Drone [${droneId}]` });
          client.disconnect(true);
          return;
        }
      }
    } catch (err) {
      this.logger.warn(`Client ${client.id} bị từ chối: Token xác thực không hợp lệ (${err.message})`);
      client.emit('error', { message: 'Token xác thực không hợp lệ hoặc đã hết hạn' });
      client.disconnect(true);
      return;
    }

    client.data = client.data || {};
    client.data.droneId = droneId;
    client.data.user = payload;

    if (!this.droneClients.has(droneId)) {
      this.droneClients.set(droneId, new Set());
    }
    this.droneClients.get(droneId)!.add(client);

    this.logger.log(`🎮 Pilot Bridge [${client.id}] đã xác thực & kết nối MAVLink Relay cho Drone: ${droneId} (User: ${payload?.email || 'Unknown'})`);
  }

  handleDisconnect(client: Socket) {
    const droneId = client.data?.droneId;
    if (droneId && this.droneClients.has(droneId)) {
      this.droneClients.get(droneId)!.delete(client);
      if (this.droneClients.get(droneId)!.size === 0) {
        this.droneClients.delete(droneId);
      }
    }
    this.logger.log(`🔌 Pilot Bridge [${client.id}] đã ngắt kết nối MAVLink Relay (${droneId || 'unknown'})`);
  }

  /**
   * [Downlink] Bắn byte nhị phân MAVLink từ Drone xuống tất cả Pilot Bridge đang theo dõi Drone này
   */
  broadcastDownlink(droneId: string, rawBuffer: Buffer) {
    const clients = this.droneClients.get(droneId);
    if (!clients || clients.size === 0) return;

    for (const client of clients) {
      if (client.connected) {
        // Gửi qua sự kiện mavlink:downlink và binary packet
        client.emit('mavlink:downlink', rawBuffer);
        client.send(rawBuffer);
      }
    }
  }

  /**
   * [Uplink] Nhận byte lệnh điều khiển từ Pilot Bridge (QGroundControl) -> Bắn UDP vào IP VPN của Drone
   */
  @SubscribeMessage('mavlink:uplink')
  async handleMavlinkUplink(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    const droneId = client.data?.droneId;
    if (!droneId || !data) return;

    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buffer.length === 0) return;

      const device = await this.deviceService.findByDeviceId(droneId);
      if (device && device.vpnIp && this.udpSocket) {
        this.udpSocket.send(buffer, this.uplinkPort, device.vpnIp, (err) => {
          if (err) {
            this.logger.warn(`Lỗi gửi MAVLink Uplink tới Drone ${droneId} (${device.vpnIp}:${this.uplinkPort}): ${err.message}`);
          }
        });
      }
    } catch (err) {
      this.logger.warn(`Lỗi xử lý MAVLink Uplink từ client ${client.id}: ${err.message}`);
    }
  }

  /**
   * Đóng socket khi module bị hủy
   */
  onModuleDestroy() {
    if (this.udpSocket) {
      try {
        this.udpSocket.close();
      } catch (e) {}
    }
  }
}
