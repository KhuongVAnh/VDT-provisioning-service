import { Test, TestingModule } from '@nestjs/testing';
import { ProvisioningService } from './provisioning.service';
import { DeviceService } from '../device/device.service';
import { ConfigService } from '@nestjs/config';
import { IpPoolService } from '../ip-pool/ip-pool.service';
import { WireguardService } from '../wireguard/wireguard.service';
import { UnauthorizedException, ConflictException, InternalServerErrorException } from '@nestjs/common';

describe('ProvisioningService', () => {
  let service: ProvisioningService;
  
  const mockDeviceService = {
    findByDeviceId: jest.fn(),
    createDevice: jest.fn(),
    updateDevice: jest.fn(),
    findActiveDevices: jest.fn().mockResolvedValue([]),
    syncManualKernelPeer: jest.fn().mockResolvedValue({ id: '1' }),
  };
  
  const mockConfigService = {
    get: jest.fn((key, defaultValue) => {
      if (key === 'PROVISION_SECRET_TOKEN') return 'FACTORY_SECRET_KEY_2026';
      if (key === 'WG_SERVER_ENDPOINT') return '103.253.20.32:10006';
      if (key === 'WG_SERVER_ALLOWED_IPS') return '10.13.37.0/24';
      if (key === 'WG_SERVER_PUBLIC_KEY') return 'SRV_PUB_KEY';
      if (key === 'MAVLINK_TARGET_HOST') return '10.13.37.1';
      if (key === 'MAVLINK_TARGET_PORT') return '14551';
      if (key === 'VPN_SUBNET_PREFIX') return '10.13.37.';
      return defaultValue || null;
    }),
  };

  const mockIpPoolService = {
    allocateIp: jest.fn(),
    getSubnetPrefix: jest.fn().mockReturnValue('10.13.37.'),
  };

  const mockWireguardService = {
    generateKeypair: jest.fn(),
    addPeer: jest.fn(),
    removePeer: jest.fn(),
    getServerPublicKey: jest.fn().mockResolvedValue('SRV_PUB_KEY'),
    getLivePeerStats: jest.fn().mockResolvedValue(new Map()),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvisioningService,
        { provide: DeviceService, useValue: mockDeviceService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: IpPoolService, useValue: mockIpPoolService },
        { provide: WireguardService, useValue: mockWireguardService },
      ],
    }).compile();

    service = module.get<ProvisioningService>(ProvisioningService);
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('phải quét và đồng bộ WireGuard kernel peers vào Database khi khởi động', async () => {
      const kernelPeers = new Map([
        [
          'PUB_KEY_PEER_1',
          {
            publicKey: 'PUB_KEY_PEER_1',
            endpoint: '1.2.3.4:51820',
            allowedIps: '10.13.37.9/32',
            latestHandshake: 1700000000,
            transferRx: 100,
            transferTx: 200,
            isOnline: true,
          },
        ],
      ]);
      mockWireguardService.getLivePeerStats.mockResolvedValue(kernelPeers);

      await service.onModuleInit();

      expect(mockWireguardService.getLivePeerStats).toHaveBeenCalled();
      expect(mockDeviceService.syncManualKernelPeer).toHaveBeenCalledWith('10.13.37.9', 'PUB_KEY_PEER_1', 1700000000);
    });
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

    it('should perform key rotation for ACTIVE device', async () => {
      mockDeviceService.findByDeviceId.mockResolvedValue({
        id: '1',
        deviceId: 'DRONE-123',
        vpnIp: '10.13.37.5',
        vpnPublicKey: 'OLD_PUBKEY',
        status: 'ACTIVE',
      });
      mockWireguardService.generateKeypair.mockResolvedValue({ privateKey: 'NEW_PRIV', publicKey: 'NEW_PUB' });
      mockWireguardService.removePeer.mockResolvedValue(undefined);
      mockWireguardService.addPeer.mockResolvedValue(undefined);
      mockDeviceService.updateDevice.mockResolvedValue({ id: '1' });

      const result = await service.registerDevice(validDto);

      expect(mockWireguardService.removePeer).toHaveBeenCalledWith('OLD_PUBKEY');
      expect(mockWireguardService.addPeer).toHaveBeenCalledWith('NEW_PUB', '10.13.37.5');
      expect(mockDeviceService.updateDevice).toHaveBeenCalled();
      expect(result.data.assignedIp).toBe('10.13.37.5');
      expect(result.data.vpn.privateKey).toBe('NEW_PRIV');
    });

    it('should reject REVOKED device', async () => {
      mockDeviceService.findByDeviceId.mockResolvedValue({
        id: '1', deviceId: 'DRONE-123', status: 'REVOKED'
      });

      await expect(service.registerDevice(validDto)).rejects.toThrow(ConflictException);
    });

    it('should successfully provision a new device', async () => {
      mockDeviceService.findByDeviceId.mockResolvedValue(null);
      mockIpPoolService.allocateIp.mockResolvedValue('10.13.37.2');
      mockWireguardService.generateKeypair.mockResolvedValue({ privateKey: 'PRIV', publicKey: 'PUB' });
      mockWireguardService.addPeer.mockResolvedValue(undefined);
      mockDeviceService.createDevice.mockResolvedValue({ id: '1' });

      const result = await service.registerDevice(validDto);

      expect(mockWireguardService.addPeer).toHaveBeenCalledWith('PUB', '10.13.37.2');
      expect(mockDeviceService.createDevice).toHaveBeenCalled();
      expect(result.data.assignedIp).toBe('10.13.37.2');
      expect(result.data.vpn.privateKey).toBe('PRIV');
    });

    it('should rollback WireGuard peer if DB save fails for new device', async () => {
      mockDeviceService.findByDeviceId.mockResolvedValue(null);
      mockIpPoolService.allocateIp.mockResolvedValue('10.13.37.2');
      mockWireguardService.generateKeypair.mockResolvedValue({ privateKey: 'PRIV', publicKey: 'PUB' });
      mockWireguardService.addPeer.mockResolvedValue(undefined);
      
      mockDeviceService.createDevice.mockRejectedValue(new Error('DB Error'));

      await expect(service.registerDevice(validDto)).rejects.toThrow(InternalServerErrorException);
      expect(mockWireguardService.removePeer).toHaveBeenCalledWith('PUB');
    });

    it('should throw if WireGuard config fails and not save to DB', async () => {
      mockDeviceService.findByDeviceId.mockResolvedValue(null);
      mockIpPoolService.allocateIp.mockResolvedValue('10.13.37.2');
      mockWireguardService.generateKeypair.mockResolvedValue({ privateKey: 'PRIV', publicKey: 'PUB' });
      mockWireguardService.addPeer.mockRejectedValue(new Error('WG Error'));

      await expect(service.registerDevice(validDto)).rejects.toThrow(InternalServerErrorException);
      expect(mockDeviceService.createDevice).not.toHaveBeenCalled();
    });
  });
});
