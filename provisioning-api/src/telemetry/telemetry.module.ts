import { Module } from '@nestjs/common';
import { TelemetryGateway } from './telemetry.gateway';
import { MavlinkRelayGateway } from './mavlink-relay.gateway';
import { TelemetryService } from './telemetry.service';
import { TelemetryController } from './telemetry.controller';
import { DeviceModule } from '../device/device.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [DeviceModule, AuthModule, PrismaModule],
  controllers: [TelemetryController],
  providers: [TelemetryGateway, MavlinkRelayGateway, TelemetryService],
  exports: [TelemetryService, TelemetryGateway, MavlinkRelayGateway],
})
export class TelemetryModule {}
