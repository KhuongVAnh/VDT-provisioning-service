import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Injectable, forwardRef, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { DeviceService } from '../device/device.service';

/**
 * TelemetryGateway chịu trách nhiệm quản lý các kết nối WebSocket từ trình duyệt Web Dashboard,
 * hỗ trợ cơ chế Rooms để phân quyền:
 *  - ADMIN: Nhận toàn bộ Telemetry của tất cả Drone qua phòng 'admin' / 'all'.
 *  - PILOT: Chỉ nhận Telemetry của các Drone do chính mình sở hữu qua phòng 'user:<userId>'.
 */
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@Injectable()
export class TelemetryGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TelemetryGateway.name);

  // Bộ nhớ đệm RAM lưu ánh xạ deviceId -> userId để tránh query DB ở tần số 10Hz
  private readonly deviceOwnerCache = new Map<string, string | null>();
  private readonly lastCacheCheck = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => DeviceService))
    private readonly deviceService: DeviceService,
  ) {}

  async handleConnection(client: Socket) {
    const rawToken =
      (client.handshake?.auth?.token as string) ||
      (client.handshake?.query?.token as string) ||
      (client.handshake?.headers?.authorization as string) ||
      (client.handshake?.headers?.['x-token'] as string);

    let token = rawToken;
    if (token && token.startsWith('Bearer ')) {
      token = token.substring(7);
    }

    if (!token) {
      this.logger.warn(`Client WebSocket [${client.id}] kết nối không kèm token xác thực.`);
      // Không cho client tham gia bất kỳ phòng broadcast nào
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      client.data = client.data || {};
      client.data.user = payload;

      if (payload.role === 'ADMIN') {
        client.join('admin');
        client.join('all');
        this.logger.log(`👑 [ADMIN] Client ${client.id} (${payload.email}) đã tham gia phòng 'admin' / 'all'`);
      } else {
        const userRoom = `user:${payload.sub}`;
        client.join(userRoom);
        this.logger.log(`👤 [PILOT] Client ${client.id} (${payload.email}) đã tham gia phòng cá nhân '${userRoom}'`);
      }
    } catch (err) {
      this.logger.warn(`Client WebSocket [${client.id}] token không hợp lệ: ${err.message}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client WebSocket ngắt kết nối: ${client.id}`);
  }

  /**
   * Cập nhật bộ nhớ đệm chủ sở hữu của Drone khi có thao tác Claim hoặc thay đổi quyền
   */
  setDeviceOwnerCache(deviceId: string, userId: string | null) {
    this.deviceOwnerCache.set(deviceId, userId);
    this.lastCacheCheck.set(deviceId, Date.now());
  }

  /**
   * Client gửi yêu cầu theo dõi riêng 1 Drone cụ thể
   */
  @SubscribeMessage('subscribe:drone')
  async handleSubscribeDrone(@ConnectedSocket() client: Socket, @MessageBody() data: { deviceId: string }) {
    if (!data?.deviceId) return;

    const user = client.data?.user;
    if (!user) {
      return { status: 'error', message: 'Yêu cầu đăng nhập trước khi theo dõi Drone' };
    }

    // Nếu là PILOT -> Kiểm tra quyền sở hữu Drone
    if (user.role !== 'ADMIN') {
      const device = await this.deviceService.findByDeviceId(data.deviceId);
      if (!device || device.userId !== user.sub) {
        return { status: 'error', message: `Quyền truy cập bị từ chối: Bạn không sở hữu Drone [${data.deviceId}]` };
      }
    }

    const room = `drone:${data.deviceId}`;
    client.join(room);
    this.logger.debug(`Client ${client.id} (${user.email}) đã theo dõi phòng ${room}`);
    return { status: 'subscribed', room };
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
   * Client đăng ký theo dõi toàn bộ phi đội Drone (Chỉ dành cho ADMIN)
   */
  @SubscribeMessage('subscribe:all')
  handleSubscribeAll(@ConnectedSocket() client: Socket) {
    const user = client.data?.user;
    if (user && user.role === 'ADMIN') {
      client.join('admin');
      client.join('all');
      return { status: 'subscribed', room: 'admin' };
    }
    return { status: 'error', message: 'Chỉ Quản trị viên (ADMIN) mới có quyền theo dõi toàn bộ phi đội' };
  }

  /**
   * Phát dữ liệu Telemetry mới nhất tới các client có thẩm quyền:
   *  1. Phòng riêng của Drone: `drone:<deviceId>`
   *  2. Phòng Quản trị viên: `admin` và `all`
   *  3. Phòng cá nhân của Phi công sở hữu Drone: `user:<ownerId>`
   */
  async broadcastTelemetry(telemetryData: any) {
    if (!this.server || !telemetryData?.deviceId) return;

    const deviceId = telemetryData.deviceId;
    const deviceRoom = `drone:${deviceId}`;

    // 1. Gửi tới phòng riêng của Drone đó
    this.server.to(deviceRoom).emit('telemetry:update', telemetryData);

    // 2. Gửi tới tất cả Quản trị viên ADMIN
    this.server.to('admin').emit('telemetry:update', telemetryData);

    // 3. Tra cứu chủ sở hữu (userId) từ RAM cache hoặc DB
    let ownerId = this.deviceOwnerCache.get(deviceId);
    const now = Date.now();
    const lastCheck = this.lastCacheCheck.get(deviceId) || 0;

    // Nếu chưa có cache hoặc cache là null và đã quá 5 giây -> truy vấn DB nạp cache
    if (ownerId === undefined || (ownerId === null && now - lastCheck > 5000)) {
      this.lastCacheCheck.set(deviceId, now);
      this.deviceService.findByDeviceId(deviceId).then((dev) => {
        const userId = dev?.userId || null;
        this.deviceOwnerCache.set(deviceId, userId);
        if (userId) {
          this.server.to(`user:${userId}`).emit('telemetry:update', telemetryData);
        }
      }).catch(() => {});
    } else if (ownerId) {
      // 4. Bắn tới phòng cá nhân của Phi công sở hữu Drone
      this.server.to(`user:${ownerId}`).emit('telemetry:update', telemetryData);
    }
  }
}
