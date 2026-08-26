import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { TelemetryGateway } from './telemetry.gateway';
import { DeviceService } from '../device/device.service';

/** Cấu trúc mặc định khi Drone chưa có dữ liệu đo xa hoặc vừa mới khởi tạo */
const DEFAULT_TELEMETRY = {
  connected: false,
  armed: false,
  flightMode: 'UNKNOWN',
  battery: { percentage: 0, voltageMv: 0, currentCa: 0 },
  gps: { lat: 0, lon: 0, altRelativeM: 0, headingDeg: 0, groundSpeedMs: 0 },
  attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
};

/**
 * ==============================================================================
 * TELEMETRY SERVICE (TRUNG TÂM XỬ LÝ DỮ LIỆU ĐO XA VÀ BỘ NHỚ ĐỆM L1)
 * ==============================================================================
 * Nhiệm vụ chính:
 *  1. [Redis Pub/Sub Subscriber]: Lắng nghe luồng sự kiện bay thời gian thực từ Go Ingestion
 *     qua các kênh `channel:drone:telemetry:*` (Full 10Hz và Lite 1Hz).
 *  2. [L1 In-Memory Cache 0ms]: Lưu trạng thái bay mới nhất của từng Drone trong RAM (`inMemoryCache`).
 *  3. [Chuyển tiếp Realtime]: Gọi `telemetryGateway.broadcastTelemetry()` để bắn dữ liệu xuống WebSocket Rooms.
 *  4. [Chống Cache Stampede]: Sử dụng L1 RAM Cache (TTL 500ms) kết hợp SingleFlight Mutex Promise để phục vụ
 *     REST API `getAllFleetStates()`, giúp 99.9% request đọc trực tiếp từ RAM trong 0ms.
 */
@Injectable()
export class TelemetryService implements OnModuleInit {
  private readonly logger = new Logger(TelemetryService.name);
  
  // ----------------------------------------------------------------------------
  // Bộ nhớ đệm RAM L1 lưu snapshot trạng thái mới nhất của từng Drone (0ms lookup)
  // ----------------------------------------------------------------------------
  private readonly inMemoryCache = new Map<string, any>(); // Key: deviceId -> Value: TelemetryPayload
  private readonly autoDiscoveredDevices = new Set<string>(); // Danh sách Drone đã tự động ghi danh vào DB
  private readonly subnet: string;

  // ----------------------------------------------------------------------------
  // Bộ nhớ đệm RAM L1 & SingleFlight Mutex cho REST API `getAllFleetStates()`
  // ----------------------------------------------------------------------------
  private lastFleetCacheTime = 0;              // Thời điểm cập nhật cache phi đội gần nhất (Unix ms)
  private cachedAllFleetDevices: any[] = [];   // Danh sách toàn bộ thiết bị đã nạp vào RAM
  private fleetSingleFlightPromise: Promise<any[]> | null = null; // Mutex Promise chống truy vấn trùng lặp

  constructor(
    private readonly redisService: RedisService,
    private readonly telemetryGateway: TelemetryGateway,
    private readonly deviceService: DeviceService,
    private readonly configService: ConfigService,
  ) {
    this.subnet = this.configService.get<string>('VPN_SUBNET_PREFIX', '10.13.37.');
  }

  /**
   * Hook khởi động: Tự động đăng ký lắng nghe Redis Pub/Sub khi Module sẵn sàng
   */
  async onModuleInit() {
    this.startRedisSubscription();
  }

