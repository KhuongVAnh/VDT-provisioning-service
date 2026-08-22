import { Test, TestingModule } from '@nestjs/testing';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { VideoGateway } from './video.gateway';
import { ConfigService } from '@nestjs/config';

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
    expect(endpoints.deviceId).toBe('DRONE-001');
    expect(endpoints.streamPath).toBe('live/DRONE-001');
    expect(endpoints.hlsUrl).toContain(':10004/api/v1/video/DRONE-001/index.m3u8');
    expect(endpoints.httpStreamUrl).toContain(':10004/api/v1/video/DRONE-001/live.mp4');
    expect(endpoints.whepProxyUrl).toContain(':10004/api/v1/video/DRONE-001/whep');
  });

  it('controller should return stream info with success status', () => {
    const res = controller.getStreamInfo('DRONE-TEST');
    expect(res.status).toBe('success');
    expect(res.data.deviceId).toBe('DRONE-TEST');
  });

  it('gateway should handle subscribe/unsubscribe video room', () => {
    const mockSocket: any = {
      id: 'test-socket-1',
      join: jest.fn(),
      leave: jest.fn(),
    };

    const subRes = gateway.handleSubscribeVideo(mockSocket, { deviceId: 'DRONE-01' });
    expect(subRes.status).toBe('success');
    expect(mockSocket.join).toHaveBeenCalledWith('video:DRONE-01');

    const unsubRes = gateway.handleUnsubscribeVideo(mockSocket, { deviceId: 'DRONE-01' });
    expect(unsubRes.status).toBe('success');
    expect(mockSocket.leave).toHaveBeenCalledWith('video:DRONE-01');
  });
});
