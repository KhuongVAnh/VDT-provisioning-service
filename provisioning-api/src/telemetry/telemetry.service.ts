import { Injectable, Logger, OnModuleInit, OnModuleDestroy, NotFoundException } from '@nestjs/common';
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
 *  2. [L1 In-Memory Cache 0ms]: Lưu snapshot trạng thái bay mới nhất của từng Drone trong RAM (`inMemoryCache`).
 *  3. [Cache Warm-up]: Nạp sẵn dữ liệu ban đầu từ Redis vào RAM khi khởi động để tránh Cold Start.
 *  4. [Chuyển tiếp Realtime]: Gọi `telemetryGateway.broadcastTelemetry()` để bắn dữ liệu xuống WebSocket Rooms.
 *  5. [Heartbeat Sweeper & Liveness]: Quét định kỳ kiểm tra timeout (10s) để cập nhật Offline và phát cảnh báo Realtime.
 *  6. [Chống Cache Stampede]: Sử dụng L1 RAM Cache (TTL 500ms) kết hợp SingleFlight Mutex Promise cho REST API.
 */
@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(TelemetryService.name);

	// ----------------------------------------------------------------------------
	// Hằng số quản lý vòng đời và độ tươi (Liveness & Freshness) của Cache
	// ----------------------------------------------------------------------------
	private readonly HEARTBEAT_TIMEOUT_MS = 10000; // 10 giây: Quá thời gian này coi như Drone mất kết nối (Offline)
	private readonly MAX_CACHE_RETENTION_MS = 300000; // 5 phút: Xóa hẳn Drone rác không còn bay khỏi RAM, giữ drone offline trong 5 phút để tránh spam DB khi Drone vừa mất sóng rồi lại bay trở lại

	// ----------------------------------------------------------------------------
	// Bộ nhớ đệm RAM L1 lưu snapshot trạng thái mới nhất của từng Drone (0ms lookup)
	// ----------------------------------------------------------------------------
	private readonly inMemoryCache = new Map<string, any>(); // Key: deviceId -> Value: TelemetryPayload
	private readonly autoDiscoveredDevices = new Set<string>(); // Danh sách Drone đã tự động ghi danh vào DB
	private readonly subnet: string;
	private heartbeatSweepInterval: NodeJS.Timeout | null = null; // Timer quét ngầm kiểm tra mất kết nối

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
	 * Hook khởi động: Nạp sẵn Cache từ Redis (Warm-up), đăng ký Pub/Sub và chạy Sweeper
	 */
	async onModuleInit() {
		// 1. Warm-up: Nạp dữ liệu hiện có từ Redis Hash `drone:states` vào RAM trước để không bị rỗng lúc vừa start
		await this.warmUpCacheFromRedis();

		// 2. Bắt đầu tiến trình đăng ký lắng nghe Pub/Sub từ Go Ingestion
		this.startRedisSubscription();

		// 3. Khởi chạy Timer quét định kỳ kiểm tra Drone Offline và dọn dẹp RAM
		this.startHeartbeatSweeper();
	}

	/**
	 * Hook hủy module: Dọn dẹp Timer để tránh rò rỉ tài nguyên khi dừng ứng dụng
	 */
	onModuleDestroy() {
		if (this.heartbeatSweepInterval) {
			clearInterval(this.heartbeatSweepInterval);
			this.heartbeatSweepInterval = null;
			this.logger.log('Đã dừng tiến trình Heartbeat Sweeper.');
		}
	}

	/**
	 * Khởi động Cache: Nạp toàn bộ trạng thái gần nhất từ Redis `drone:states` vào inMemoryCache
	 * Giúp tránh tình trạng "Cold Start" khi NestJS khởi động lại mà các Drone đang bay chỉ gửi gói Lite 1Hz.
	 */
	private async warmUpCacheFromRedis() {
		try {
			const initialStates = await this.redisService.getAllTelemetryStates();
			const count = Object.keys(initialStates).length;
			if (count > 0) {
				for (const [devId, state] of Object.entries(initialStates)) {
					const normalized = this.normalizeTelemetryPayload(state);
					this.inMemoryCache.set(devId, normalized);
				}
				this.logger.log(`🔥 [CACHE WARM-UP] Đã nạp ${count} Drone từ Redis vào RAM L1 Cache`);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.warn(`Không thể warm-up cache từ Redis: ${errorMessage}`);
		}
	}

	/**
	 * Tiến trình chạy ngầm quét kiểm tra nhịp tim (Heartbeat Sweep) mỗi 5 giây:
	 *  1. Phát hiện Drone mất kết nối (quá 10s không có tin mới):
	 *     -> Đổi `connected = false` trong RAM và bắn ngay sự kiện WebSocket xuống UI để Dashboard đổi màu đỏ thời gian thực.
	 *  2. Dọn dẹp bộ nhớ RAM (Eviction):
	 *     -> Xóa các Drone đã offline quá 1 giờ để chống rò rỉ bộ nhớ (Memory Leak).
	 */
	private startHeartbeatSweeper() {
		this.heartbeatSweepInterval = setInterval(() => {
			const now = Date.now();
			for (const [deviceId, telemetry] of this.inMemoryCache.entries()) {
				const lastSeenMs = telemetry.timestamp ? now - telemetry.timestamp : Infinity;

				// 1. Nếu Drone đang ghi nhận connected = true nhưng đã quá 10s không gửi tin -> Chuyển sang Offline
				if (telemetry.connected && lastSeenMs > this.HEARTBEAT_TIMEOUT_MS) {
					telemetry.connected = false;
					this.logger.warn(
						`⚠️ [HEARTBEAT TIMEOUT] Drone [${deviceId}] mất tín hiệu (Quá ${this.HEARTBEAT_TIMEOUT_MS / 1000}s không nhận Telemetry)`,
					);
					// Bắn sự kiện realtime xuống WebSocket để Web Dashboard cập nhật ngay lập tức sang màu đỏ
					this.telemetryGateway.broadcastTelemetry(telemetry);
				}

				// 2. Dọn dẹp Drone không hoạt động quá 1 giờ để giải phóng RAM
				if (lastSeenMs > this.MAX_CACHE_RETENTION_MS) {
					this.inMemoryCache.delete(deviceId);
					this.autoDiscoveredDevices.delete(deviceId);
					this.logger.debug(`🧹 [CACHE EVICT] Đã giải phóng Drone [${deviceId}] khỏi RAM Cache do không hoạt động > 1h`);
				}
			}
		}, 5000);
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
						).catch(() => { });
					}
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				this.logger.debug(`Lỗi khi parse message Telemetry từ Redis (${channel}): ${errorMessage}`);
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
		if (raw.gps && raw.battery && raw.attitude) {
			return raw;
		}

		const prev = this.inMemoryCache.get(raw.deviceId);

		// Nếu là Lite format (thu gọn): Bổ sung các giá trị và bảo toàn góc nghiêng Attitude
		return {
			deviceId: raw.deviceId,
			sysid: raw.sysid || prev?.sysid || 1,
			vpnIp: raw.vpnIp || prev?.vpnIp || '',
			connected: raw.connected ?? prev?.connected ?? true,
			armed: raw.armed ?? prev?.armed ?? false,
			flightMode: raw.flightMode || prev?.flightMode || 'UNKNOWN',
			battery: {
				percentage: raw.batteryPct ?? raw.battery?.percentage ?? prev?.battery?.percentage ?? 0,
				voltageMv: raw.voltageMv ?? raw.battery?.voltageMv ?? prev?.battery?.voltageMv ?? 0,
				currentCa: raw.battery?.currentCa ?? prev?.battery?.currentCa ?? 0,
			},
			gps: {
				lat: raw.lat ?? raw.gps?.lat ?? prev?.gps?.lat ?? 0,
				lon: raw.lon ?? raw.gps?.lon ?? prev?.gps?.lon ?? 0,
				altRelativeM: raw.altRelativeM ?? raw.gps?.altRelativeM ?? prev?.gps?.altRelativeM ?? 0,
				groundSpeedMs: raw.groundSpeedMs ?? raw.gps?.groundSpeedMs ?? prev?.gps?.groundSpeedMs ?? 0,
				headingDeg: raw.headingDeg ?? raw.gps?.headingDeg ?? prev?.gps?.headingDeg ?? 0,
				fixType: raw.gps?.fixType ?? prev?.gps?.fixType ?? 3,
				satellites: raw.gps?.satellites ?? prev?.gps?.satellites ?? 10,
			},
			attitude: {
				rollDeg: raw.rollDeg ?? raw.attitude?.rollDeg ?? prev?.attitude?.rollDeg ?? 0,
				pitchDeg: raw.pitchDeg ?? raw.attitude?.pitchDeg ?? prev?.attitude?.pitchDeg ?? 0,
				yawDeg: raw.headingDeg ?? raw.attitude?.yawDeg ?? prev?.attitude?.yawDeg ?? 0,
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

		// =========================================================================
		// BƯỚC 1: Kiểm tra Cache trúng (Cache Hit < 500ms)
		// =========================================================================
		// Nếu dữ liệu trong RAM vẫn còn mới (< 500ms), trả về luôn trong 0ms.
		// Không cần động vào Promise hay Database.
		if (now - this.lastFleetCacheTime < 500 && this.cachedAllFleetDevices.length > 0) {
			return this.filterDevicesForUser(this.cachedAllFleetDevices, user);
		}

		// =========================================================================
		// BƯỚC 2: Khởi tạo SingleFlight Mutex (Nếu chưa có ai fetch)
		// =========================================================================
		if (!this.fleetSingleFlightPromise) {
			// Request đầu tiên (Leader) tới sẽ kích hoạt hàm đọc Database/Redis
			// Lưu Promise này vào biến để các request sau dùng chung
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

		// =========================================================================
		// BƯỚC 3: Chờ chung Promise (Duplicate Call Suppression)
		// =========================================================================
		// 999 request tới sau sẽ KHÔNG gọi fetchRawFleetFromStorage()
		// mà chỉ "await" chung cùng 1 Promise đang bay.
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

		// 2. Lấy dữ liệu Telemetry: Kết hợp giữa L1 RAM inMemoryCache (ưu tiên hàng đầu) và Redis
		const redisStates = await this.redisService.getAllTelemetryStates();
		const allActiveDeviceIds = new Set([
			...Array.from(this.inMemoryCache.keys()),
			...Object.keys(redisStates),
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

		// 4. Ghép nối Telemetry vào từng Drone (Ưu tiên đọc từ L1 RAM Cache trước để đảm bảo dữ liệu mới nhất 0ms)
		for (const devId of allActiveDeviceIds) {
			const rawTelemetry = this.inMemoryCache.get(devId) || redisStates[devId];
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

		// 5. Chuẩn hóa dữ liệu trả về và kiểm tra Liveness (Timeout HEARTBEAT_TIMEOUT_MS = 10s)
		return Array.from(deviceMap.values()).map((dev) => {
			if (!dev.telemetry) {
				dev.telemetry = { ...DEFAULT_TELEMETRY };
			} else if (dev.telemetry.timestamp && Date.now() - dev.telemetry.timestamp > this.HEARTBEAT_TIMEOUT_MS) {
				dev.telemetry.connected = false;
			}
			return dev;
		});
	}

	/**
	 * Phân quyền triệt để phía Server (Server-Side Ownership Enforcement):
	 *  - ADMIN: Nhận toàn bộ thiết bị trong toàn hệ thống.
	 *  - PILOT: CHỈ nhận danh sách các Drone do chính tài khoản này sở hữu (dev.userId === user.id).
	 */
	private filterDevicesForUser(allDevices: any[], user?: any): any[] {
		if (!user || user.role === 'ADMIN') {
			return allDevices;
		}
		return allDevices.filter((dev) => dev.userId && dev.userId === user.id);
	}

	/**
	 * ============================================================================
	 * 4. LẤY SNAPSHOT TRẠNG THÁI CHI TIẾT CỦA 1 DRONE
	 * ============================================================================
	 * Đọc nhanh trong 0ms từ L1 RAM Cache `inMemoryCache`, fallback về Redis nếu chưa có trong RAM.
	 * Tự động kiểm tra độ tươi (Liveness Check < 10s) để tránh trả về dữ liệu Drone đã mất sóng.
	 */
	async getDeviceState(deviceId: string) {
		const device = await this.deviceService.findByDeviceId(deviceId);

		// [Bước 1]: Ưu tiên đọc từ RAM inMemoryCache (0ms), nếu không có mới đọc Redis
		const cachedTelemetry = this.inMemoryCache.get(deviceId);
		const rawTelemetry =
			cachedTelemetry ||
			(await this.redisService.getDeviceTelemetryState(deviceId)) ||
			{ ...DEFAULT_TELEMETRY };

		const telemetry = this.normalizeTelemetryPayload(rawTelemetry);

		// [Bước 2]: Kiểm tra độ tươi (Liveness Check) theo timestamp
		// Nếu quá HEARTBEAT_TIMEOUT_MS (10s) không có tin mới -> Đánh dấu connected = false
		if (telemetry.timestamp && Date.now() - telemetry.timestamp > this.HEARTBEAT_TIMEOUT_MS) {
			telemetry.connected = false;
		}

		if (!device) {
			if (this.inMemoryCache.has(deviceId)) {
				return {
					id: deviceId,
					deviceId,
					hardwareModel: 'Real-time Stream',
					vpnIp: '10.13.37.X',
					status: telemetry.connected ? 'ACTIVE' : 'INACTIVE',
					lastSeen: new Date(telemetry.timestamp || Date.now()),
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
