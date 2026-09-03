import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      device: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('nên khởi tạo AuthService thành công', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('nên đăng ký tài khoản phi công mới thành công', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'usr-1',
        email: 'pilot@gmail.com',
        fullName: 'Pilot Test',
        role: 'PILOT',
        createdAt: new Date(),
      });

      const result = await service.register({
        email: 'pilot@gmail.com',
        password: 'password123',
        fullName: 'Pilot Test',
      });

      expect(result.message).toBe('Đăng ký tài khoản thành công');
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.email).toBe('pilot@gmail.com');
      expect(result.user.role).toBe('PILOT');
    });

    it('nên ném lỗi ConflictException nếu email đã tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'usr-exists', email: 'pilot@gmail.com' });

      await expect(
        service.register({
          email: 'pilot@gmail.com',
          password: 'password123',
          fullName: 'Pilot Test',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('nên đăng nhập thành công với mật khẩu đúng', async () => {
      const passwordHash = await bcrypt.hash('admin123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'usr-admin',
        email: 'admin@gmail.com',
        fullName: 'Admin',
        role: 'ADMIN',
        passwordHash,
        devices: [],
      });

      const result = await service.login({
        email: 'admin@gmail.com',
        password: 'admin123',
      });

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.email).toBe('admin@gmail.com');
      expect(result.user.role).toBe('ADMIN');
    });

    it('nên ném lỗi UnauthorizedException nếu mật khẩu sai', async () => {
      const passwordHash = await bcrypt.hash('admin123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: 'usr-admin',
        email: 'admin@gmail.com',
        passwordHash,
        devices: [],
      });

      await expect(
        service.login({
          email: 'admin@gmail.com',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('claimDrone', () => {
    it('nên cho phép phi công claim Drone chưa có chủ sở hữu', async () => {
      prisma.device.findUnique.mockResolvedValue({
        deviceId: 'DRONE-001',
        userId: null,
      });
      prisma.device.update.mockResolvedValue({
        deviceId: 'DRONE-001',
        userId: 'usr-pilot-1',
        hardwareModel: 'X6',
        vpnIp: '10.13.37.2',
      });

      const result = await service.claimDrone('usr-pilot-1', 'DRONE-001');
      expect((result.device as any).userId).toBe('usr-pilot-1');
      expect(prisma.device.update).toHaveBeenCalledWith({
        where: { deviceId: 'DRONE-001' },
        data: { userId: 'usr-pilot-1' },
        select: expect.any(Object),
      });
    });

    it('nên ném lỗi ConflictException nếu Drone đã bị phi công khác claim', async () => {
      prisma.device.findUnique.mockResolvedValue({
        deviceId: 'DRONE-001',
        userId: 'other-pilot-id',
      });

      await expect(service.claimDrone('usr-pilot-1', 'DRONE-001')).rejects.toThrow(ConflictException);
    });

    it('nên ném lỗi NotFoundException nếu không tìm thấy Drone', async () => {
      prisma.device.findUnique.mockResolvedValue(null);

      await expect(service.claimDrone('usr-pilot-1', 'DRONE-NOT-FOUND')).rejects.toThrow(NotFoundException);
    });
  });
});
