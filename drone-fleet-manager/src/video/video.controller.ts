import { Controller, Get, Post, Patch, Delete, Options, Param, Req, Res, Headers, UseGuards } from '@nestjs/common';
import { VideoService } from './video.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DeviceOwnershipGuard } from '../auth/guards/device-ownership.guard';
import type { Request, Response } from 'express';

@Controller('api/v1/video')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  /**
   * Lấy toàn bộ thông tin các điểm cuối stream video của Drone (Yêu cầu xác thực & quyền sở hữu)
   */
  @Get(':deviceId/stream-info')
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
  getStreamInfo(@Param('deviceId') deviceId: string, @Headers('host') hostHeader?: string) {
    const streamInfo = this.videoService.getStreamEndpoints(deviceId, hostHeader);
    return {
      status: 'success',
      data: streamInfo,
    };
  }

  /**
   * Proxy luồng HLS Master Playlist (index.m3u8) từ MediaMTX nội bộ (Kiểm tra quyền sở hữu)
   */
  @Get(':deviceId/index.m3u8')
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
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
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
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
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
  getMediaSegment(
    @Param('deviceId') deviceId: string,
    @Param('segmentFile') segmentFile: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.videoService.proxyMediaRequest(deviceId, segmentFile, req, res);
  }

  /**
   * Proxy bắt tay SDP WHEP WebRTC qua Port 10004 (Bảo mật tuyệt đối, chặn xem trộm FPV)
   */
  @Post(':deviceId/whep')
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
  postWhepOffer(
    @Param('deviceId') deviceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.videoService.proxyWhepRequest(deviceId, req, res);
  }

  @Patch(':deviceId/whep')
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
  patchWhep(
    @Param('deviceId') deviceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.videoService.proxyWhepRequest(deviceId, req, res);
  }

  @Delete(':deviceId/whep')
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Id, Range, Authorization');
    res.status(204).end();
  }
}
