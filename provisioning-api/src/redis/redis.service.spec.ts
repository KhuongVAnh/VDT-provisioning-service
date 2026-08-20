import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service';
import { ConfigService } from '@nestjs/config';

describe('RedisService', () => {
  let service: RedisService;

  const mockConfigService = {
    get: jest.fn((key, defaultVal) => defaultVal),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should gracefully handle empty client operations', async () => {
    const states = await service.getAllTelemetryStates();
    expect(states).toEqual({});

    const deviceState = await service.getDeviceTelemetryState('DRONE-001');
    expect(deviceState).toBeNull();
  });
});
