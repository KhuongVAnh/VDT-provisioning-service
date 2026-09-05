import { Test, TestingModule } from '@nestjs/testing';
import { TelemetryGateway } from './telemetry.gateway';
import { JwtService } from '@nestjs/jwt';
import { DeviceService } from '../device/device.service';
import { RedisService } from '../redis/redis.service';

describe('TelemetryGateway', () => {
  let gateway: TelemetryGateway;
  let jwtService: any;
  let deviceService: any;
  let redisService: any;

  beforeEach(async () => {
    jwtService = {
      verify: jest.fn(),
    };

    deviceService = {
      findByDeviceId: jest.fn(),
    };

    redisService = {
      addFocusDrone: jest.fn().mockResolvedValue(true),
      removeFocusDrone: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelemetryGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: DeviceService, useValue: deviceService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    gateway = module.get<TelemetryGateway>(TelemetryGateway);
    gateway.server = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
  });

  it('phải được khởi tạo thành công', () => {
    expect(gateway).toBeDefined();
  });

  it('ADMIN kết nối sẽ tự động tham gia phòng admin và all', async () => {
    jwtService.verify.mockReturnValue({ sub: 'admin-id', role: 'ADMIN', email: 'admin@test.com' });
    const mockSocket: any = {
      id: 'socket-admin',
      handshake: { auth: { token: 'admin-jwt' } },
      join: jest.fn(),
    };

    await gateway.handleConnection(mockSocket);

    expect(mockSocket.join).toHaveBeenCalledWith('admin');
    expect(mockSocket.join).toHaveBeenCalledWith('all');
  });

  it('PILOT kết nối sẽ chỉ tham gia phòng cá nhân user:<userId>', async () => {
    jwtService.verify.mockReturnValue({ sub: 'pilot-123', role: 'PILOT', email: 'pilot@test.com' });
    const mockSocket: any = {
      id: 'socket-pilot',
      handshake: { auth: { token: 'pilot-jwt' } },
      join: jest.fn(),
    };

    await gateway.handleConnection(mockSocket);

    expect(mockSocket.join).toHaveBeenCalledWith('user:pilot-123');
    expect(mockSocket.join).not.toHaveBeenCalledWith('all');
    expect(mockSocket.join).not.toHaveBeenCalledWith('admin');
  });

  it('broadcastTelemetry phải gửi tới admin và phòng cá nhân của chủ sở hữu Drone', async () => {
    gateway.setDeviceOwnerCache('DRONE-001', 'pilot-123');

    await gateway.broadcastTelemetry({ deviceId: 'DRONE-001', battery: { percentage: 95 } });

    expect(gateway.server.to).toHaveBeenCalledWith('drone:DRONE-001');
    expect(gateway.server.to).toHaveBeenCalledWith('admin');
    expect(gateway.server.to).toHaveBeenCalledWith('user:pilot-123');
  });

  it('PILOT cố tình subscribe drone của người khác sẽ bị từ chối', async () => {
    const mockSocket: any = {
      id: 'socket-pilot',
      data: { user: { sub: 'pilot-123', role: 'PILOT' } },
      join: jest.fn(),
    };

    deviceService.findByDeviceId.mockResolvedValue({
      deviceId: 'DRONE-999',
      userId: 'other-pilot',
    });

    const result = await gateway.handleSubscribeDrone(mockSocket, { deviceId: 'DRONE-999' });

    expect(result).toEqual({
      status: 'error',
      message: 'Quyền truy cập bị từ chối: Bạn không sở hữu Drone [DRONE-999]',
    });
    expect(mockSocket.join).not.toHaveBeenCalled();
  });
});