  /**
   * ============================================================================
   * 1. TIẾN TRÌNH LẮNG NGHE REDIS PUB/SUB ĐA TẦNG (FULL 10Hz + LITE 1Hz)
   * ============================================================================
   * Đăng ký Pattern `channel:drone:telemetry:*` để nhận:
   *  - `channel:drone:telemetry:full:<id>`: Luồng 10Hz chi tiết của Drone đang Focus.
   *  - `channel:drone:telemetry:lite:<id>`: Luồng 1Hz tóm tắt của Drone nền / tiểu đội.
   */
  private startRedisSubscription() {
    const subscriber = this.redisService.getSubscriber();
    if (!subscriber) {
      this.logger.warn('Redis subscriber chưa sẵn sàng. Luồng Telemetry Pub/Sub sẽ tạm hoãn.');
      return;
    }

    // Đăng ký pattern tất cả các kênh telemetry
    const pattern = 'channel:drone:telemetry:*';
    subscriber.psubscribe(pattern, (err) => {
      if (err) {
        this.logger.error(`Không thể psubscribe kênh Redis ${pattern}: ${err.message}`);
      } else {
        this.logger.log(`✅ Đã psubscribe thành công kênh Telemetry Pub/Sub: ${pattern}`);
      }
    });

    // Lắng nghe sự kiện pmessage (Pattern Message)
    subscriber.on('pmessage', async (_p, channel, messageStr) => {
      try {
        const rawData = JSON.parse(messageStr);
        if (!rawData?.deviceId) return;

        // [Bước A]: Chuẩn hóa dữ liệu nếu nhận từ kênh Lite (Payload rút gọn) sang cấu trúc chuẩn của Dashboard
        const telemetryData = this.normalizeTelemetryPayload(rawData);

        // [Bước B]: Cập nhật bộ nhớ đệm RAM cục bộ của Node.js (0ms)
        this.inMemoryCache.set(telemetryData.deviceId, telemetryData);

        // [Bước C]: Chuyển tiếp tới TelemetryGateway để đẩy xuống WebSocket Rooms (drone:<id>, user:<id>, admin)
        this.telemetryGateway.broadcastTelemetry(telemetryData);

        // [Bước D]: Tự động ghi danh vào Database đúng 1 lần cho mỗi Drone mới (tránh spam DB ở tần số cao)
        if (!this.autoDiscoveredDevices.has(telemetryData.deviceId)) {
          this.autoDiscoveredDevices.add(telemetryData.deviceId);
          const detectedIp = telemetryData.vpnIp || (telemetryData.deviceId.startsWith('DRONE-IP-') ? telemetryData.deviceId.replace('DRONE-IP-', '').replace(/-/g, '.') : '');
          if (detectedIp && (detectedIp.startsWith(this.subnet) || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(detectedIp))) {
            this.deviceService.findOrCreateManualDevice(
              telemetryData.deviceId,
              detectedIp,
              'MANUAL_TELEMETRY',
              'Manual / Discovered Drone',
            ).catch(() => {});
          }
        }
      } catch (error) {
        this.logger.debug(`Lỗi khi parse message Telemetry từ Redis (${channel}): ${error.message}`);
      }
    });
  }

  /**
   * ============================================================================
   * 2. CHUẨN HÓA DỮ LIỆU TELEMETRY (LITE PAYLOAD -> FULL PAYLOAD)
   * ============================================================================
   * Giúp tương thích ngược 100% với giao diện Web Dashboard khi nhận gói tin Lite 1Hz siêu nhẹ (~70B).
   */
  private normalizeTelemetryPayload(raw: any): any {
    // Nếu đã là Full format (đầy đủ các trường GPS, Battery, Attitude)
    if (raw.gps && raw.battery) {
      return raw;
    }

    // Nếu là Lite format (thu gọn): Bổ sung các giá trị mặc định để Frontend không bị lỗi undefined
    return {
      deviceId: raw.deviceId,
      sysid: raw.sysid || 1,
      vpnIp: raw.vpnIp || '',
      connected: raw.connected ?? true,
      armed: raw.armed ?? false,
      flightMode: raw.flightMode || 'UNKNOWN',
      battery: {
        percentage: raw.batteryPct ?? 0,
        voltageMv: raw.voltageMv ?? 0,
        currentCa: 0,
      },
      gps: {
        lat: raw.lat ?? 0,
        lon: raw.lon ?? 0,
        altRelativeM: raw.altRelativeM ?? 0,
        groundSpeedMs: raw.groundSpeedMs ?? 0,
        headingDeg: raw.headingDeg ?? 0,
        fixType: 3,
        satellites: 10,
      },
      attitude: {
        rollDeg: raw.rollDeg ?? 0,
        pitchDeg: raw.pitchDeg ?? 0,
        yawDeg: raw.headingDeg ?? 0,
      },
      timestamp: raw.timestamp || Date.now(),
    };
  }

  /**
   * ============================================================================
   * 3. LẤY SNAPSHOT PHI ĐỘI VỚI L1 CACHE VÀ SINGLEFLIGHT MUTEX (CHỐNG CACHE STAMPEDE)
   * ============================================================================
   * Cơ chế:
   *  1. Kiểm tra L1 Cache trong RAM (< 500ms): Nếu còn tươi, lọc theo User và trả về ngay (0ms).
   *  2. SingleFlight: Nếu có hàng ngàn User cùng F5, tất cả cùng chờ chung đúng 1 Promise duy nhất.
   */
  async getAllFleetStates(user?: any): Promise<any[]> {
    const now = Date.now();

    // 1. Kiểm tra L1 In-Memory Cache còn tươi (< 500ms)
    if (now - this.lastFleetCacheTime < 500 && this.cachedAllFleetDevices.length > 0) {
      return this.filterDevicesForUser(this.cachedAllFleetDevices, user);
    }

    // 2. SingleFlight Mutex: Nếu đang có 1 request fetch dữ liệu, các request khác chờ chung kết quả
    if (!this.fleetSingleFlightPromise) {
      this.fleetSingleFlightPromise = this.fetchRawFleetFromStorage().then((data) => {
        this.cachedAllFleetDevices = data;
        this.lastFleetCacheTime = Date.now();
        this.fleetSingleFlightPromise = null; // Mở khóa Mutex
        return data;
      }).catch((err) => {
        this.fleetSingleFlightPromise = null;
        this.logger.error(`Lỗi khi fetch fleet states: ${err.message}`);
        return this.cachedAllFleetDevices; // Fallback về cache cũ nếu lỗi
      });
    }

    const allDevices = await this.fleetSingleFlightPromise;
    return this.filterDevicesForUser(allDevices, user);
  }

