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
import { RedisService } from '../redis/redis.service';

/**
 * ==============================================================================
 * TELEMETRY WEBSOCKET GATEWAY (SOCKET.IO)
 * ==============================================================================
 * Quản lý toàn bộ kết nối WebSocket thời gian thực giữa trình duyệt Web Dashboard và Backend:
 * 
 * 1. [Phân quyền Phòng (Rooms)]:
 *    - Phòng 'admin' / 'all': Dành cho Super Admin (nhận telemetry của tất cả Drone).
 *    - Phòng 'user:<userId>': Dành cho Phi công (nhận telemetry Lite 1Hz của các Drone trong tiểu đội).
 *    - Phòng 'drone:<deviceId>': Dành cho Client đang Focus xem chi tiết 1 Drone (nhận telemetry Full 10Hz).
 * 
 * 2. [Điều khiển Tần số Phát Go Ingestion (`drone:focus_set`)]:
 *    - Khi client gửi sự kiện `subscribe:drone` $\rightarrow$ Thêm ID vào `drone:focus_set` trong Redis $\rightarrow$ Go phát 10Hz Full.
 *    - Khi client gửi `unsubscribe:drone` hoặc ngắt kết nối $\rightarrow$ Xóa khỏi `drone:focus_set` $\rightarrow$ Go hạ xuống 1Hz Lite.
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

  // Bộ nhớ đệm RAM lưu ánh xạ deviceId -> userId để phân quyền nhanh mà không cần query DB ở tần số 10Hz
  private readonly deviceOwnerCache = new Map<string, string | null>();
  private readonly lastCacheCheck = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => DeviceService))
    private readonly deviceService: DeviceService,
  ) {}

  /**
   * ============================================================================
   * 1. XỬ LÝ KHI CLIENT KẾT NỐI VÀO WEBSOCKET (HANDSHAKE & AUTH)
   * ============================================================================
   */
  async handleConnection(client: Socket) {
    // 1. Trích xuất JWT Token từ nhiều nguồn (Auth payload, Query param, Header)
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
      return;
    }

    try {
      // 2. Giải mã và kiểm tra tính hợp lệ của JWT Token
      const payload = this.jwtService.verify(token);
      client.data = client.data || {};
      client.data.user = payload;
      client.data.focusedDrones = new Set<string>(); // Lưu danh sách Drone mà Socket này đang Focus

      // 3. Phân chia phòng theo quyền hạn người dùng (Server-Side Room Isolation):
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

  /**
   * ============================================================================
   * 2. XỬ LÝ KHI CLIENT NGẮT KẾT NỐI (CLEANUP VÀ HỦY FOCUS)
   * ============================================================================
   */
  async handleDisconnect(client: Socket) {
    this.logger.log(`Client WebSocket ngắt kết nối: ${client.id}`);

    // Dọn dẹp danh sách Focus Drones mà client này đang theo dõi
    const focusedDrones: Set<string> = client.data?.focusedDrones;
    if (focusedDrones && focusedDrones.size > 0) {
      for (const devId of focusedDrones) {
        const room = `drone:${devId}`;
        const remainingClients = this.server?.sockets?.adapter?.rooms?.get(room)?.size || 0;
        
        // Nếu không còn client nào khác trong phòng này -> Xóa khỏi Redis Set `drone:focus_set`
        if (remainingClients <= 1) {
          await this.redisService.removeFocusDrone(devId);
        }
      }
    }
  }

  /**
   * Cập nhật bộ nhớ đệm chủ sở hữu của Drone khi có thao tác Claim hoặc đổi quyền
   */
  setDeviceOwnerCache(deviceId: string, userId: string | null) {
    this.deviceOwnerCache.set(deviceId, userId);
    this.lastCacheCheck.set(deviceId, Date.now());
  }

  /**
   * ============================================================================
   * 3. SỰ KIỆN: CLIENT WEB DASHBOARD YÊU CẦU FOCUS VÀO 1 DRONE CỤ THỂ
   * ============================================================================
   * Client emit('subscribe:drone', { deviceId: 'DRONE-001' })
   *  -> Cho client vào phòng `drone:DRONE-001`
   *  -> Gọi Redis SADD `drone:focus_set` để Go Ingestion kích hoạt luồng 10Hz Full
   */
  @SubscribeMessage('subscribe:drone')
  async handleSubscribeDrone(@ConnectedSocket() client: Socket, @MessageBody() data: { deviceId: string }) {
    if (!data?.deviceId) return;

    const user = client.data?.user;
    if (!user) {
      return { status: 'error', message: 'Yêu cầu đăng nhập trước khi theo dõi Drone' };
    }

    // Nếu là PILOT -> Kiểm tra quyền sở hữu Drone (chỉ được Focus Drone của mình)
    if (user.role !== 'ADMIN') {
      const device = await this.deviceService.findByDeviceId(data.deviceId);
      if (!device || device.userId !== user.sub) {
        return { status: 'error', message: `Quyền truy cập bị từ chối: Bạn không sở hữu Drone [${data.deviceId}]` };
      }
    }

    // Tham gia phòng Socket.IO
    const room = `drone:${data.deviceId}`;
    client.join(room);
    if (!client.data.focusedDrones) {
      client.data.focusedDrones = new Set<string>();
    }
    client.data.focusedDrones.add(data.deviceId);

    // Kích hoạt Focus trong Redis Set `drone:focus_set`
    await this.redisService.addFocusDrone(data.deviceId);

    this.logger.debug(`🎯 Client ${client.id} (${user.email}) đã Focus vào phòng ${room}`);
    return { status: 'subscribed', room };
  }

  /**
   * ============================================================================
   * 4. SỰ KIỆN: CLIENT WEB DASHBOARD HỦY FOCUS 1 DRONE CỤ THỂ
   * ============================================================================
   * Client emit('unsubscribe:drone', { deviceId: 'DRONE-001' })
   *  -> Rời khỏi phòng `drone:DRONE-001`
   *  -> Nếu không còn ai xem phòng này, tự động xóa khỏi `drone:focus_set`
   */
  @SubscribeMessage('unsubscribe:drone')
  async handleUnsubscribeDrone(@ConnectedSocket() client: Socket, @MessageBody() data: { deviceId: string }) {
    if (data?.deviceId) {
      const room = `drone:${data.deviceId}`;
      client.leave(room);
      if (client.data?.focusedDrones) {
        client.data.focusedDrones.delete(data.deviceId);
      }

      // Kiểm tra nếu phòng này không còn ai xem -> Xóa khỏi Focus Set để Go hạ về 1Hz Lite
      const remainingClients = this.server?.sockets?.adapter?.rooms?.get(room)?.size || 0;
      if (remainingClients === 0) {
        await this.redisService.removeFocusDrone(data.deviceId);
      }

      this.logger.debug(`⚪ Client ${client.id} đã rời phòng Focus ${room}`);
      return { status: 'unsubscribed', room };
    }
  }

  /**
   * ============================================================================
   * 5. SỰ KIỆN: ĐĂNG KÝ THEO DÕI TOÀN BỘ PHI ĐỘI
   * ============================================================================
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
   * ============================================================================
   * 6. PHÁT DỮ LIỆU ĐO XA TỚI CÁC PHÒNG SOCKET.IO THÍCH HỢP
   * ============================================================================
   * Được gọi từ `TelemetryService.startRedisSubscription()` mỗi khi có tin nhắn từ Redis.
   */
  async broadcastTelemetry(telemetryData: any) {
    if (!this.server || !telemetryData?.deviceId) return;

    const deviceId = telemetryData.deviceId;
    const deviceRoom = `drone:${deviceId}`;

    // 1. Gửi tới phòng riêng của Drone đó (Dành cho Dashboard đang Focus lái con này: 10Hz Full)
    this.server.to(deviceRoom).emit('telemetry:update', telemetryData);

    // 2. Gửi tới phòng Quản trị viên (Super Admin xem toàn cảnh hệ thống)
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
      // 4. Bắn tới phòng cá nhân của Phi công sở hữu Drone (để cập nhật vị trí tiểu đội trên bản đồ)
      this.server.to(`user:${ownerId}`).emit('telemetry:update', telemetryData);
    }
  }
}
