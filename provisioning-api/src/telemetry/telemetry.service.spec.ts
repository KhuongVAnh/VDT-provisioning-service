import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TelemetryService } from './telemetry.service';
import { RedisService } from '../redis/redis.service';
import { TelemetryGateway } from './telemetry.gateway';
import { DeviceService } from '../device/device.service';

describe('TelemetryService', () => {
  let service: TelemetryService;

  const mockRedisService = {
    getSubscriber: jest.fn().mockReturnValue({
      subscribe: jest.fn((channel, cb) => cb(null)),
      on: jest.fn(),
    }),
    getAllTelemetryStates: jest.fn().mockResolvedValue({
      'DRONE-001': {
        deviceId: 'DRONE-001',
        connected: true,
        armed: true,
        flightMode: 'GUIDED',
        battery: { percentage: 90 },
        gps: { lat: 21.0, lon: 105.8 },
      },
    }),
    getDeviceTelemetryState: jest.fn().mockResolvedValue({
      deviceId: 'DRONE-001',
      connected: true,
      armed: true,
      flightMode: 'GUIDED',
      battery: { percentage: 90 },
      gps: { lat: 21.0, lon: 105.8 },
    }),
  };

  const mockTelemetryGateway = {
    broadcastTelemetry: jest.fn(),
  };

  const mockDeviceService = {
    findAllDevices: jest.fn().mockResolvedValue([
      {
        id: '1',
        deviceId: 'DRONE-001',
        hardwareModel: 'Pi 4',
        vpnIp: '10.13.37.5',
        status: 'ACTIVE',
        lastSeen: new Date(),
      },
    ]),
    findByDeviceId: jest.fn().mockResolvedValue({
      id: '1',
      deviceId: 'DRONE-001',
      hardwareModel: 'Pi 4',
      vpnIp: '10.13.37.5',
      status: 'ACTIVE',
      lastSeen: new Date(),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelemetryService,
        { provide: RedisService, useValue: mockRedisService },
        { provide: TelemetryGateway, useValue: mockTelemetryGateway },
        { provide: DeviceService, useValue: mockDeviceService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string, defaultValue: any) => defaultValue || '10.13.37.'),
          },
        },
      ],
    }).compile();

    service = module.get<TelemetryService>(TelemetryService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return all fleet states with telemetry data', async () => {
    const states = await service.getAllFleetStates();
    expect(states).toHaveLength(1);
    expect(states[0].deviceId).toBe('DRONE-001');
    expect(states[0].telemetry.flightMode).toBe('GUIDED');
  });

  it('phải cô lập phi đội khi user là PILOT và không thêm drone lạ', async () => {
    mockDeviceService.findAllDevices.mockResolvedValueOnce([
      {
        id: '1',
        deviceId: 'DRONE-001',
        hardwareModel: 'Pi 4',
        vpnIp: '10.13.37.5',
        status: 'ACTIVE',
        lastSeen: new Date(),
        userId: 'pilot-123',
      },
    ]);

    mockRedisService.getAllTelemetryStates.mockResolvedValueOnce({
      'DRONE-001': {
        deviceId: 'DRONE-001',
        connected: true,
        armed: true,
      },
      'DRONE-OTHER': {
        deviceId: 'DRONE-OTHER',
        connected: true,
        armed: true,
      },
    });

    const pilotStates = await service.getAllFleetStates({ id: 'pilot-123', role: 'PILOT' });
    expect(pilotStates).toHaveLength(1);
    expect(pilotStates[0].deviceId).toBe('DRONE-001');
  });

  it('should return single device state', async () => {
    const state = await service.getDeviceState('DRONE-001');
    expect(state.deviceId).toBe('DRONE-001');
    expect(state.telemetry.battery.percentage).toBe(90);
  });
});
