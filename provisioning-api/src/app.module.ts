import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { DeviceModule } from './device/device.module';
import { IpPoolModule } from './ip-pool/ip-pool.module';
import { WireguardModule } from './wireguard/wireguard.module';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { WebSshModule } from './web-ssh/web-ssh.module';

/**
 * AppModule là "bảng mạch chính" của toàn bộ hệ thống NestJS API Gateway & Mission Control.
 * Mọi module tính năng (Provisioning, Device, IP Pool, WireGuard, Dashboard, Redis, Telemetry, Web SSH)
 * đều được đăng ký và liên kết tại đây.
 */
@Module({
  imports: [
    // 1. Đọc file .env và nạp các biến môi trường toàn cục
    ConfigModule.forRoot({ isGlobal: true }),
    // 2. Kết nối CSDL SQLite / LibSQL
    PrismaModule,
    // 3. Kết nối Redis Server (Hashes & Pub/Sub)
    RedisModule,
    // 4. Module quản lý thực thể thiết bị Drone
    DeviceModule,
    // 5. Module quản lý cấp phát IP VPN nội bộ
    IpPoolModule,
    // 6. Module giao tiếp Linux Kernel WireGuard
    WireguardModule,
    // 7. Module nghiệp vụ cấp phát Zero-Touch Provisioning (Phase 1)
    ProvisioningModule,
    // 8. Module Dashboard quản trị chỉ số KPI & Đội bay
    DashboardModule,
    // 9. Module Telemetry Stream & WebSocket Gateway (Phase 2)
    TelemetryModule,
    // 10. Module Web-based SSH Terminal qua VPN IP (Phase 4)
    WebSshModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
