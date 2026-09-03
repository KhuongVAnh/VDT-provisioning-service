import { Module } from '@nestjs/common';
import { WireguardService } from './wireguard.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [WireguardService],
  exports: [WireguardService],
})
export class WireguardModule {}
