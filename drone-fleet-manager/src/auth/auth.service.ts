import { Injectable, UnauthorizedException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Đăng ký tài khoản Phi công mới (Mặc định Role: PILOT)
   */
  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException(`Email [${dto.email}] đã được đăng ký trong hệ thống.`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        role: 'PILOT',
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
      },
    });

    const accessToken = this.generateToken(user.id, user.email, user.role);

    this.logger.log(`👤 Phi công mới đã đăng ký: ${user.email} (${user.id})`);

    return {
      message: 'Đăng ký tài khoản thành công',
      accessToken,
      user,
      assignedDevices: [],
    };
  }

  /**
   * Đăng nhập tài khoản và cấp phát JWT Access Token
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        devices: {
          select: {
            deviceId: true,
            hardwareModel: true,
            vpnIp: true,
            status: true,
            lastSeen: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    const accessToken = this.generateToken(user.id, user.email, user.role);

    this.logger.log(`🔑 Người dùng đăng nhập thành công: ${user.email} [${user.role}]`);

    return {
      message: 'Đăng nhập thành công',
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      assignedDevices: user.role === 'ADMIN' ? 'ALL_FLEET' : user.devices,
    };
  }

  /**
   * Lấy thông tin tài khoản hiện tại kèm danh sách Drone sở hữu
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        devices: {
          select: {
            deviceId: true,
            hardwareModel: true,
            vpnIp: true,
            status: true,
            lastSeen: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy thông tin tài khoản');
    }

    // Nếu là ADMIN, lấy toàn bộ danh sách Drone trong hệ thống
    let fleet = user.devices;
    if (user.role === 'ADMIN') {
      fleet = await this.prisma.device.findMany({
        select: {
          deviceId: true,
          hardwareModel: true,
          vpnIp: true,
          status: true,
          lastSeen: true,
        },
      });
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      assignedDevices: fleet,
    };
  }

  /**
   * Phi công Claim (nhận quyền quản lý) một Drone vào tài khoản của mình bằng deviceId
   */
  async claimDrone(userId: string, deviceId: string) {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new NotFoundException(`Không tìm thấy Drone với mã định danh: ${deviceId}`);
    }

    // Kiểm tra xem Drone đã thuộc về phi công khác chưa
    if (device.userId && device.userId !== userId) {
      throw new ConflictException(`Drone [${deviceId}] hiện đã được quản lý bởi một tài khoản khác!`);
    }

    const updatedDevice = await this.prisma.device.update({
      where: { deviceId },
      data: { userId },
      select: {
        deviceId: true,
        hardwareModel: true,
        vpnIp: true,
        status: true,
        userId: true,
        updatedAt: true,
      },
    });

    this.logger.log(`🚁 Drone [${deviceId}] đã được gán thành công cho User [${userId}]`);

    return {
      message: `Đã thêm Drone ${deviceId} vào danh sách quản lý của bạn thành công`,
      device: updatedDevice,
    };
  }

  /**
   * Sinh chuỗi JWT Token có thời hạn 7 ngày
   */
  private generateToken(userId: string, email: string, role: string): string {
    return this.jwtService.sign({
      sub: userId,
      email,
      role,
    });
  }
}
