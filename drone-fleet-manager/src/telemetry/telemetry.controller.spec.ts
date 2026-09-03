import { Test, TestingModule } from '@nestjs/testing';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TelemetryController', () => {
  let controller: TelemetryController;

  const mockTelemetryService = {
    getAllFleetStates: jest.fn().mockResolvedValue([
      { deviceId: 'DRONE-001', telemetry: { flightMode: 'GUIDED' } },
    ]),
    getDeviceState: jest.fn().mockResolvedValue({
      deviceId: 'DRONE-001',
      telemetry: { flightMode: 'GUIDED' },
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelemetryController],
      providers: [
        { provide: TelemetryService, useValue: mockTelemetryService },
        {
          provide: PrismaService,
          useValue: {
            device: {
              findUnique: jest.fn().mockResolvedValue({ id: '1', deviceId: 'DRONE-001', userId: 'usr-1' }),
            },
          },
        },
      ],
    }).compile();

    controller = module.get<TelemetryController>(TelemetryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return fleet states', async () => {
    const mockUser = { id: 'usr-1', role: 'ADMIN' };
    const result = await controller.getFleetStates(mockUser);
    expect(result.status).toBe('success');
    expect(result.data).toHaveLength(1);
  });

  it('should return device state', async () => {
    const result = await controller.getDeviceState('DRONE-001');
    expect(result.status).toBe('success');
    expect(result.data.deviceId).toBe('DRONE-001');
  });
});
