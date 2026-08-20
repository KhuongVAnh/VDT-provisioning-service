import { Test, TestingModule } from '@nestjs/testing';
import { IpPoolService } from './ip-pool.service';
import { DeviceService } from '../device/device.service';
import { ConfigService } from '@nestjs/config';

describe('IpPoolService', () => {
  let service: IpPoolService;

  const mockDeviceService = {
    findActiveOrPendingIps: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultVal: string) => {
      if (key === 'VPN_SUBNET_PREFIX') return '10.13.37.';
      return defaultVal;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpPoolService,
        {
          provide: DeviceService,
          useValue: mockDeviceService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<IpPoolService>(IpPoolService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('allocateIp', () => {
    it('should allocate 10.13.37.2 when pool is empty', async () => {
      mockDeviceService.findActiveOrPendingIps.mockResolvedValue([]);
      const ip = await service.allocateIp();
      expect(ip).toBe('10.13.37.2');
    });

    it('should allocate smallest available IP (10.13.37.3) when 10.13.37.2 is taken', async () => {
      mockDeviceService.findActiveOrPendingIps.mockResolvedValue(['10.13.37.2']);
      const ip = await service.allocateIp();
      expect(ip).toBe('10.13.37.3');
    });

    it('should reuse an IP if a device was revoked and removed from PENDING/ACTIVE', async () => {
      mockDeviceService.findActiveOrPendingIps.mockResolvedValue(['10.13.37.3']);
      const ip = await service.allocateIp();
      expect(ip).toBe('10.13.37.2');
    });

    it('should throw an error when all IPs are exhausted', async () => {
      const fullPool: string[] = [];
      for (let i = 2; i <= 254; i++) {
        fullPool.push(`10.13.37.${i}`);
      }
      mockDeviceService.findActiveOrPendingIps.mockResolvedValue(fullPool);

      await expect(service.allocateIp()).rejects.toThrow('Không còn địa chỉ IP khả dụng trong dải mạng (Pool đã đầy)');
    });
  });
});
