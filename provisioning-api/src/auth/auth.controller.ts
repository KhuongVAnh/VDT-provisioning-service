import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ClaimDroneDto } from './dto/claim-drone.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Đăng ký tài khoản Phi công mới
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Đăng nhập tài khoản
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Lấy thông tin tài khoản đang đăng nhập + danh sách Drone được gán
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getProfile(user.id);
  }

  /**
   * Phi công tự nhận quyền quản lý (Claim) Drone bằng Device ID
   */
  @Post('claim-drone')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async claimDrone(@CurrentUser() user: any, @Body() dto: ClaimDroneDto) {
    return this.authService.claimDrone(user.id, dto.deviceId);
  }
}
