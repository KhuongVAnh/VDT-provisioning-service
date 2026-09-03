import { Injectable, CanActivate, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * DeviceOwnershipGuard kiểm tra quyền sở hữu thiết bị Drone:
 * 1. Nếu là ADMIN -> Luôn có toàn quyền truy cập tất cả Drone.
 * 2. Nếu là PILOT -> Bắt buộc Device.userId === req.user.id.
 */
@Injectable()
export class DeviceOwnershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Yêu cầu xác thực tài khoản trước khi truy cập thiết bị');
    }

    // Quản trị viên ADMIN luôn có toàn quyền
    if (user.role === 'ADMIN') {
      return true;
    }

    // Lấy deviceId từ params, query hoặc body
    const deviceId =
      request.params?.deviceId ||
      request.params?.id ||
      request.query?.deviceId ||
      request.body?.deviceId;

    if (!deviceId) {
      return true; // Nếu endpoint không nhắm vào 1 Drone cụ thể thì bỏ qua cho handler xử lý
    }

    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      select: { id: true, deviceId: true, userId: true },
    });

    if (!device) {
      throw new NotFoundException(`Không tìm thấy thiết bị với mã định danh: ${deviceId}`);
    }

    if (device.userId !== user.id) {
      throw new ForbiddenException(`Quyền truy cập bị từ chối: Drone [${deviceId}] không thuộc quyền quản lý của tài khoản bạn`);
    }

    // Gắn thông tin device vào request để handler sau không cần truy vấn lại
    request.targetDevice = device;
    return true;
  }
}
