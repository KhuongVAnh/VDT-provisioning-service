import { Module } from '@nestjs/common';
import { IpPoolService } from './ip-pool.service';

@Module({
  providers: [IpPoolService],
  exports: [IpPoolService],
})
export class IpPoolModule {}
