import { Test, TestingModule } from '@nestjs/testing';
import { IpPoolService } from './ip-pool.service';
import { PrismaService } from '../prisma/prisma.service';

describe('IpPoolService', () => {
  let service: IpPoolService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    device: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpPoolService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<IpPoolService>(IpPoolService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('allocateIp', () => {
    it('should allocate 10.13.37.2 when pool is empty', async () => {
      mockPrismaService.device.findMany.mockResolvedValue([]);
      const ip = await service.allocateIp();
      expect(ip).toBe('10.13.37.2');
    });

    it('should allocate smallest available IP (10.13.37.3) when 10.13.37.2 is taken', async () => {
      mockPrismaService.device.findMany.mockResolvedValue([{ vpnIp: '10.13.37.2' }]);
      const ip = await service.allocateIp();
      expect(ip).toBe('10.13.37.3');
    });

    it('should reuse an IP if a device was revoked and removed from PENDING/ACTIVE', async () => {
      // Ý nghĩa: findMany chỉ trả về danh sách IP của PENDING/ACTIVE. Nếu .2 bị thu hồi, nó sẽ không xuất hiện trong danh sách này.
      mockPrismaService.device.findMany.mockResolvedValue([{ vpnIp: '10.13.37.3' }]);
      const ip = await service.allocateIp();
      expect(ip).toBe('10.13.37.2');
    });

    it('should throw an error when all IPs are exhausted', async () => {
      const fullPool = [];
      for (let i = 2; i <= 254; i++) {
        fullPool.push({ vpnIp: `10.13.37.${i}` });
      }
      mockPrismaService.device.findMany.mockResolvedValue(fullPool);

      await expect(service.allocateIp()).rejects.toThrow('Không còn địa chỉ IP khả dụng trong dải mạng (Pool đã đầy)');
    });
  });
});
