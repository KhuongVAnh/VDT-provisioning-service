import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * ==============================================================================
 * REDIS SERVICE (QUẢN LÝ KẾT NỐI VÀ CẤU TRÚC DỮ LIỆU REDIS BACKBONE)
 * ==============================================================================
 * Cung cấp 2 kết nối riêng biệt:
 *  1. [Command Client (`client`)]: Phục vụ đọc/ghi dữ liệu thông thường (HGETALL, HSET, SADD, ZRANGE).
 *  2. [Subscriber Client (`subscriber`)]: Chuyên dụng chỉ để lắng nghe sự kiện thời gian thực Pub/Sub.
 * 
 * Quản lý các cấu trúc dữ liệu cốt lõi:
 *  - `drone:ip_map`: Ánh xạ IP WireGuard (10.13.37.X) -> deviceId.
 *  - `drone:states`: Snapshot trạng thái toàn bộ phi đội.
 *  - `drone:focus_set`: Danh sách Drone đang được Focus lái tay (để Go Ingest phát 10Hz).
 *  - `drone:heartbeats`: Sorted Set quản lý trạng thái Liveness Online/Offline trong nano-giây.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) { }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async onModuleInit() {
    const redisHost = this.configService.get<string>('REDIS_HOST', '127.0.0.1');
    const redisPort = Number(this.configService.get<number>('REDIS_PORT', 6380));
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD', '');
    const redisDb = Number(this.configService.get<number>('REDIS_DB', 0));

    const redisOptions = {
      host: redisHost,
      port: redisPort,
      password: redisPassword || undefined,
      db: redisDb,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 500, 3000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    };

    try {
      this.client = new Redis(redisOptions);
      this.subscriber = new Redis(redisOptions);

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log(`Kết nối thành công tới Redis Server tại ${redisHost}:${redisPort}`);
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        this.logger.log(`Redis Server đã sẵn sàng nhận lệnh tại ${redisHost}:${redisPort}`);
      });

      this.client.on('close', () => {
        this.isConnected = false;
        this.logger.warn(`Kết nối tới Redis Server (${redisHost}:${redisPort}) đã bị đóng.`);
      });

      this.client.on('reconnecting', () => {
        this.isConnected = false;
        this.logger.log(`Đang thử kết nối lại tới Redis Server (${redisHost}:${redisPort})...`);
      });

      this.client.on('end', () => {
        this.isConnected = false;
        this.logger.warn(`Đã dừng kết nối tới Redis Server (${redisHost}:${redisPort}).`);
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        this.logger.warn(`Lỗi kết nối Redis (${redisHost}:${redisPort}): ${this.getErrorMessage(err)}`);
      });

      this.subscriber.on('error', (err) => {
        this.logger.warn(`Lỗi kết nối Redis Subscriber: ${this.getErrorMessage(err)}`);
      });

      await this.client.connect().catch((err) => {
        this.isConnected = false;
        this.logger.warn(`Không thể kết nối ngay tới Redis: ${this.getErrorMessage(err)}. Dịch vụ sẽ tự động thử lại.`);
      });

      await this.subscriber.connect().catch(() => { });
    } catch (error) {
      this.isConnected = false;
      this.logger.warn(`Khởi tạo Redis client gặp lỗi: ${this.getErrorMessage(error)}`);
    }
  }

  async onModuleDestroy() {
    this.isConnected = false;
    if (this.client) {
      await this.client.quit().catch(() => { });
    }
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => { });
    }
    this.logger.log('Đã đóng toàn bộ kết nối Redis.');
  }

  /**
   * Kiểm tra trạng thái kết nối hiện tại tới Redis
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Kiểm tra xem Redis có sẵn sàng xử lý yêu cầu hay không
   */
  isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Lấy Redis Client thông thường phục vụ các tác vụ CRUD, HSet, HGet, SAdd, ZRange
   */
  getClient(): Redis | null {
    return this.client;
  }

  /**
   * Lấy Redis Client chuyên dụng dành riêng cho Pub/Sub Subscribe (Không dùng để chạy lệnh CRUD)
   */
  getSubscriber(): Redis | null {
    return this.subscriber;
  }

  // ==============================================================================
  // 1. QUẢN LÝ ÁNH XẠ IP WIREGUARD (BẢNG BĂM `drone:ip_map`)
  // ==============================================================================

  /**
   * Đồng bộ một cặp ánh xạ IP -> DeviceID vào bảng băm `drone:ip_map`
   */
  async mapIpToDevice(vpnIp: string, deviceId: string): Promise<void> {
    if (!this.client || !vpnIp || !deviceId) return;
    try {
      await this.client.hset('drone:ip_map', vpnIp, deviceId);
      this.logger.debug(`Đã đồng bộ ánh xạ IP ${vpnIp} -> ${deviceId} vào Redis`);
    } catch (error) {
      this.logger.warn(`Không thể ghi ánh xạ IP vào Redis: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Xóa một ánh xạ IP khỏi bảng băm `drone:ip_map` khi Drone bị thu hồi hoặc đổi IP
   */
  async unmapIp(vpnIp: string): Promise<void> {
    if (!this.client || !vpnIp) return;
    try {
      await this.client.hdel('drone:ip_map', vpnIp);
      this.logger.debug(`Đã xóa ánh xạ IP ${vpnIp} khỏi Redis`);
    } catch (error) {
      this.logger.warn(`Không thể xóa ánh xạ IP khỏi Redis: ${this.getErrorMessage(error)}`);
    }
  }

  // ==============================================================================
  // 2. TRUY VẤN DỮ LIỆU TELEMETRY (BẢNG BĂM `drone:states`)
  // ==============================================================================

  /**
   * Lấy toàn bộ trạng thái tức thời của phi đội từ bảng băm `drone:states`
   */
  async getAllTelemetryStates(): Promise<Record<string, any>> {
    if (!this.client) return {};
    try {
      const rawMap = await this.client.hgetall('drone:states');
      const parsed: Record<string, any> = {};
      for (const [devId, jsonStr] of Object.entries(rawMap)) {
        try {
          parsed[devId] = JSON.parse(jsonStr);
        } catch {
          // Bỏ qua nếu lỗi parse JSON
        }
      }
      return parsed;
    } catch (error) {
      this.logger.warn(`Lỗi khi đọc trạng thái Telemetry từ Redis: ${this.getErrorMessage(error)}`);
      return {};
    }
  }

  /**
   * Lấy trạng thái tức thời của một Drone cụ thể
   */
  async getDeviceTelemetryState(deviceId: string): Promise<any | null> {
    if (!this.client || !deviceId) return null;
    try {
      const jsonStr = await this.client.hget('drone:states', deviceId);
      if (!jsonStr) return null;
      return JSON.parse(jsonStr);
    } catch (error) {
      this.logger.warn(`Lỗi khi đọc trạng thái Drone ${deviceId} từ Redis: ${this.getErrorMessage(error)}`);
      return null;
    }
  }

  // ==============================================================================
  // 3. QUẢN LÝ DANH SÁCH FOCUS TẬP TRUNG (REDIS SET `drone:focus_set`)
  // ==============================================================================

  /**
   * Thêm một Drone vào danh sách Focus (để Go Ingestion kích hoạt luồng phát 10Hz Full)
   */
  async addFocusDrone(deviceId: string): Promise<void> {
    if (!this.client || !deviceId) return;
    try {
      await this.client.sadd('drone:focus_set', deviceId);
      this.logger.debug(`🎯 [FOCUS SET] Đã thêm [${deviceId}] vào drone:focus_set`);
    } catch (error) {
      this.logger.warn(`Lỗi khi thêm ${deviceId} vào drone:focus_set: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Xóa một Drone khỏi danh sách Focus (khi không còn Pilot/GCS nào theo dõi để Go hạ về 1Hz Lite)
   */
  async removeFocusDrone(deviceId: string): Promise<void> {
    if (!this.client || !deviceId) return;
    try {
      await this.client.srem('drone:focus_set', deviceId);
      this.logger.debug(`⚪ [FOCUS SET] Đã xóa [${deviceId}] khỏi drone:focus_set`);
    } catch (error) {
      this.logger.warn(`Lỗi khi xóa ${deviceId} khỏi drone:focus_set: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Lấy danh sách toàn bộ Drone đang được Focus
   */
  async getFocusDrones(): Promise<string[]> {
    if (!this.client) return [];
    try {
      return await this.client.smembers('drone:focus_set');
    } catch (error) {
      this.logger.warn(`Lỗi khi đọc drone:focus_set: ${this.getErrorMessage(error)}`);
      return [];
    }
  }

  // ==============================================================================
  // 4. QUẢN LÝ NHỊP TIM LIVENESS TỐC ĐỘ CAO (REDIS ZSET `drone:heartbeats`)
  // ==============================================================================

  /**
   * Lọc danh sách các Drone đang ONLINE trong khoảng thời gian `withinSeconds` (mặc định 10s).
   * Sử dụng lệnh ZRANGEBYSCORE trong O(log(N) + M) nano-giây, không cần tải/parse chuỗi JSON.
   */
  async getOnlineDeviceIds(withinSeconds: number = 10): Promise<string[]> {
    if (!this.client) return [];
    try {
      const minScore = Math.floor(Date.now() / 1000) - withinSeconds;
      return await this.client.zrangebyscore('drone:heartbeats', minScore, '+inf');
    } catch (error) {
      this.logger.warn(
        `Lỗi khi truy vấn drone:heartbeats: ${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  /**
   * Đếm nhanh số lượng Drone đang bay tức thời
   */
  async getHeartbeatOnlineCount(withinSeconds: number = 10): Promise<number> {
    if (!this.client) return 0;
    try {
      const minScore = Math.floor(Date.now() / 1000) - withinSeconds;
      return await this.client.zcount('drone:heartbeats', minScore, '+inf');
    } catch (error) {
      this.logger.warn(
        `Lỗi khi đếm số lượng heartbeat: ${this.getErrorMessage(error)}`,
      );
      return 0;
    }
  }
}
