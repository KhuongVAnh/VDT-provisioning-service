import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { DeviceService } from '../device/device.service';
import { IpPoolService } from '../ip-pool/ip-pool.service';
import { WireguardService } from '../wireguard/wireguard.service';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('DashboardService', () => {
  let service: DashboardService;
  let deviceService: jest.Mocked<DeviceService>;
  let ipPoolService: jest.Mocked<IpPoolService>;
  let wireguardService: jest.Mocked<WireguardService>;

  const mockDevice = {
    id: 'uuid-1',
    deviceId: 'DRONE-1000',
    hardwareModel: 'Raspberry Pi 4',
    vpnIp: '10.13.37.2',
    vpnPublicKey: 'pubkey123',
    status: 'ACTIVE',
    lastSeen: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockDeviceService = {
      countStats: jest.fn().mockResolvedValue({ total: 1, active: 1, revoked: 0, pending: 0 }),
      findAllDevices: jest.fn().mockResolvedValue([mockDevice]),
      findByDeviceId: jest.fn().mockImplementation((id: string) => {
        if (id === 'DRONE-1000') return Promise.resolve(mockDevice);
        return Promise.resolve(null);
      }),
      revokeDevice: jest.fn().mockResolvedValue({ ...mockDevice, status: 'REVOKED', vpnIp: null }),
      reActivateDevice: jest.fn().mockResolvedValue({ ...mockDevice, status: 'ACTIVE', vpnIp: '10.13.37.2' }),
      deleteDevice: jest.fn().mockResolvedValue(mockDevice),
    };

    const mockIpPoolService = {
      getPoolStats: jest.fn().mockResolvedValue({
        subnetPrefix: '10.13.37.',
        gatewayIp: '10.13.37.1',
        startIp: 2,
        endIp: 254,
        totalCapacity: 253,
        usedCount: 1,
        availableCount: 252,
        utilizationPercentage: 0.4,
      }),
      allocateIp: jest.fn().mockResolvedValue('10.13.37.2'),
      getSubnetPrefix: jest.fn().mockReturnValue('10.13.37.'),
    };

    const livePeerMap = new Map();
    livePeerMap.set('pubkey123', {
      publicKey: 'pubkey123',
      endpoint: '1.2.3.4:51820',
      allowedIps: '10.13.37.2/32',
      latestHandshake: Math.floor(Date.now() / 1000) - 30, // 30s ago -> online
      transferRx: 1024,
      transferTx: 2048,
      isOnline: true,
    });

    const mockWireguardService = {
      getLivePeerStats: jest.fn().mockResolvedValue(livePeerMap),
      getServerInfo: jest.fn().mockResolvedValue({
        interfaceName: 'wg0',
        publicKey: 'serverPub123',
        listenPort: 10006,
        endpoint: '103.253.20.32:10006',
        isKernelActive: true,
      }),
      addPeer: jest.fn().mockResolvedValue(undefined),
      removePeer: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'PROVISION_SECRET_TOKEN') return 'FACTORY_SECRET_2026';
        if (key === 'WG_SERVER_ENDPOINT') return '103.253.20.32:10006';
        if (key === 'MAVLINK_TARGET_HOST') return '10.13.37.1';
        if (key === 'MAVLINK_TARGET_PORT') return 14551;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: DeviceService, useValue: mockDeviceService },
        { provide: IpPoolService, useValue: mockIpPoolService },
        { provide: WireguardService, useValue: mockWireguardService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    deviceService = module.get(DeviceService);
    ipPoolService = module.get(IpPoolService);
    wireguardService = module.get(WireguardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOverviewStats', () => {
    it('should aggregate KPI stats properly', async () => {
      const stats = await service.getOverviewStats();
      expect(stats.devices.total).toBe(1);
      expect(stats.devices.onlineNow).toBe(1);
      expect(stats.ipPool.totalCapacity).toBe(253);
      expect(stats.wireguard.totalRxBytes).toBe(1024);
      expect(stats.wireguard.totalTxBytes).toBe(2048);
    });
  });

  describe('getFleet', () => {
    it('should merge device records with live WireGuard metrics', async () => {
      const fleet = await service.getFleet();
      expect(fleet).toHaveLength(1);
      expect(fleet[0].deviceId).toBe('DRONE-1000');
      expect(fleet[0].isOnline).toBe(true);
      expect(fleet[0].transferRx).toBe(1024);
    });
  });

  describe('getIpPoolMatrix', () => {
    it('should return a matrix of 254 IP cells', async () => {
      const matrix = await service.getIpPoolMatrix();
      expect(matrix).toHaveLength(254);
      expect(matrix[0].status).toBe('gateway');
      expect(matrix[0].ip).toBe('10.13.37.1');
      expect(matrix[1].status).toBe('active');
      expect(matrix[1].ip).toBe('10.13.37.2');
      expect(matrix[2].status).toBe('available');
    });
  });
});
