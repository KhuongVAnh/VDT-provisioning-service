import { Test, TestingModule } from '@nestjs/testing';
import { WebSshService } from './web-ssh.service';
import { DeviceService } from '../device/device.service';

describe('WebSshService', () => {
  let service: WebSshService;

  const mockDeviceService = {
    findByDeviceId: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebSshService,
        { provide: DeviceService, useValue: mockDeviceService },
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
      message: 'Không tìm thấy Drone: NON_EXIST',
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
      message: 'Drone DRONE-REVOKED chưa có IP VPN hoặc đang bị thu hồi (REVOKED).',
    });
  });
});
