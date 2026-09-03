import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DashboardController', () => {
  let controller: DashboardController;
  let service: jest.Mocked<DashboardService>;

  beforeEach(async () => {
    const mockDashboardService = {
      getOverviewStats: jest.fn().mockResolvedValue({
        devices: { total: 1, active: 1, revoked: 0, pending: 0, onlineNow: 1 },
        ipPool: { totalCapacity: 253, usedCount: 1, availableCount: 252, utilizationPercentage: 0.4 },
        wireguard: { totalRxBytes: 100, totalTxBytes: 200, activePeersCount: 1 },
        serverTime: new Date().toISOString(),
      }),
      getFleet: jest.fn().mockResolvedValue([
        { deviceId: 'DRONE-1', vpnIp: '10.13.37.2', status: 'ACTIVE', isOnline: true },
      ]),
      getIpPoolMatrix: jest.fn().mockResolvedValue([
        { ip: '10.13.37.1', status: 'gateway' },
      ]),
      getLivePeers: jest.fn().mockResolvedValue([]),
      getSystemConfig: jest.fn().mockReturnValue({
        provisionSecretToken: 'TOKEN',
        serverEndpoint: '103.253.20.32:10006',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: DashboardService, useValue: mockDashboardService },
        {
          provide: PrismaService,
          useValue: {
            device: {
              findUnique: jest.fn().mockResolvedValue({ id: '1', deviceId: 'DRONE-1', userId: 'usr-1' }),
            },
          },
        },
      ],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
    service = module.get(DashboardService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should get overview stats', async () => {
    const mockUser = { id: 'usr-1', role: 'ADMIN' };
    const res = await controller.getOverviewStats(mockUser);
    expect(res.status).toBe('success');
    expect(res.data.devices.total).toBe(1);
  });

  it('should get fleet devices', async () => {
    const mockUser = { id: 'usr-1', role: 'ADMIN' };
    const res = await controller.getFleet(mockUser);
    expect(res.status).toBe('success');
    expect(res.data).toHaveLength(1);
  });

  it('should get ip pool matrix', async () => {
    const res = await controller.getIpPoolMatrix();
    expect(res.status).toBe('success');
    expect(res.data).toHaveLength(1);
  });
});
