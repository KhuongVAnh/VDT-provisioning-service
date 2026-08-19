import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  // 1. Khởi tạo ứng dụng NestJS dựa trên AppModule (xương sống của hệ thống)
  const app = await NestFactory.create(AppModule);
  
  // 2. Kích hoạt ValidationPipe toàn cầu. 
  // Bất kỳ request nào gửi đến API không đúng định dạng quy định trong DTO sẽ bị từ chối ngay lập tức.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  
  // 3. Lấy cấu hình cổng lắng nghe từ file .env (mặc định là 10004)
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 10004;
  
  // 4. Bắt đầu mở cổng cho các request đi vào
  await app.listen(port);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
