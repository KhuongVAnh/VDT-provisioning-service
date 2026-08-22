import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';

export interface VideoStreamInfo {
  deviceId: string;
  streamPath: string;
  wsEndpoint: string;
  httpStreamUrl: string;
  hlsUrl: string;
  whepProxyUrl: string;
}

/**
 * VideoService chịu trách nhiệm quản lý và điều phối luồng Video từ MediaMTX nội bộ (127.0.0.1)
 * ra các kênh phân phối an toàn trên NestJS Gateway (Port 10004).
 */
@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  private readonly internalMtxHost: string;
  private readonly internalHlsPort: number;
  private readonly internalWhepPort: number;
  private readonly internalRtspPort: number;

  constructor(private readonly configService: ConfigService) {
    this.internalMtxHost = this.configService.get<string>('INTERNAL_MTX_HOST', '127.0.0.1');
    this.internalHlsPort = this.configService.get<number>('INTERNAL_MTX_HLS_PORT', 8888);
    this.internalWhepPort = this.configService.get<number>('INTERNAL_MTX_WHEP_PORT', 8889);
    this.internalRtspPort = this.configService.get<number>('INTERNAL_MTX_RTSP_PORT', 8554);
  }

  /**
   * Cung cấp thông tin đường dẫn kết nối video cho một Drone cụ thể.
   * Toàn bộ các URL trả về đều đi qua Port 10004 công khai duy nhất của Gateway.
   */
  getStreamEndpoints(deviceId: string, hostHeader?: string): VideoStreamInfo {
    const cleanId = deviceId.trim();
    const vpsPublicIp = this.configService.get<string>('VPS_PUBLIC_IP') || '127.0.0.1';
    const gatewayPort = this.configService.get<string>('PORT') || '10004';
    const serverHost = hostHeader || `${vpsPublicIp}:${gatewayPort}`;

    return {
      deviceId: cleanId,
      streamPath: `live/${cleanId}`,
      wsEndpoint: `ws://${serverHost}/socket.io/`,
      httpStreamUrl: `http://${serverHost}/api/v1/video/${cleanId}/live.mp4`,
      hlsUrl: `http://${serverHost}/api/v1/video/${cleanId}/index.m3u8`,
      whepProxyUrl: `http://${serverHost}/api/v1/video/${cleanId}/whep`,
    };
  }

  /**
   * Chuyển tiếp (Proxy) yêu cầu HTTP Stream hoặc file HLS từ MediaMTX nội bộ (127.0.0.1:8888)
   * trả về cho client trên Web Dashboard qua Port 10004.
   */
  proxyMediaRequest(deviceId: string, filePath: string, clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const cleanId = encodeURIComponent(deviceId.trim());
    const cleanPath = filePath.replace(/^\/+/, '');
    const queryIdx = clientReq.url ? clientReq.url.indexOf('?') : -1;
    const queryString = queryIdx !== -1 ? clientReq.url.substring(queryIdx) : '';
    const targetPath = (cleanPath ? `/live/${cleanId}/${cleanPath}` : `/live/${cleanId}/index.m3u8`) + queryString;

    const options: http.RequestOptions = {
      hostname: this.internalMtxHost,
      port: this.internalHlsPort,
      path: targetPath,
      method: clientReq.method || 'GET',
      headers: {
        ...clientReq.headers,
        host: `${this.internalMtxHost}:${this.internalHlsPort}`,
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      // Thiết lập CORS header để Web Dashboard gọi mượt mà
      clientRes.setHeader('Access-Control-Allow-Origin', '*');
      clientRes.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      clientRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

      if (proxyRes.statusCode) {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
      }
      proxyRes.pipe(clientRes, { end: true });
    });

    proxyReq.on('error', (err) => {
      this.logger.warn(`Lỗi Proxy Video từ MediaMTX nội bộ (${targetPath}): ${err.message}`);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({
          status: 'error',
          message: 'Drone chưa phát luồng video hoặc MediaMTX nội bộ chưa khởi chạy.',
        }));
      }
    });

    if (clientReq.method === 'POST' || clientReq.method === 'PUT' || clientReq.method === 'PATCH') {
      clientReq.pipe(proxyReq, { end: true });
    } else {
      proxyReq.end();
    }
  }

  /**
   * Chuyển tiếp (Proxy) yêu cầu WHEP SDP bắt tay WebRTC sang MediaMTX nội bộ (127.0.0.1:8889)
   */
  proxyWhepRequest(deviceId: string, clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const cleanId = encodeURIComponent(deviceId.trim());
    const targetPath = `/live/${cleanId}/whep`;

    const options: http.RequestOptions = {
      hostname: this.internalMtxHost,
      port: this.internalWhepPort,
      path: targetPath,
      method: clientReq.method || 'POST',
      headers: {
        ...clientReq.headers,
        host: `${this.internalMtxHost}:${this.internalWhepPort}`,
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      clientRes.setHeader('Access-Control-Allow-Origin', '*');
      clientRes.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, DELETE, OPTIONS');
      clientRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Id, Range');

      if (proxyRes.statusCode) {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
      }
      proxyRes.pipe(clientRes, { end: true });
    });

    proxyReq.on('error', (err) => {
      this.logger.warn(`Lỗi WHEP Proxy tới MediaMTX nội bộ (${targetPath}): ${err.message}`);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({
          status: 'error',
          message: 'Không thể kết nối tới MediaMTX WHEP nội bộ.',
        }));
      }
    });

    clientReq.pipe(proxyReq, { end: true });
  }
}
