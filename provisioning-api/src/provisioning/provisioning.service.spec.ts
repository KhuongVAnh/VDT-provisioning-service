import { Test, TestingModule } from '@nestjs/testing';
import { ProvisioningService } from './provisioning.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { IpPoolService } from '../ip-pool/ip-pool.service';
import { WireguardService } from '../wireguard/wireguard.service';
import { UnauthorizedException, ConflictException, InternalServerErrorException } from '@nestjs/common';

describe('ProvisioningService', () => {
  let service: ProvisioningService;
  
  const mockPrismaService = {
    device: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  
  const mockConfigService = {
    get: jest.fn((key) => {
      if (key === 'PROVISION_SECRET_TOKEN') return 'FACTORY_SECRET_KEY_2026';
      if (key === 'WG_SERVER_ENDPOINT') return '103.253.20.32:10006';
      if (key === 'WG_SERVER_ALLOWED_IPS') return '10.0.0.0/24';
      if (key === 'WG_SERVER_PUBLIC_KEY') return 'SRV_PUB_KEY';
      return null;
    }),
  };

  const mockIpPoolService = {
    allocateIp: jest.fn(),
  };

  const mockWireguardService = {
    generateKeypair: jest.fn(),
    addPeer: jest.fn(),
    removePeer: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvisioningService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: IpPoolService, useValue: mockIpPoolService },
        { provide: WireguardService, useValue: mockWireguardService },
      ],
    }).compile();

    service = module.get<ProvisioningService>(ProvisioningService);
    jest.clearAllMocks();
  });

  describe('registerDevice', () => {
    const validDto = {
      deviceId: 'DRONE-123',
      hardwareModel: 'Pi 4',
      provisionToken: 'FACTORY_SECRET_KEY_2026',
    };

    it('should reject invalid provisioning token', async () => {
      await expect(service.registerDevice({ ...validDto, provisionToken: 'INVALID' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should return existing config for ACTIVE device', async () => {
      mockPrismaService.device.findUnique.mockResolvedValue({
        id: '1', deviceId: 'DRONE-123', vpnIp: '10.0.0.5', vpnPublicKey: 'PUBKEY', status: 'ACTIVE'
      });

      const result = await service.registerDevice(validDto);
      expect(result.data.assignedIp).toBe('10.0.0.5');
      expect(result.data.vpn.privateKey).toBe('<PRIVATE_KEY_NOT_STORED_FOR_SECURITY>');
      expect(mockWireguardService.generateKeypair).not.toHaveBeenCalled();
    });

    it('should reject REVOKED device', async () => {
      mockPrismaService.device.findUnique.mockResolvedValue({
        id: '1', deviceId: 'DRONE-123', status: 'REVOKED'
      });

      await expect(service.registerDevice(validDto)).rejects.toThrow(ConflictException);
    });

    it('should successfully provision a new device', async () => {
      mockPrismaService.device.findUnique.mockResolvedValue(null);
      mockIpPoolService.allocateIp.mockResolvedValue('10.0.0.2');
      mockWireguardService.generateKeypair.mockResolvedValue({ privateKey: 'PRIV', publicKey: 'PUB' });
      mockWireguardService.addPeer.mockResolvedValue(undefined);
      mockPrismaService.device.create.mockResolvedValue({ id: '1' });

      const result = await service.registerDevice(validDto);

      expect(mockWireguardService.addPeer).toHaveBeenCalledWith('PUB', '10.0.0.2');
      expect(mockPrismaService.device.create).toHaveBeenCalled();
      expect(result.data.assignedIp).toBe('10.0.0.2');
      expect(result.data.vpn.privateKey).toBe('PRIV');
    });

    it('should rollback WireGuard peer if DB save fails', async () => {
      mockPrismaService.device.findUnique.mockResolvedValue(null);
      mockIpPoolService.allocateIp.mockResolvedValue('10.0.0.2');
      mockWireguardService.generateKeypair.mockResolvedValue({ privateKey: 'PRIV', publicKey: 'PUB' });
      mockWireguardService.addPeer.mockResolvedValue(undefined);
      
      mockPrismaService.device.create.mockRejectedValue(new Error('DB Error'));

      await expect(service.registerDevice(validDto)).rejects.toThrow(InternalServerErrorException);
      expect(mockWireguardService.removePeer).toHaveBeenCalledWith('PUB');
    });

    it('should throw if WireGuard config fails and not save to DB', async () => {
      mockPrismaService.device.findUnique.mockResolvedValue(null);
      mockIpPoolService.allocateIp.mockResolvedValue('10.0.0.2');
      mockWireguardService.generateKeypair.mockResolvedValue({ privateKey: 'PRIV', publicKey: 'PUB' });
      mockWireguardService.addPeer.mockRejectedValue(new Error('WG Error'));

      await expect(service.registerDevice(validDto)).rejects.toThrow(InternalServerErrorException);
      expect(mockPrismaService.device.create).not.toHaveBeenCalled();
    });
  });
});
