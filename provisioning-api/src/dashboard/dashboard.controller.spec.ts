import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

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
      revokeDevice: jest.fn().mockResolvedValue({ status: 'success', message: 'Revoked' }),
      reActivateDevice: jest.fn().mockResolvedValue({ status: 'success', message: 'Reactivated' }),
      deleteDevice: jest.fn().mockResolvedValue({ status: 'success', message: 'Deleted' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: mockDashboardService }],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
    service = module.get(DashboardService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should get overview stats', async () => {
    const res = await controller.getOverviewStats();
    expect(res.status).toBe('success');
    expect(res.data.devices.total).toBe(1);
  });

  it('should get fleet devices', async () => {
    const res = await controller.getFleet();
    expect(res.status).toBe('success');
    expect(res.data).toHaveLength(1);
  });

  it('should get ip pool matrix', async () => {
    const res = await controller.getIpPoolMatrix();
    expect(res.status).toBe('success');
    expect(res.data).toHaveLength(1);
  });

  it('should revoke device', async () => {
    const res = await controller.revokeDevice('DRONE-1');
    expect(res.status).toBe('success');
    expect(service.revokeDevice).toHaveBeenCalledWith('DRONE-1');
  });

  it('should reactivate device', async () => {
    const res = await controller.reActivateDevice('DRONE-1');
    expect(res.status).toBe('success');
    expect(service.reActivateDevice).toHaveBeenCalledWith('DRONE-1');
  });

  it('should delete device', async () => {
    const res = await controller.deleteDevice('DRONE-1');
    expect(res.status).toBe('success');
    expect(service.deleteDevice).toHaveBeenCalledWith('DRONE-1');
  });
});
