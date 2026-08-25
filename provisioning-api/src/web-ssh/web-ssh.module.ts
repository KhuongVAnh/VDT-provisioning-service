import { Module } from '@nestjs/common';
import { WebSshGateway } from './web-ssh.gateway';
import { WebSshService } from './web-ssh.service';
import { DeviceModule } from '../device/device.module';
import { RedisModule } from '../redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [DeviceModule, RedisModule, AuthModule, PrismaModule],
  providers: [WebSshGateway, WebSshService],
  exports: [WebSshService, WebSshGateway],
})
export class WebSshModule {}
