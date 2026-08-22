import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { VideoGateway } from './video.gateway';

@Module({
  imports: [ConfigModule],
  controllers: [VideoController],
  providers: [VideoService, VideoGateway],
  exports: [VideoService, VideoGateway],
})
export class VideoModule {}
