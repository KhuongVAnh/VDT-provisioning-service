import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { IpPoolModule } from './ip-pool/ip-pool.module';
import { WireguardModule } from './wireguard/wireguard.module';
import { ProvisioningModule } from './provisioning/provisioning.module';

/**
 * AppModule là "bảng mạch chính" của toàn bộ hệ thống.
 * Mọi module tính năng độc lập (như IpPool, Wireguard) đều phải được "cắm" vào đây để chạy.
 */
@Module({
  imports: [
    // Đọc file .env và nạp các biến môi trường
    ConfigModule.forRoot({ isGlobal: true }),
    // Kết nối CSDL SQLite
    PrismaModule,
    // Module cấp phát IP nội bộ
    IpPoolModule,
    // Module giao tiếp với hệ điều hành (WireGuard)
    WireguardModule,
    // Module nghiệp vụ chính xử lý request từ Drone
    ProvisioningModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
