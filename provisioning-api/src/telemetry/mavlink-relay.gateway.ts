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
 * Cầu nối truyền thông nhị phân 2 chiều tốc độ cao (Bi-directional Binary MAVLink Relay):
 * 
 * 1. [Downlink (Drone -> QGroundControl / Pilot Bridge)]:
 *    - Nhận dòng byte nhị phân MAVLink v2 thô từ Redis Pub/Sub (`channel:drone:raw:full:<id>`).
 *    - Chuyển tiếp nguyên vẹn Buffer nhị phân xuống WebSocket (Namespace `/mavlink`, Port 10004).
 * 
 * 2. [Uplink (QGroundControl / Cần lái vật lý -> Drone)]:
 *    - Nhận byte lệnh điều khiển (Arm, Takeoff, Joystick, Waypoint) từ sự kiện WebSocket `mavlink:uplink`.
 *    - Bắn trực tiếp gói tin qua Linux UDP Datagram Socket vào IP VPN WireGuard của Drone (`10.13.37.X:14551`).
 * 
 * 3. [On-Demand Dynamic Subscription (Tối ưu hóa tài nguyên & Băng thông)]:
 *    - CHỈ `SUBSCRIBE` kênh Redis Raw và thêm vào `drone:focus_set` (để Go Ingestion phát 10Hz Full)
 *      khi có ít nhất 1 Pilot đang thực sự kết nối điều khiển Drone đó.
 *    - Tự động `UNSUBSCRIBE` và xóa khỏi `drone:focus_set` (Go Ingestion hạ về 1Hz Lite) khi Pilot cuối cùng
 *      ngắt kết nối $\rightarrow$ Tiết kiệm 100% tài nguyên CPU & Băng thông 4G cho Drone không người lái.
 * 
 * 4. [Bảo mật & Phân quyền Multi-tenant]:
 *    - Bắt buộc xác thực qua JWT Token.
 *    - PILOT chỉ được phép kết nối và điều khiển đúng Drone mà mình sở hữu.
 *    - ADMIN có toàn quyền kết nối điều khiển bất kỳ Drone nào.
 * 
 * Endpoint: ws://<IP_VPS>:10004/mavlink?token=JWT_TOKEN&droneId=DRONE_ID
 * ==============================================================================
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

  // ----------------------------------------------------------------------------
  // Quản lý Socket Uplink UDP & Cấu hình mạng
  // ----------------------------------------------------------------------------
  private udpSocket: dgram.Socket; // Socket UDP cục bộ dùng để bắn gói tin MAVLink Uplink xuống Drone
  private readonly uplinkPort: number; // Cổng UDP lắng nghe MAVLink trên Drone (Mặc định: 14551)

  // ----------------------------------------------------------------------------
  // Quản lý danh sách kết nối Pilot & Kênh Redis (On-Demand Subscription)
  // ----------------------------------------------------------------------------
  // Bảng băm quản lý danh sách Socket đang theo dõi từng Drone: Key = deviceId -> Value = Set<Socket>
  private droneClients = new Map<string, Set<Socket>>();

  // Tập hợp các kênh Redis Raw đang được kích hoạt Subscribe (tránh duplicate subscribe)
  private subscribedRawChannels = new Set<string>();

  // Cờ đánh dấu bộ lắng nghe tin nhắn Redis đã sẵn sàng hay chưa
  private isSubscriberReady = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly deviceService: DeviceService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    // Đọc cổng Uplink UDP từ cấu hình môi trường (.env), mặc định cổng chuẩn MAVLink là 14551
    this.uplinkPort = Number(this.configService.get<number>('DRONE_UPLINK_UDP_PORT', 14551));
  }

  /**
   * Hook khởi động Module NestJS: Đăng ký lắng nghe sự kiện từ Redis Pub/Sub
   */
  onModuleInit() {
    this.initRedisMessageListener();
  }

  /**
   * Hook khởi tạo WebSocket Server: Tạo UDP Socket phục vụ truyền lệnh điều khiển Uplink
   */
  afterInit() {
    // Khởi tạo UDP Socket IPv4 cho luồng Uplink
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
   * Sử dụng sự kiện `messageBuffer` của thư viện `ioredis` thay vì `message` thông thường:
   *  - Giữ nguyên vẹn 100% luồng byte nhị phân của gói tin MAVLink v2 (Header 0xFD, Payload, Checksum CRC).
   *  - Tránh triệt để lỗi hỏng dữ liệu do tự động decode sang chuỗi UTF-8.
   */
  private initRedisMessageListener() {
    if (this.isSubscriberReady) return;

    const subscriber = this.redisService.getSubscriber();
    if (!subscriber) {
      // Nếu Redis Subscriber chưa sẵn sàng (đang kết nối lại), thử lại sau 500ms
      setTimeout(() => this.initRedisMessageListener(), 500);
      return;
    }

    this.isSubscriberReady = true;

    // Lắng nghe sự kiện messageBuffer để nhận Buffer nhị phân trực tiếp từ Redis
    subscriber.on('messageBuffer', (channelBuf: Buffer, messageBuf: Buffer) => {
      const channel = channelBuf.toString();
      const prefixFull = 'channel:drone:raw:full:';
      const prefixLite = 'channel:drone:raw:lite:';

      // Trích xuất mã DroneID từ tên kênh Redis Pub/Sub chuẩn 2 tầng (Full / Lite)
      let droneId = '';
      if (channel.startsWith(prefixFull)) {
        droneId = channel.substring(prefixFull.length);
      } else if (channel.startsWith(prefixLite)) {
        droneId = channel.substring(prefixLite.length);
      }

      // Nếu xác định được DroneID, chuyển tiếp ngay dòng byte này xuống các Pilot đang kết nối
      if (droneId) {
        this.broadcastDownlink(droneId, messageBuf);
      }
    });

    this.logger.log('✅ Đã sẵn sàng bộ lắng nghe Redis Buffer cho MAVLink On-Demand Relay');
  }

  /**
   * ============================================================================
   * 2. XỬ LÝ KHI PILOT BRIDGE / QGROUNDCONTROL KẾT NỐI (HANDSHAKE & AUTH)
   * ============================================================================
   * Quy trình xử lý gồm 4 bước:
   *  - [Bước 1]: Trích xuất mã DroneID và JWT Token từ query params hoặc headers.
   *  - [Bước 2]: Xác thực JWT và kiểm tra quyền sở hữu Drone (Phân quyền Multi-tenant).
   *  - [Bước 3]: Đưa Pilot Socket vào nhóm quản lý trực tiếp trong RAM (`droneClients`).
   *  - [Bước 4]: Kích hoạt On-Demand Subscription nếu đây là Pilot đầu tiên kết nối vào Drone này.
   */
  async handleConnection(client: Socket) {
    // --------------------------------------------------------------------------
    // [BƯỚC 1]: Lấy tham số droneId và JWT Token từ Query String hoặc HTTP Headers
    // --------------------------------------------------------------------------
    const droneId = (client.handshake?.query?.droneId as string) || (client.handshake?.headers?.['x-drone-id'] as string);
    const rawToken =
      (client.handshake?.query?.token as string) ||
      (client.handshake?.headers?.authorization as string) ||
      (client.handshake?.headers?.['x-token'] as string);

    // Kiểm tra bắt buộc phải truyền mã Drone muốn điều khiển
    if (!droneId) {
      this.logger.warn(`Client ${client.id} bị từ chối kết nối do thiếu tham số droneId (?droneId=...)`);
      client.emit('error', { message: 'Thiếu tham số droneId trong query params (?droneId=DRONE_ID)' });
      client.disconnect(true);
      return;
    }

    // --------------------------------------------------------------------------
    // [BƯỚC 2]: Xác thực JWT Token & Kiểm tra quyền sở hữu Drone (Multi-tenant Auth)
    // --------------------------------------------------------------------------
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
      // Giải mã và kiểm tra tính hợp lệ của chữ ký JWT
      payload = this.jwtService.verify(token);

      // Nếu User có vai trò PILOT -> Bắt buộc kiểm tra Drone này có thuộc quyền sở hữu của Pilot đó không
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
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Client ${client.id} bị từ chối: Token xác thực không hợp lệ (${errorMessage})`);
      client.emit('error', { message: 'Token xác thực không hợp lệ hoặc đã hết hạn' });
      client.disconnect(true);
      return;
    }

    // Lưu thông tin ngữ cảnh vào Socket data để tái sử dụng khi disconnect hoặc gửi uplink
    client.data = client.data || {};
    client.data.droneId = droneId;
    client.data.user = payload;

    // --------------------------------------------------------------------------
    // [BƯỚC 3]: Đưa Pilot Socket vào nhóm quản lý trong RAM của Drone tương ứng
    // --------------------------------------------------------------------------
    if (!this.droneClients.has(droneId)) {
      this.droneClients.set(droneId, new Set());
    }
    const clientsSet = this.droneClients.get(droneId)!;
    clientsSet.add(client); // Đưa Socket này vào Set theo dõi Drone

    // --------------------------------------------------------------------------
    // [BƯỚC 4]: On-Demand Dynamic Subscription (Tối ưu hóa tài nguyên)
    // --------------------------------------------------------------------------
    // Khi có Pilot đầu tiên (size === 1) kết nối vào Drone này:
    //  1. Đăng ký SUBSCRIBE kênh Redis `channel:drone:raw:full:<id>` để nhận byte MAVLink thô.
    //  2. Đưa Drone vào `drone:focus_set` để Go Ingestion Service kích hoạt luồng phát 10Hz Full.
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

    this.logger.log(
      `🎮 Pilot Bridge [${client.id}] đã kết nối MAVLink Relay cho Drone: ${droneId} (Active Viewers: ${clientsSet.size})`,
    );
  }

  /**
   * ============================================================================
   * 3. XỬ LÝ KHI PILOT BRIDGE NGẮT KẾT NỐI (ON-DEMAND UNSUBSCRIBE & CLEANUP)
   * ============================================================================
   * Khi Pilot đóng QGroundControl hoặc ngắt cáp kết nối:
   *  - Xóa Socket khỏi danh sách `droneClients`.
   *  - Nếu không còn Pilot nào theo dõi Drone này (size === 0):
   *    -> Tự động `UNSUBSCRIBE` khỏi kênh Redis Raw.
   *    -> Xóa khỏi Redis Set `drone:focus_set` để Go Ingestion tự động hạ tần số về 1Hz Lite.
   */
  async handleDisconnect(client: Socket) {
    const droneId = client.data?.droneId;
    if (droneId && this.droneClients.has(droneId)) {
      const clientsSet = this.droneClients.get(droneId)!;
      clientsSet.delete(client); // Xóa client khỏi Set

      // Khi không còn bất kỳ ai theo dõi Drone này nữa
      if (clientsSet.size === 0) {
        this.droneClients.delete(droneId);

        // Hủy đăng ký kênh Redis Raw để giải phóng tài nguyên mạng
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

        // Xóa khỏi Focus Set để Go Ingestion tự động hạ tần số xuống 1Hz Lite (Tiết kiệm 4G)
        await this.redisService.removeFocusDrone(droneId);
      }
    }
    this.logger.log(`🔌 Pilot Bridge [${client.id}] đã ngắt kết nối MAVLink Relay (${droneId || 'unknown'})`);
  }

  /**
   * ============================================================================
   * 4. DOWNLINK (DRONE -> QGROUNDCONTROL): BẮN BYTE NHỊ PHÂN MAVLINK XUỐNG WEBSOCKET
   * ============================================================================
   * Nhận Buffer nhị phân thô từ Redis và gửi trực tiếp xuống toàn bộ Pilot đang điều khiển Drone này.
   * Hỗ trợ cả 2 chuẩn giao tiếp:
   *  - `client.emit('mavlink:downlink', rawBuffer)`: Cho Socket.IO Event Handler.
   *  - `client.send(rawBuffer)`: Cho Raw WebSocket Stream (ArrayBuffer) tương thích tối đa với QGroundControl.
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
   * Lắng nghe sự kiện `mavlink:uplink` từ WebSocket client (chứa byte lệnh điều khiển từ cần lái):
   *  1. Kiểm tra mã DroneID và chuyển đổi payload sang dạng Buffer nhị phân.
   *  2. Tra cứu địa chỉ IP VPN WireGuard của Drone (`device.vpnIp`, ví dụ: `10.13.37.5`).
   *  3. Sử dụng UDP Socket bắn trực tiếp gói tin vào cổng `uplinkPort` (14551) trên Drone.
   */
  @SubscribeMessage('mavlink:uplink')
  async handleMavlinkUplink(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
    const droneId = client.data?.droneId;
    if (!droneId || !data) return;

    try {
      // Chuẩn hóa dữ liệu sang Node.js Buffer
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buffer.length === 0) return;

      // Tra cứu thông tin thiết bị để lấy IP WireGuard
      const device = await this.deviceService.findByDeviceId(droneId);
      if (device && device.vpnIp && this.udpSocket) {
        // Gửi trực tiếp gói tin UDP tới cổng lắng nghe MAVLink trên bo mạch Drone
        this.udpSocket.send(buffer, this.uplinkPort, device.vpnIp, (err) => {
          if (err) {
            this.logger.warn(
              `Lỗi gửi MAVLink Uplink tới Drone ${droneId} (${device.vpnIp}:${this.uplinkPort}): ${err.message}`,
            );
          }
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Lỗi xử lý MAVLink Uplink từ client ${client.id}: ${errorMessage}`);
    }
  }

  /**
   * Hook hủy Module: Đóng UDP Socket an toàn khi ứng dụng shutdown
   */
  onModuleDestroy() {
    if (this.udpSocket) {
      try {
        this.udpSocket.close();
        this.logger.log('Đã đóng UDP Uplink Socket an toàn.');
      } catch (e) { }
    }
  }
}
