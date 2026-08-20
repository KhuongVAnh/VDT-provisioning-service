import { Module } from '@nestjs/common';
import { WebSshGateway } from './web-ssh.gateway';
import { WebSshService } from './web-ssh.service';
import { DeviceModule } from '../device/device.module';

@Module({
  imports: [DeviceModule],
  providers: [WebSshGateway, WebSshService],
  exports: [WebSshService, WebSshGateway],
})
export class WebSshModule {}
