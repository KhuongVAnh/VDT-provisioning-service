import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { DeviceModule } from './device/device.module';
import { IpPoolModule } from './ip-pool/ip-pool.module';
import { WireguardModule } from './wireguard/wireguard.module';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { DashboardModule } from './dashboard/dashboard.module';

/**
 * AppModule là "bảng mạch chính" của toàn bộ hệ thống.
 * Mọi module tính năng độc lập (như Device, IpPool, Wireguard, Dashboard) đều được đăng ký tại đây.
 */
@Module({
  imports: [
    // Đọc file .env và nạp các biến môi trường
    ConfigModule.forRoot({ isGlobal: true }),
    // Kết nối CSDL SQLite
    PrismaModule,
    // Module quản lý thực thể thiết bị
    DeviceModule,
    // Module cấp phát IP nội bộ
    IpPoolModule,
    // Module giao tiếp với hệ điều hành (WireGuard)
    WireguardModule,
    // Module nghiệp vụ chính xử lý request từ Drone
    ProvisioningModule,
    // Module Dashboard quản trị thời gian thực
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
