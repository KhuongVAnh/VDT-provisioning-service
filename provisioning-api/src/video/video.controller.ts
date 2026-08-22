import { Controller, Get, Post, Patch, Delete, Options, Param, Req, Res, Headers } from '@nestjs/common';
import { VideoService } from './video.service';
import type { Request, Response } from 'express';

@Controller('api/v1/video')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  /**
   * Lấy toàn bộ thông tin các điểm cuối stream video của Drone (đều tập trung tại Port 10004)
   */
  @Get(':deviceId/stream-info')
  getStreamInfo(@Param('deviceId') deviceId: string, @Headers('host') hostHeader?: string) {
    const streamInfo = this.videoService.getStreamEndpoints(deviceId, hostHeader);
    return {
      status: 'success',
      data: streamInfo,
    };
  }

  /**
   * Proxy luồng HLS Master Playlist (index.m3u8) từ MediaMTX nội bộ
   */
  @Get(':deviceId/index.m3u8')
  getHlsPlaylist(
    @Param('deviceId') deviceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.videoService.proxyMediaRequest(deviceId, 'index.m3u8', req, res);
  }

  /**
   * Proxy luồng fMP4 / MP4 stream trực tiếp
   */
  @Get(':deviceId/live.mp4')
  getLiveMp4(
    @Param('deviceId') deviceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.videoService.proxyMediaRequest(deviceId, 'live.mp4', req, res);
  }

  /**
   * Proxy các file phân đoạn video HLS (.ts / .m4s / init.mp4)
   */
  @Get(':deviceId/:segmentFile')
  getMediaSegment(
    @Param('deviceId') deviceId: string,
    @Param('segmentFile') segmentFile: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.videoService.proxyMediaRequest(deviceId, segmentFile, req, res);
  }

  /**
   * Proxy bắt tay SDP WHEP WebRTC qua Port 10004
   */
  @Post(':deviceId/whep')
  postWhepOffer(
    @Param('deviceId') deviceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.videoService.proxyWhepRequest(deviceId, req, res);
  }

  @Patch(':deviceId/whep')
  patchWhep(
    @Param('deviceId') deviceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.videoService.proxyWhepRequest(deviceId, req, res);
  }

  @Delete(':deviceId/whep')
  deleteWhep(
    @Param('deviceId') deviceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.videoService.proxyWhepRequest(deviceId, req, res);
  }

  @Options(':deviceId/whep')
  optionsWhep(@Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Id, Range');
    res.status(204).end();
  }
}
