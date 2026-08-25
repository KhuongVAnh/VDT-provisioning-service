import { Test, TestingModule } from '@nestjs/testing';
import { MavlinkRelayGateway } from './mavlink-relay.gateway';
import { RedisService } from '../redis/redis.service';
import { DeviceService } from '../device/device.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

describe('MavlinkRelayGateway', () => {
  let gateway: MavlinkRelayGateway;
  let redisService: jest.Mocked<Partial<RedisService>>;
  let deviceService: jest.Mocked<Partial<DeviceService>>;

  beforeEach(async () => {
    const mockSubscriber = {
      psubscribe: jest.fn(),
      on: jest.fn(),
    };

    redisService = {
      getSubscriber: jest.fn().mockReturnValue(mockSubscriber),
    };

    deviceService = {
      findByDeviceId: jest.fn().mockResolvedValue({
        id: '1',
        deviceId: 'DRONE-001',
        vpnIp: '10.13.37.2',
        vpnPublicKey: 'key',
        hardwareModel: 'X6',
        status: 'ACTIVE',
        userId: null,
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MavlinkRelayGateway,
        { provide: RedisService, useValue: redisService },
        { provide: DeviceService, useValue: deviceService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(14551),
          },
        },
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn().mockReturnValue({ sub: 'usr-1', email: 'admin@gmail.com', role: 'ADMIN' }),
            sign: jest.fn().mockReturnValue('mock-token'),
          },
        },
      ],
    }).compile();

    gateway = module.get<MavlinkRelayGateway>(MavlinkRelayGateway);
  });

  afterEach(() => {
    gateway.onModuleDestroy();
  });

  it('phải được khởi tạo thành công', () => {
    expect(gateway).toBeDefined();
  });

  it('phải từ chối kết nối nếu thiếu tham số droneId', async () => {
    const mockClient: any = {
      id: 'client-1',
      handshake: { query: { token: 'valid-token' }, headers: {} },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(mockClient);

    expect(mockClient.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('droneId') }));
    expect(mockClient.disconnect).toHaveBeenCalledWith(true);
  });

  it('phải từ chối kết nối nếu thiếu token xác thực', async () => {
    const mockClient: any = {
      id: 'client-no-token',
      handshake: { query: { droneId: 'DRONE-001' }, headers: {} },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(mockClient);

    expect(mockClient.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('token') }));
    expect(mockClient.disconnect).toHaveBeenCalledWith(true);
  });

  it('phải chấp nhận kết nối khi có droneId và token hợp lệ', async () => {
    const mockClient: any = {
      id: 'client-2',
      handshake: { query: { droneId: 'DRONE-001', token: 'valid-token' }, headers: {} },
      data: {},
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(mockClient);

    expect(mockClient.data.droneId).toBe('DRONE-001');
    expect(mockClient.disconnect).not.toHaveBeenCalled();
  });

  it('phải chuyển tiếp downlink buffer tới client đang kết nối', async () => {
    const mockClient: any = {
      id: 'client-3',
      handshake: { query: { droneId: 'DRONE-001', token: 'valid-token' }, headers: {} },
      data: {},
      connected: true,
      emit: jest.fn(),
      send: jest.fn(),
    };

    await gateway.handleConnection(mockClient);

    const testBuffer = Buffer.from([0xfd, 0x09, 0x00, 0x00]);
    gateway.broadcastDownlink('DRONE-001', testBuffer);

    expect(mockClient.emit).toHaveBeenCalledWith('mavlink:downlink', testBuffer);
    expect(mockClient.send).toHaveBeenCalledWith(testBuffer);
  });

  it('phải xử lý uplink message từ QGroundControl gửi xuống Drone VPN IP', async () => {
    const mockClient: any = {
      id: 'client-4',
      data: { droneId: 'DRONE-001' },
    };

    const testUplink = Buffer.from([0xfd, 0x0c, 0x01]);
    await gateway.handleMavlinkUplink(mockClient, testUplink);

    expect(deviceService.findByDeviceId).toHaveBeenCalledWith('DRONE-001');
  });
});
