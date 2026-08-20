import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { TelemetryGateway } from './telemetry.gateway';
import { DeviceService } from '../device/device.service';

/**
 * TelemetryService chịu trách nhiệm:
 * 1. Đăng ký nhận luồng sự kiện Telemetry từ Redis Pub/Sub (kênh `channel:drone:telemetry:all`).
 * 2. Chuyển tiếp ngay lập tức tới TelemetryGateway để đẩy xuống Web Dashboard.
 * 3. Duy trì bộ nhớ đệm RAM và cung cấp REST API truy vấn snapshot trạng thái.
 */
@Injectable()
export class TelemetryService implements OnModuleInit {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly inMemoryCache = new Map<string, any>();

  constructor(
    private readonly redisService: RedisService,
    private readonly telemetryGateway: TelemetryGateway,
    private readonly deviceService: DeviceService,
  ) {}

  async onModuleInit() {
    this.startRedisSubscription();
  }

  /**
   * Khởi động tiến trình lắng nghe Redis Pub/Sub
   */
  private startRedisSubscription() {
    const subscriber = this.redisService.getSubscriber();
    if (!subscriber) {
      this.logger.warn('Redis subscriber chưa sẵn sàng. Luồng Telemetry Pub/Sub sẽ tạm hoãn.');
      return;
    }

    const channelName = 'channel:drone:telemetry:all';
    subscriber.subscribe(channelName, (err) => {
      if (err) {
        this.logger.error(`Không thể subscribe kênh Redis ${channelName}: ${err.message}`);
      } else {
        this.logger.log(`Đã subscribe thành công kênh Telemetry Pub/Sub: ${channelName}`);
      }
    });

    subscriber.on('message', (channel, messageStr) => {
      if (channel === channelName) {
        try {
          const telemetryData = JSON.parse(messageStr);
          if (telemetryData?.deviceId) {
            // Cập nhật bộ nhớ đệm RAM cục bộ
            this.inMemoryCache.set(telemetryData.deviceId, telemetryData);

            // Phát sự kiện ra toàn bộ client Web đang kết nối WebSocket
            this.telemetryGateway.broadcastTelemetry(telemetryData);
          }
        } catch (error) {
          this.logger.debug(`Lỗi khi parse message Telemetry từ Redis: ${error.message}`);
        }
      }
    });
  }

  /**
   * Lấy snapshot trạng thái tức thời của toàn bộ Drone trong hệ thống
   */
  async getAllFleetStates() {
    // 1. Lấy danh sách thiết bị từ DB
    const devices = await this.deviceService.findAllDevices();

    // 2. Lấy dữ liệu Telemetry từ Redis
    const redisStates = await this.redisService.getAllTelemetryStates();

    // 3. Kết hợp thông tin cấu hình DB và thông số bay thực tế
    return devices.map((dev) => {
      const telemetry = redisStates[dev.deviceId] || this.inMemoryCache.get(dev.deviceId) || null;

      return {
        id: dev.id,
        deviceId: dev.deviceId,
        hardwareModel: dev.hardwareModel,
        vpnIp: dev.vpnIp,
        status: dev.status,
        lastSeen: dev.lastSeen,
        telemetry: telemetry || {
          connected: false,
          armed: false,
          flightMode: 'UNKNOWN',
          battery: { percentage: 0, voltageMv: 0, currentCa: 0 },
          gps: { lat: 0, lon: 0, altRelativeM: 0, headingDeg: 0, groundSpeedMs: 0 },
          attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
        },
      };
    });
  }

  /**
   * Lấy snapshot trạng thái tức thời của một Drone cụ thể
   */
  async getDeviceState(deviceId: string) {
    const device = await this.deviceService.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException(`Không tìm thấy Drone có mã định danh: ${deviceId}`);
    }

    const telemetry =
      (await this.redisService.getDeviceTelemetryState(deviceId)) ||
      this.inMemoryCache.get(deviceId) || {
        connected: false,
        armed: false,
        flightMode: 'UNKNOWN',
        battery: { percentage: 0, voltageMv: 0, currentCa: 0 },
        gps: { lat: 0, lon: 0, altRelativeM: 0, headingDeg: 0, groundSpeedMs: 0 },
        attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
      };

    return {
      id: device.id,
      deviceId: device.deviceId,
      hardwareModel: device.hardwareModel,
      vpnIp: device.vpnIp,
      status: device.status,
      lastSeen: device.lastSeen,
      telemetry,
    };
  }
}
