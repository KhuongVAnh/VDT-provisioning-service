import { Test, TestingModule } from '@nestjs/testing';
import { DeviceService } from './device.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DeviceService', () => {
  let service: DeviceService;

  const mockPrismaService = {
    device: {
      findUnique: jest.fn(),
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

  describe('revokeDevice', () => {
    it('should set status to REVOKED and vpnIp to null', async () => {
      const revoked = { id: 'uuid-1', deviceId: 'DRONE-123', status: 'REVOKED', vpnIp: null };
      mockPrismaService.device.update.mockResolvedValue(revoked);

      const result = await service.revokeDevice('DRONE-123');
      expect(result).toEqual(revoked);
      expect(mockPrismaService.device.update).toHaveBeenCalledWith({
        where: { deviceId: 'DRONE-123' },
        data: { status: 'REVOKED', vpnIp: null },
      });
    });
  });

  describe('reActivateDevice', () => {
    it('should reactivate device with new IP', async () => {
      const reactivated = { id: 'uuid-1', deviceId: 'DRONE-123', status: 'ACTIVE', vpnIp: '10.13.37.10' };
      mockPrismaService.device.update.mockResolvedValue(reactivated);

      const result = await service.reActivateDevice('DRONE-123', '10.13.37.10');
      expect(result.status).toBe('ACTIVE');
      expect(result.vpnIp).toBe('10.13.37.10');
    });
  });

  describe('deleteDevice', () => {
    it('should delete device record', async () => {
      const deleted = { id: 'uuid-1', deviceId: 'DRONE-123' };
      mockPrismaService.device.delete.mockResolvedValue(deleted);

      const result = await service.deleteDevice('DRONE-123');
      expect(result).toEqual(deleted);
      expect(mockPrismaService.device.delete).toHaveBeenCalledWith({
        where: { deviceId: 'DRONE-123' },
      });
    });
  });
});