  /**
   * Thực hiện truy vấn thực sự từ Database và Redis (Chỉ chạy tối đa 2 lần/giây bất kể lượng User)
   */
  private async fetchRawFleetFromStorage(): Promise<any[]> {
    // 1. Lấy toàn bộ thiết bị từ Database
    const devices = await this.deviceService.findAllDevices();
    const deviceMap = new Map<string, any>();
    const ipToDeviceMap = new Map<string, any>();

    for (const dev of devices) {
      const entry = {
        id: dev.id,
        deviceId: dev.deviceId,
        hardwareModel: dev.hardwareModel,
        vpnIp: dev.vpnIp,
        status: dev.status,
        lastSeen: dev.lastSeen,
        userId: dev.userId,
        telemetry: null,
      };
      deviceMap.set(dev.deviceId, entry);
      if (dev.vpnIp) ipToDeviceMap.set(dev.vpnIp, entry);
    }

    // 2. Lấy dữ liệu Telemetry từ Redis và RAM Cache
    const redisStates = await this.redisService.getAllTelemetryStates();
    const allActiveDeviceIds = new Set([
      ...Object.keys(redisStates),
      ...Array.from(this.inMemoryCache.keys()),
    ]);

    // 3. Tra cứu bảng ánh xạ IP -> DeviceID và SysID -> DeviceID từ Redis
    let redisIpMap: Record<string, string> = {};
    let redisSysMap: Record<string, string> = {};
    try {
      const client = this.redisService.getClient();
      if (client) {
        [redisIpMap, redisSysMap] = await Promise.all([
          client.hgetall('drone:ip_map').catch(() => ({})),
          client.hgetall('drone:sys_map').catch(() => ({})),
        ]);
      }
    } catch {
      // Bỏ qua nếu lỗi Redis
    }
    const devToIp: Record<string, string> = {};
    for (const [ip, dId] of Object.entries(redisIpMap)) {
      devToIp[dId] = ip;
    }

    // 4. Ghép nối Telemetry vào từng Drone
    for (const devId of allActiveDeviceIds) {
      const rawTelemetry = redisStates[devId] || this.inMemoryCache.get(devId);
      const telemetry = this.normalizeTelemetryPayload(rawTelemetry);
      const mappedDevId = (telemetry?.sysid && redisSysMap[String(telemetry.sysid)]) || devId;
      const detectedIp = telemetry?.vpnIp || devToIp[mappedDevId] || devToIp[devId] || (devId.startsWith('DRONE-IP-') ? devId.replace('DRONE-IP-', '').replace(/-/g, '.') : '');

      let target = deviceMap.get(mappedDevId) || deviceMap.get(devId) || (detectedIp ? ipToDeviceMap.get(detectedIp) : null);
      if (target) {
        target.telemetry = telemetry;
        if (!target.vpnIp && detectedIp) target.vpnIp = detectedIp;
      } else {
        // Drone tự động phát hiện trên mạng WireGuard
        deviceMap.set(mappedDevId, {
          id: mappedDevId,
          deviceId: mappedDevId,
          hardwareModel: 'Real-time Telemetry Stream',
          vpnIp: detectedIp || `${this.subnet}X`,
          status: 'ACTIVE',
          lastSeen: new Date(),
          userId: null,
          telemetry: telemetry || null,
        });
      }
    }

    // 5. Chuẩn hóa dữ liệu trả về và kiểm tra Liveness (Timeout 10s)
    return Array.from(deviceMap.values()).map((dev) => {
      if (!dev.telemetry) {
        dev.telemetry = { ...DEFAULT_TELEMETRY };
      } else if (dev.telemetry.timestamp && Date.now() - dev.telemetry.timestamp > 10000) {
        dev.telemetry.connected = false;
      }
      return dev;
    });
  }

  /**
   * Lọc danh sách thiết bị trả về theo quyền sở hữu của User (ADMIN xem tất cả, PILOT chỉ xem của mình)
   */
  private filterDevicesForUser(allDevices: any[], user?: any): any[] {
    if (!user || user.role === 'ADMIN') {
      return allDevices;
    }
    return allDevices.filter((dev) => dev.userId === user.id);
  }

  /**
   * ============================================================================
   * 4. LẤY SNAPSHOT TRẠNG THÁI CHI TIẾT CỦA 1 DRONE
   * ============================================================================
   */
  async getDeviceState(deviceId: string) {
    const device = await this.deviceService.findByDeviceId(deviceId);

    // Ưu tiên đọc từ RAM inMemoryCache trước, nếu không có mới đọc Redis
    const rawTelemetry =
      this.inMemoryCache.get(deviceId) ||
      (await this.redisService.getDeviceTelemetryState(deviceId)) ||
      { ...DEFAULT_TELEMETRY };
    const telemetry = this.normalizeTelemetryPayload(rawTelemetry);

    if (!device) {
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
