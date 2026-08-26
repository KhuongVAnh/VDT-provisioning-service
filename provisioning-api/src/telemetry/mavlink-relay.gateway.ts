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
import { Logger, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import * as dgram from 'dgram';
import { RedisService } from '../redis/redis.service';
import { DeviceService } from '../device/device.service';

/**
 * ==============================================================================
 * MAVLINK BINARY RELAY GATEWAY (PILOT BRIDGE & QGROUNDCONTROL)
 * ==============================================================================
 * Cầu nối truyền thông nhị phân 2 chiều (Bi-directional Binary MAVLink Relay):
 * 
 * 1. [Downlink (Drone -> QGroundControl)]:
 *    - Nhận byte nhị phân MAVLink v2 thô từ Redis Pub/Sub và chuyển tiếp xuống WebSocket (Cổng 10004).
 * 
 * 2. [Uplink (QGroundControl / Cần lái -> Drone)]:
 *    - Nhận byte lệnh điều khiển từ WebSocket và bắn UDP Socket trực tiếp vào IP WireGuard của Drone (`10.13.37.X:14551`).
 * 
 * 3. [On-Demand Dynamic Subscription (Tối ưu hóa tài nguyên)]:
 *    - CHỈ `SUBSCRIBE` kênh Redis `channel:drone:raw:full:<id>` khi có Pilot thực sự kết nối điều khiển Drone đó.
 *    - Tự động `UNSUBSCRIBE` và xóa khỏi `drone:focus_set` khi Pilot ngắt kết nối $\rightarrow$ Tiết kiệm 100% tài nguyên CPU & Socket cho các Drone không có người xem.
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
export class MavlinkRelayGateway implements OnGatewayInit, OnModuleInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MavlinkRelayGateway.name);
  private udpSocket: dgram.Socket;
  private readonly uplinkPort: number;
  
  // Lưu danh sách client đang theo dõi từng drone: droneId -> Set<Socket>
  private droneClients = new Map<string, Set<Socket>>();
  // Tập hợp các kênh raw đang được đăng ký trong Redis (tránh duplicate subscribe)
  private subscribedRawChannels = new Set<string>();
  private isSubscriberReady = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly deviceService: DeviceService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.uplinkPort = Number(this.configService.get<number>('DRONE_UPLINK_UDP_PORT', 14551));
  }

  onModuleInit() {
    this.initRedisMessageListener();
  }

  afterInit() {
    this.udpSocket = dgram.createSocket('udp4');
    this.udpSocket.on('error', (err) => {
      this.logger.error(`Lỗi UDP Uplink Socket: ${err.message}`);
    });
    this.logger.log(`✅ MAVLink Relay Gateway đã khởi tạo trên namespace /mavlink (Uplink Port: ${this.uplinkPort})`);

    this.initRedisMessageListener();
  }

  /**
   * ============================================================================
   * 1. KHỞI TẠO BỘ LẮNG NGHE TIN NHẮN NHỊ PHÂN REDIS PUB/SUB (ON-DEMAND)
   * ============================================================================
   */
  private initRedisMessageListener() {
    if (this.isSubscriberReady) return;

    const subscriber = this.redisService.getSubscriber();
    if (!subscriber) {
      setTimeout(() => this.initRedisMessageListener(), 500);
      return;
    }

    this.isSubscriberReady = true;

    // Lắng nghe sự kiện messageBuffer (Buffer nhị phân) để không bị lỗi UTF-8 encoding
    subscriber.on('messageBuffer', (channelBuf: Buffer, messageBuf: Buffer) => {
      const channel = channelBuf.toString();
      const prefixFull = 'channel:drone:raw:full:';
      const prefixLite = 'channel:drone:raw:lite:';
      const prefixLegacy = 'channel:drone:raw:';

      let droneId = '';
      if (channel.startsWith(prefixFull)) {
        droneId = channel.substring(prefixFull.length);
      } else if (channel.startsWith(prefixLite)) {
        droneId = channel.substring(prefixLite.length);
      } else if (channel.startsWith(prefixLegacy)) {
        droneId = channel.substring(prefixLegacy.length);
      }

      if (droneId) {
        this.broadcastDownlink(droneId, messageBuf);
      }
    });

    this.logger.log('✅ Đã sẵn sàng bộ lắng nghe Redis Buffer cho MAVLink On-Demand Relay');
  }

  /**
   * ============================================================================
   * 2. XỬ LÝ KHI PILOT BRIDGE KẾT NỐI (XÁC THỰC VÀ ON-DEMAND SUBSCRIBE)
   * ============================================================================
   */
  async handleConnection(client: Socket) {
    // [Bước 1]: Lấy droneId và token từ query params hoặc headers
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

    // [Bước 2]: Xác thực JWT Token & Quyền sở hữu Drone
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
    const clientsSet = this.droneClients.get(droneId)!;
    clientsSet.add(client);

    // ============================================================================
    // ON-DEMAND DYNAMIC SUBSCRIPTION:
    // Khi có Pilot đầu tiên kết nối vào Drone này -> Mới kích hoạt đăng ký kênh Redis
    // ============================================================================
    if (clientsSet.size === 1) {
      const subscriber = this.redisService.getSubscriber();
      const rawFullChannel = `channel:drone:raw:full:${droneId}`;
      if (subscriber && !this.subscribedRawChannels.has(rawFullChannel)) {
        subscriber.subscribe(rawFullChannel, (err) => {
          if (!err) {
            this.subscribedRawChannels.add(rawFullChannel);
            this.logger.log(`🟢 [ON-DEMAND SUB] Đã kích hoạt lắng nghe Redis Raw: ${rawFullChannel}`);
          }
        });
      }

      // Kích hoạt Focus trong Redis để Go Ingestion chuyển sang phát 10Hz Full
      await this.redisService.addFocusDrone(droneId);
    }

    this.logger.log(`🎮 Pilot Bridge [${client.id}] đã kết nối MAVLink Relay cho Drone: ${droneId} (Active Viewers: ${clientsSet.size})`);
  }

  /**
   * ============================================================================
   * 3. XỬ LÝ KHI PILOT BRIDGE NGẮT KẾT NỐI (ON-DEMAND UNSUBSCRIBE & CLEANUP)
   * ============================================================================
   */
  async handleDisconnect(client: Socket) {
    const droneId = client.data?.droneId;
    if (droneId && this.droneClients.has(droneId)) {
      const clientsSet = this.droneClients.get(droneId)!;
      clientsSet.delete(client);

      // ============================================================================
      // ON-DEMAND UNSUBSCRIBE:
      // Khi Pilot cuối cùng ngắt kết nối -> Tự động hủy đăng ký kênh Redis để giải phóng tài nguyên
      // ============================================================================
      if (clientsSet.size === 0) {
        this.droneClients.delete(droneId);

        const subscriber = this.redisService.getSubscriber();
        const rawFullChannel = `channel:drone:raw:full:${droneId}`;
        if (subscriber && this.subscribedRawChannels.has(rawFullChannel)) {
          subscriber.unsubscribe(rawFullChannel, (err) => {
            if (!err) {
              this.subscribedRawChannels.delete(rawFullChannel);
              this.logger.log(`⚪ [ON-DEMAND UNSUB] Đã hủy đăng ký Redis Raw: ${rawFullChannel}`);
            }
          });
        }

        // Xóa khỏi Focus Set để Go Ingestion tự động hạ tần số xuống 1Hz Lite
        await this.redisService.removeFocusDrone(droneId);
      }
    }
    this.logger.log(`🔌 Pilot Bridge [${client.id}] đã ngắt kết nối MAVLink Relay (${droneId || 'unknown'})`);
  }

  /**
   * ============================================================================
   * 4. DOWNLINK (DRONE -> QGROUNDCONTROL): BẮN BYTE NHỊ PHÂN MAVLINK XUỐNG WEBSOCKET
   * ============================================================================
   */
  broadcastDownlink(droneId: string, rawBuffer: Buffer) {
    const clients = this.droneClients.get(droneId);
    if (!clients || clients.size === 0) return;

    for (const client of clients) {
      if (client.connected) {
        client.emit('mavlink:downlink', rawBuffer);
        client.send(rawBuffer);
      }
    }
  }

  /**
   * ============================================================================
   * 5. UPLINK (QGROUNDCONTROL / CẦN LÁI -> DRONE): BẮN LỆNH ĐIỀU KHIỂN UDP XUỐNG DRONE
   * ============================================================================
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

  onModuleDestroy() {
    if (this.udpSocket) {
      try {
        this.udpSocket.close();
      } catch (e) {}
    }
  }
}
