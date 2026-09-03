import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DeviceModule } from '../device/device.module';
import { IpPoolModule } from '../ip-pool/ip-pool.module';
import { WireguardModule } from '../wireguard/wireguard.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [DeviceModule, IpPoolModule, WireguardModule, RedisModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
