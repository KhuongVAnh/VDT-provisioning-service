import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProvisioningController } from './provisioning.controller';
import { ProvisioningService } from './provisioning.service';
import { DeviceModule } from '../device/device.module';
import { IpPoolModule } from '../ip-pool/ip-pool.module';
import { WireguardModule } from '../wireguard/wireguard.module';

/**
 * Module Provisioning đóng vai trò như một gói (package) gom nhóm Controller và Service lại với nhau.
 * Nó kết nối DeviceModule, IpPoolModule và WireguardModule để thực hiện quy trình cấp phát thiết bị.
 */
@Module({
  imports: [ConfigModule, DeviceModule, IpPoolModule, WireguardModule],
  controllers: [ProvisioningController],
  providers: [ProvisioningService],
})
export class ProvisioningModule {}
