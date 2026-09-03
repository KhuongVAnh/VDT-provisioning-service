import { Module } from '@nestjs/common';
import { IpPoolService } from './ip-pool.service';
import { DeviceModule } from '../device/device.module';

@Module({
  imports: [DeviceModule],
  providers: [IpPoolService],
  exports: [IpPoolService],
})
export class IpPoolModule {}
