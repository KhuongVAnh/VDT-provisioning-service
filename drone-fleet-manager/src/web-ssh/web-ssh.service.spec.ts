import { Test, TestingModule } from '@nestjs/testing';
import { WebSshService } from './web-ssh.service';
import { DeviceService } from '../device/device.service';
import { RedisService } from '../redis/redis.service';

describe('WebSshService', () => {
  let service: WebSshService;

  const mockDeviceService = {
    findByDeviceId: jest.fn(),
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue({
      hgetall: jest.fn().mockResolvedValue({}),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebSshService,
        { provide: DeviceService, useValue: mockDeviceService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<WebSshService>(WebSshService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reject ssh connect for non-existent device', async () => {
    mockDeviceService.findByDeviceId.mockResolvedValue(null);
    const mockSocket: any = {
      id: 'socket-1',
      emit: jest.fn(),
    };

    await service.createSshSession(mockSocket, { deviceId: 'NON_EXIST' });

    expect(mockSocket.emit).toHaveBeenCalledWith('ssh:status', {
      status: 'error',
      message: 'Không tìm thấy địa chỉ IP VPN của Drone: "NON_EXIST". Vui lòng kiểm tra lại.',
    });
  });

  it('should reject ssh connect for device without vpnIp', async () => {
    mockDeviceService.findByDeviceId.mockResolvedValue({
      deviceId: 'DRONE-REVOKED',
      vpnIp: null,
    });
    const mockSocket: any = {
      id: 'socket-2',
      emit: jest.fn(),
    };

    await service.createSshSession(mockSocket, { deviceId: 'DRONE-REVOKED' });

    expect(mockSocket.emit).toHaveBeenCalledWith('ssh:status', {
      status: 'error',
      message: 'Không tìm thấy địa chỉ IP VPN của Drone: "DRONE-REVOKED". Vui lòng kiểm tra lại.',
    });
  });
});
