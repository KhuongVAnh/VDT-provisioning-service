import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProvisioningController } from './provisioning.controller';
import { ProvisioningService } from './provisioning.service';
import { IpPoolModule } from '../ip-pool/ip-pool.module';
import { WireguardModule } from '../wireguard/wireguard.module';

/**
 * Module Provisioning đóng vai trò như một gói (package) gom nhóm Controller và Service lại với nhau.
 * Nếu nó cần sử dụng các tính năng khác (như IpPool, Wireguard), nó phải "import" chúng vào đây.
 */
@Module({
  imports: [ConfigModule, IpPoolModule, WireguardModule], // Nạp các Module phụ trợ
  controllers: [ProvisioningController], // Khai báo các Controller thuộc Module này
  providers: [ProvisioningService], // Khai báo các Service thực thi logic
})
export class ProvisioningModule {}
