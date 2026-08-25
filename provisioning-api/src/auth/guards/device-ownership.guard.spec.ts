import { Test, TestingModule } from '@nestjs/testing';
import { DeviceOwnershipGuard } from './device-ownership.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('DeviceOwnershipGuard', () => {
  let guard: DeviceOwnershipGuard;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      device: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceOwnershipGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get<DeviceOwnershipGuard>(DeviceOwnershipGuard);
  });

  function createMockContext(user: any, params: any = {}, query: any = {}, body: any = {}) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          params,
          query,
          body,
        }),
      }),
    } as any;
  }

  it('nên cho phép ADMIN truy cập bất kỳ Drone nào', async () => {
    const context = createMockContext({ id: 'admin-id', role: 'ADMIN' }, { deviceId: 'DRONE-999' });
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(prisma.device.findUnique).not.toHaveBeenCalled();
  });

  it('nên cho phép PILOT truy cập Drone do chính mình sở hữu', async () => {
    prisma.device.findUnique.mockResolvedValue({
      id: 'd-1',
      deviceId: 'DRONE-001',
      userId: 'pilot-1-id',
    });

    const context = createMockContext({ id: 'pilot-1-id', role: 'PILOT' }, { deviceId: 'DRONE-001' });
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('nên từ chối và ném ForbiddenException nếu PILOT cố tình truy cập Drone của người khác', async () => {
    prisma.device.findUnique.mockResolvedValue({
      id: 'd-2',
      deviceId: 'DRONE-002',
      userId: 'other-pilot-id',
    });

    const context = createMockContext({ id: 'pilot-1-id', role: 'PILOT' }, { deviceId: 'DRONE-002' });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('nên ném NotFoundException nếu Drone không tồn tại', async () => {
    prisma.device.findUnique.mockResolvedValue(null);

    const context = createMockContext({ id: 'pilot-1-id', role: 'PILOT' }, { deviceId: 'DRONE-UNKNOWN' });
    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
  });
});
