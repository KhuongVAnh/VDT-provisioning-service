import { Module } from '@nestjs/common';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryService } from './telemetry.service';
import { TelemetryController } from './telemetry.controller';
import { DeviceModule } from '../device/device.module';

@Module({
  imports: [DeviceModule],
  controllers: [TelemetryController],
  providers: [TelemetryGateway, TelemetryService],
  exports: [TelemetryService, TelemetryGateway],
})
export class TelemetryModule {}
