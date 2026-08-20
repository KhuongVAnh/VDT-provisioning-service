import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  // 1. Khởi tạo ứng dụng NestJS dựa trên Express Application
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // 2. Kích hoạt ValidationPipe toàn cầu. 
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // 3. Cấu hình phục vụ file tĩnh cho giao diện SPA Dashboard tại thư mục public/
  app.useStaticAssets(join(process.cwd(), 'public'));
  
  // 4. Lấy cấu hình cổng lắng nghe từ file .env (mặc định là 10004)
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 10004;
  
  // 5. Mở cổng cho các request đi vào
  await app.listen(port);
  console.log(`=============================================================`);
  console.log(`  DRONE PROVISIONING & FLEET DASHBOARD IS RUNNING!           `);
  console.log(`  - Dashboard UI : http://localhost:${port}/                 `);
  console.log(`  - API Endpoint : http://localhost:${port}/api/v1/          `);
  console.log(`=============================================================`);
}
bootstrap();
