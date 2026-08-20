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

    subscriber.on('message', async (channel, messageStr) => {
      if (channel === channelName) {
        try {
          const telemetryData = JSON.parse(messageStr);
          if (telemetryData?.deviceId) {
            // Cập nhật bộ nhớ đệm RAM cục bộ
            this.inMemoryCache.set(telemetryData.deviceId, telemetryData);

            // Phát sự kiện ra toàn bộ client Web đang kết nối WebSocket
            this.telemetryGateway.broadcastTelemetry(telemetryData);

            // Tự động ghi danh vào Database nếu Drone chưa có bản ghi (ví dụ drone cấu hình thủ công)
            const detectedIp = telemetryData.vpnIp || (telemetryData.deviceId.startsWith('DRONE-IP-') ? telemetryData.deviceId.replace('DRONE-IP-', '').replace(/-/g, '.') : '');
            if (detectedIp && /^10\.13\.37\.\d+$/.test(detectedIp)) {
              this.deviceService.findOrCreateManualDevice(
                telemetryData.deviceId,
                detectedIp,
                'MANUAL_TELEMETRY',
                'Manual / Discovered Drone',
              ).catch(() => {});
            }
          }
        } catch (error) {
          this.logger.debug(`Lỗi khi parse message Telemetry từ Redis: ${error.message}`);
        }
      }
    });
  }

  /**
   * Lấy snapshot trạng thái tức thời của toàn bộ Drone trong hệ thống
   * Kết hợp cả Drone trong Database và Drone đang truyền dữ liệu thời gian thực (Redis/Simulator)
   */
  async getAllFleetStates() {
    // 1. Lấy danh sách thiết bị từ Database
    const devices = await this.deviceService.findAllDevices();
    const deviceMap = new Map<string, any>();

    for (const dev of devices) {
      deviceMap.set(dev.deviceId, {
        id: dev.id,
        deviceId: dev.deviceId,
        hardwareModel: dev.hardwareModel,
        vpnIp: dev.vpnIp,
        status: dev.status,
        lastSeen: dev.lastSeen,
        telemetry: null,
      });
    }

    // 2. Lấy dữ liệu Telemetry từ Redis và RAM Cache
    const redisStates = await this.redisService.getAllTelemetryStates();
    const allActiveDeviceIds = new Set([
      ...Object.keys(redisStates),
      ...Array.from(this.inMemoryCache.keys()),
    ]);

    // 3. Tra cứu bảng ánh xạ IP -> DeviceID từ Redis để điền IP cho các Drone đang bay
    let ipMap: Record<string, string> = {};
    try {
      ipMap = (await this.redisService.getClient()?.hgetall('drone:ip_map')) || {};
    } catch {
      // Bỏ qua nếu lỗi Redis
    }
    const deviceToIpMap: Record<string, string> = {};
    for (const [ip, dId] of Object.entries(ipMap)) {
      deviceToIpMap[dId] = ip;
    }

    // 4. Bổ sung các Drone đang phát sóng thực tế (kể cả Drone chưa đăng ký DB hoặc Drone ảo Simulator)
    for (const devId of allActiveDeviceIds) {
      const telemetry = redisStates[devId] || this.inMemoryCache.get(devId);
      const detectedIp = deviceToIpMap[devId] || (devId.startsWith('DRONE-IP-') ? devId.replace('DRONE-IP-', '').replace(/-/g, '.') : '');

      if (!deviceMap.has(devId)) {
        deviceMap.set(devId, {
          id: devId,
          deviceId: devId,
          hardwareModel: 'Real-time Telemetry Stream',
          vpnIp: detectedIp || '10.13.37.X',
          status: 'ACTIVE',
          lastSeen: new Date(),
          telemetry: telemetry || null,
        });
      } else {
        const item = deviceMap.get(devId);
        item.telemetry = telemetry;
        if (!item.vpnIp && detectedIp) {
          item.vpnIp = detectedIp;
        }
      }
    }

    // 5. Chuẩn hóa dữ liệu trả về
    return Array.from(deviceMap.values()).map((dev) => {
      if (!dev.telemetry) {
        dev.telemetry = {
          connected: false,
          armed: false,
          flightMode: 'UNKNOWN',
          battery: { percentage: 0, voltageMv: 0, currentCa: 0 },
          gps: { lat: 0, lon: 0, altRelativeM: 0, headingDeg: 0, groundSpeedMs: 0 },
          attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
        };
      }
      return dev;
    });
  }

  /**
   * Lấy snapshot trạng thái tức thời của một Drone cụ thể
   */
  async getDeviceState(deviceId: string) {
    const device = await this.deviceService.findByDeviceId(deviceId);

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

    if (!device) {
      // Nếu không có trong DB nhưng đang có luồng Telemetry
      if (this.inMemoryCache.has(deviceId)) {
        return {
          id: deviceId,
          deviceId,
          hardwareModel: 'Real-time Stream',
          vpnIp: '10.13.37.X',
          status: 'ACTIVE',
          lastSeen: new Date(),
          telemetry,
        };
      }
      throw new NotFoundException(`Không tìm thấy Drone có mã định danh: ${deviceId}`);
    }

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
