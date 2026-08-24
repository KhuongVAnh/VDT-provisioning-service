import { Module } from '@nestjs/common';
import { TelemetryGateway } from './telemetry.gateway';
import { MavlinkRelayGateway } from './mavlink-relay.gateway';
import { TelemetryService } from './telemetry.service';
import { TelemetryController } from './telemetry.controller';
import { DeviceModule } from '../device/device.module';

@Module({
  imports: [DeviceModule],
  controllers: [TelemetryController],
  providers: [TelemetryGateway, MavlinkRelayGateway, TelemetryService],
  exports: [TelemetryService, TelemetryGateway, MavlinkRelayGateway],
})
export class TelemetryModule {}
