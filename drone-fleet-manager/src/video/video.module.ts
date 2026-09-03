import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { VideoGateway } from './video.gateway';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule, AuthModule, PrismaModule],
  controllers: [VideoController],
  providers: [VideoService, VideoGateway],
  exports: [VideoService, VideoGateway],
})
export class VideoModule {}
