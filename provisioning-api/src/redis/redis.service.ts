import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * RedisService chịu trách nhiệm quản lý kết nối tới Redis Server,
 * cung cấp 2 client riêng biệt: Client truy vấn dữ liệu thông thường và Client chuyên Subscribe sự kiện Pub/Sub.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

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

      this.client.on('error', (err) => {
        this.logger.warn(`Lỗi kết nối Redis (${redisHost}:${redisPort}): ${err.message}`);
      });

      this.subscriber.on('error', (err) => {
        this.logger.warn(`Lỗi kết nối Redis Subscriber: ${err.message}`);
      });

      await this.client.connect().catch((err) => {
        this.logger.warn(`Không thể kết nối ngay tới Redis: ${err.message}. Dịch vụ sẽ tự động thử lại.`);
      });

      await this.subscriber.connect().catch(() => {});
    } catch (error) {
      this.logger.warn(`Khởi tạo Redis client gặp lỗi: ${error.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => {});
    }
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => {});
    }
    this.logger.log('Đã đóng toàn bộ kết nối Redis.');
  }

  /**
   * Lấy Redis Client thông thường phục vụ các tác vụ CRUD, HSet, HGet
   */
  getClient(): Redis | null {
    return this.client;
  }

  /**
   * Lấy Redis Client chuyên dụng dành riêng cho Pub/Sub Subscribe
   */
  getSubscriber(): Redis | null {
    return this.subscriber;
  }

  /**
   * Đồng bộ một cặp ánh xạ IP -> DeviceID vào bảng băm `drone:ip_map`
   */
  async mapIpToDevice(vpnIp: string, deviceId: string): Promise<void> {
    if (!this.client || !vpnIp || !deviceId) return;
    try {
      await this.client.hset('drone:ip_map', vpnIp, deviceId);
      this.logger.debug(`Đã đồng bộ ánh xạ IP ${vpnIp} -> ${deviceId} vào Redis`);
    } catch (error) {
      this.logger.warn(`Không thể ghi ánh xạ IP vào Redis: ${error.message}`);
    }
  }

  /**
   * Xóa ánh xạ IP khi Drone bị thu hồi hoặc giải phóng IP
   */
  async removeIpMapping(vpnIp: string): Promise<void> {
    if (!this.client || !vpnIp) return;
    try {
      await this.client.hdel('drone:ip_map', vpnIp);
    } catch (error) {
      this.logger.warn(`Không thể xóa ánh xạ IP khỏi Redis: ${error.message}`);
    }
  }

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
      this.logger.warn(`Lỗi khi đọc trạng thái Telemetry từ Redis: ${error.message}`);
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
      this.logger.warn(`Lỗi khi đọc trạng thái Drone ${deviceId} từ Redis: ${error.message}`);
      return null;
    }
  }
}
