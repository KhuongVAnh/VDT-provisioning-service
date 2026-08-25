import { Test, TestingModule } from '@nestjs/testing';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { VideoGateway } from './video.gateway';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

describe('VideoModule Tests', () => {
  let service: VideoService;
  let controller: VideoController;
  let gateway: VideoGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideoController],
      providers: [
        VideoService,
        VideoGateway,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: any) => {
              if (key === 'VPS_PUBLIC_IP') return '103.253.20.32';
              if (key === 'PORT') return '10004';
              if (key === 'INTERNAL_MTX_HOST') return '127.0.0.1';
              if (key === 'INTERNAL_MTX_HLS_PORT') return 8888;
              if (key === 'INTERNAL_MTX_WHEP_PORT') return 8889;
              return defaultVal;
            }),
          },
        },
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

    service = module.get<VideoService>(VideoService);
    controller = module.get<VideoController>(VideoController);
    gateway = module.get<VideoGateway>(VideoGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(controller).toBeDefined();
    expect(gateway).toBeDefined();
  });

  it('should return unified single-port stream endpoints on port 10004', () => {
    const endpoints = service.getStreamEndpoints('DRONE-001');
    expect(endpoints.hlsUrl).toBe('http://103.253.20.32:10004/api/v1/video/DRONE-001/index.m3u8');
    expect(endpoints.whepProxyUrl).toBe('http://103.253.20.32:10004/api/v1/video/DRONE-001/whep');
    expect(endpoints.httpStreamUrl).toBe('http://103.253.20.32:10004/api/v1/video/DRONE-001/live.mp4');
  });

  it('controller should return stream info with success status', () => {
    const result = controller.getStreamInfo('DRONE-001');
    expect(result.status).toBe('success');
    expect(result.data.deviceId).toBe('DRONE-001');
  });

  it('gateway should handle subscribe/unsubscribe video room', () => {
    const mockClient: any = {
      id: 'socket-123',
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    };

    gateway.handleSubscribeVideo(mockClient, { deviceId: 'DRONE-001' });
    expect(mockClient.join).toHaveBeenCalledWith('video:DRONE-001');

    gateway.handleUnsubscribeVideo(mockClient, { deviceId: 'DRONE-001' });
    expect(mockClient.leave).toHaveBeenCalledWith('video:DRONE-001');
  });
});
