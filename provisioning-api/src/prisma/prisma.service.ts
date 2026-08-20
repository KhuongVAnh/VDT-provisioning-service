import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    let dbUrl = process.env.DATABASE_URL || 'file:./data/provisioning.db';

    // Tự động tương thích đường dẫn SQLite cho cả Windows Local và Linux Docker
    if (dbUrl.startsWith('file:')) {
      let rawPath = dbUrl.replace(/^file:/, '');

      // Nếu đang chạy trên Windows và đường dẫn là /data/... -> chuyển thành thư mục ./data/... trong project
      if (process.platform === 'win32' && rawPath.startsWith('/data/')) {
        rawPath = path.join(process.cwd(), 'data', path.basename(rawPath));
      }

      // Đảm bảo thư mục cha luôn tồn tại
      const dir = path.dirname(path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath));
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
          // Bỏ qua nếu không thể tạo thư mục
        }
      }

      // Chuẩn hóa đường dẫn cho LibSQL SQLite
      const normalizedPath = rawPath.replace(/\\/g, '/');
      dbUrl = `file:${normalizedPath}`;
    }

    const adapter = new PrismaLibSql({ url: dbUrl });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    
    // Tự động tạo bảng Device nếu cơ sở dữ liệu mới tinh
    try {
      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "Device" (
          "id" TEXT PRIMARY KEY,
          "deviceId" TEXT UNIQUE NOT NULL,
          "hardwareModel" TEXT NOT NULL,
          "vpnIp" TEXT UNIQUE,
          "vpnPublicKey" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'PENDING',
          "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (err) {
      this.logger.debug(`Khởi tạo bảng SQLite: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
