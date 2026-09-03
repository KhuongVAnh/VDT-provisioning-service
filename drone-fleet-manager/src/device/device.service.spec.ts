import { Test, TestingModule } from '@nestjs/testing';
import { DeviceService } from './device.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DeviceService', () => {
  let service: DeviceService;

  const mockPrismaService = {
    device: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<DeviceService>(DeviceService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByDeviceId', () => {
    it('should return a device if found', async () => {
      const mockDevice = { id: 'uuid-1', deviceId: 'DRONE-123' };
      mockPrismaService.device.findUnique.mockResolvedValue(mockDevice);

      const result = await service.findByDeviceId('DRONE-123');
      expect(result).toEqual(mockDevice);
      expect(mockPrismaService.device.findUnique).toHaveBeenCalledWith({
        where: { deviceId: 'DRONE-123' },
      });
    });
  });

  describe('findAllDevices', () => {
    it('should return all devices sorted by createdAt desc', async () => {
      const mockDevices = [{ id: 'uuid-1', deviceId: 'DRONE-123' }];
      mockPrismaService.device.findMany.mockResolvedValue(mockDevices);

      const result = await service.findAllDevices();
      expect(result).toEqual(mockDevices);
      expect(mockPrismaService.device.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findActiveOrPendingIps', () => {
    it('should return list of used IPs excluding nulls', async () => {
      mockPrismaService.device.findMany.mockResolvedValue([
        { vpnIp: '10.13.37.2' },
        { vpnIp: '10.13.37.3' },
        { vpnIp: null },
      ]);

      const result = await service.findActiveOrPendingIps();
      expect(result).toEqual(['10.13.37.2', '10.13.37.3']);
    });
  });

  describe('countStats', () => {
    it('should count devices by status', async () => {
      mockPrismaService.device.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8)  // active
        .mockResolvedValueOnce(2)  // revoked
        .mockResolvedValueOnce(0); // pending

      const result = await service.countStats();
      expect(result).toEqual({ total: 10, active: 8, revoked: 2, pending: 0 });
    });
  });

  describe('createDevice', () => {
    it('should create and return device', async () => {
      const input = {
        deviceId: 'DRONE-123',
        hardwareModel: 'Pi 4',
        vpnIp: '10.13.37.5',
        vpnPublicKey: 'PUBKEY',
      };
      const created = { id: 'uuid-1', ...input, status: 'ACTIVE' };
      mockPrismaService.device.create.mockResolvedValue(created);

      const result = await service.createDevice(input);
      expect(result).toEqual(created);
    });
  });

  describe('syncManualKernelPeer', () => {
    it('phải tạo bản ghi tạm DRONE-IP-X-X-X-X khi phát hiện peer mới từ kernel', async () => {
      mockPrismaService.device.findFirst.mockResolvedValue(null);
      mockPrismaService.device.findUnique.mockResolvedValue(null);
      const created = { id: 'd-1', deviceId: 'DRONE-IP-10-13-37-8', vpnIp: '10.13.37.8', vpnPublicKey: 'PUB-8' };
      mockPrismaService.device.create.mockResolvedValue(created);

      const result = await service.syncManualKernelPeer('10.13.37.8', 'PUB-8');
      expect(result.deviceId).toBe('DRONE-IP-10-13-37-8');
      expect(mockPrismaService.device.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deviceId: 'DRONE-IP-10-13-37-8',
            vpnIp: '10.13.37.8',
          }),
        }),
      );
    });
  });

  describe('bindOrUpdateDeviceIdentity', () => {
    it('phải nâng cấp từ ID tạm DRONE-IP-... sang ID thật khi nhận được telemetry', async () => {
      mockPrismaService.device.findUnique.mockResolvedValue(null); // chưa có theo ID thật
      mockPrismaService.device.findFirst.mockResolvedValue({
        id: 'd-temp',
        deviceId: 'DRONE-IP-10-13-37-8',
        vpnIp: '10.13.37.8',
        hardwareModel: 'Manual WireGuard Peer',
      });
      const updated = { id: 'd-temp', deviceId: 'DRONE-REAL-01', vpnIp: '10.13.37.8' };
      mockPrismaService.device.update.mockResolvedValue(updated);

      const result = await service.bindOrUpdateDeviceIdentity('DRONE-REAL-01', '10.13.37.8', 'Pixhawk 4');
      expect(result.deviceId).toBe('DRONE-REAL-01');
      expect(mockPrismaService.device.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'd-temp' },
          data: expect.objectContaining({ deviceId: 'DRONE-REAL-01' }),
        }),
      );
    });
  });
});
