package mavlink

import (
	"testing"

	"github.com/KhuongVAnh/telemetry-ingestion-service/pkg/models"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
)

func TestDecodeHeartbeat(t *testing.T) {
	payload := &models.TelemetryPayload{}
	msg := &ardupilotmega.MessageHeartbeat{
		BaseMode:   128, // Armed
		CustomMode: 4,   // GUIDED
	}

	modified := DecodeMessage(msg, payload)
	if !modified {
		t.Errorf("Kỳ vọng DecodeMessage trả về true cho MessageHeartbeat")
	}
	if !payload.Armed {
		t.Errorf("Kỳ vọng Armed là true")
	}
	if payload.FlightMode != "GUIDED" {
		t.Errorf("Kỳ vọng FlightMode là GUIDED, thực tế: %s", payload.FlightMode)
	}
	if !payload.Connected {
		t.Errorf("Kỳ vọng Connected là true")
	}
}

func TestDecodeGlobalPositionInt(t *testing.T) {
	payload := &models.TelemetryPayload{}
	msg := &ardupilotmega.MessageGlobalPositionInt{
		Lat:         210055120, // 21.005512
		Lon:         1058431200, // 105.843120
		RelativeAlt: 45200,     // 45.2m
		Hdg:         13500,     // 135.0 deg
		Vx:          600,       // 6 m/s
		Vy:          800,       // 8 m/s -> Speed = 10 m/s
	}

	DecodeMessage(msg, payload)

	if payload.GPS.Lat != 21.005512 {
		t.Errorf("Kỳ vọng Lat = 21.005512, thực tế = %f", payload.GPS.Lat)
	}
	if payload.GPS.Lon != 105.843120 {
		t.Errorf("Kỳ vọng Lon = 105.843120, thực tế = %f", payload.GPS.Lon)
	}
	if payload.GPS.AltRelativeM != 45.2 {
		t.Errorf("Kỳ vọng AltRelativeM = 45.2, thực tế = %f", payload.GPS.AltRelativeM)
	}
	if payload.GPS.HeadingDeg != 135.0 {
		t.Errorf("Kỳ vọng HeadingDeg = 135.0, thực tế = %f", payload.GPS.HeadingDeg)
	}
	if payload.GPS.GroundSpeedMs != 10.0 {
		t.Errorf("Kỳ vọng GroundSpeedMs = 10.0, thực tế = %f", payload.GPS.GroundSpeedMs)
	}
}

func TestDecodeAttitude(t *testing.T) {
	payload := &models.TelemetryPayload{}
	msg := &ardupilotmega.MessageAttitude{
		Roll:  0.174533, // ~ 10 deg
		Pitch: -0.087266, // ~ -5 deg
		Yaw:   2.35619,  // ~ 135 deg
	}

	DecodeMessage(msg, payload)

	if payload.Attitude.RollDeg != 10.0 {
		t.Errorf("Kỳ vọng RollDeg = 10.0, thực tế = %f", payload.Attitude.RollDeg)
	}
	if payload.Attitude.PitchDeg != -5.0 {
		t.Errorf("Kỳ vọng PitchDeg = -5.0, thực tế = %f", payload.Attitude.PitchDeg)
	}
	if payload.Attitude.YawDeg != 135.0 {
		t.Errorf("Kỳ vọng YawDeg = 135.0, thực tế = %f", payload.Attitude.YawDeg)
	}
}

func TestDecodeSysStatus(t *testing.T) {
	payload := &models.TelemetryPayload{}
	msg := &ardupilotmega.MessageSysStatus{
		BatteryRemaining: 88,
		VoltageBattery:   15800,
		CurrentBattery:   1250,
	}

	DecodeMessage(msg, payload)

	if payload.Battery.Percentage != 88 {
		t.Errorf("Kỳ vọng Battery Percentage = 88, thực tế = %d", payload.Battery.Percentage)
	}
	if payload.Battery.VoltageMv != 15800 {
		t.Errorf("Kỳ vọng VoltageMv = 15800, thực tế = %d", payload.Battery.VoltageMv)
	}
}

func TestDecodeGpsRawInt(t *testing.T) {
	payload := &models.TelemetryPayload{}
	msg := &ardupilotmega.MessageGpsRawInt{
		FixType:           ardupilotmega.GPS_FIX_TYPE_3D_FIX,
		SatellitesVisible: 14,
		Lat:               210055120, // 21.005512
		Lon:               1058431200, // 105.843120
		Alt:               55400,     // 55.4m MSL
		Cog:               13500,     // 135.0 deg
		Vel:               850,       // 8.5 m/s
	}

	modified := DecodeMessage(msg, payload)
	if !modified {
		t.Errorf("Kỳ vọng DecodeMessage trả về true cho MessageGpsRawInt")
	}
	if payload.GPS.FixType != 3 {
		t.Errorf("Kỳ vọng FixType = 3, thực tế = %d", payload.GPS.FixType)
	}
	if payload.GPS.Satellites != 14 {
		t.Errorf("Kỳ vọng Satellites = 14, thực tế = %d", payload.GPS.Satellites)
	}
	if payload.GPS.Lat != 21.005512 {
		t.Errorf("Kỳ vọng Lat = 21.005512, thực tế = %f", payload.GPS.Lat)
	}
	if payload.GPS.Lon != 105.843120 {
		t.Errorf("Kỳ vọng Lon = 105.843120, thực tế = %f", payload.GPS.Lon)
	}
	if payload.GPS.AltMslM != 55.4 {
		t.Errorf("Kỳ vọng AltMslM = 55.4, thực tế = %f", payload.GPS.AltMslM)
	}
	if payload.GPS.HeadingDeg != 135.0 {
		t.Errorf("Kỳ vọng HeadingDeg = 135.0, thực tế = %f", payload.GPS.HeadingDeg)
	}
	if payload.GPS.GroundSpeedMs != 8.5 {
		t.Errorf("Kỳ vọng GroundSpeedMs = 8.5, thực tế = %f", payload.GPS.GroundSpeedMs)
	}
}

func TestDecodeMessageRaw(t *testing.T) {
	// Encode GlobalPositionInt sang MessageRaw
	gpsMsg := &ardupilotmega.MessageGlobalPositionInt{
		Lat:         210055120, // 21.005512
		Lon:         1058431200, // 105.843120
		RelativeAlt: 45000,     // 45m
		Alt:         60000,     // 60m MSL
		Hdg:         9000,      // 90 deg
		Vx:          300,       // 3 m/s
		Vy:          400,       // 4 m/s
	}

	mrw := dialectRW.GetMessage(gpsMsg.GetID())
	if mrw == nil {
		t.Fatalf("Không tìm thấy readwriter cho message 33")
	}

	raw := mrw.Write(gpsMsg, true)
	if raw == nil {
		t.Fatalf("Không thể encode sang MessageRaw")
	}

	payload := &models.TelemetryPayload{}
	modified := DecodeMessage(raw, payload)

	if !modified {
		t.Fatalf("Kỳ vọng DecodeMessage trả về true cho MessageRaw id 33")
	}
	if payload.GPS.Lat != 21.005512 {
		t.Errorf("Kỳ vọng Lat = 21.005512, thực tế = %f", payload.GPS.Lat)
	}
	if payload.GPS.AltRelativeM != 45.0 {
		t.Errorf("Kỳ vọng AltRelativeM = 45.0, thực tế = %f", payload.GPS.AltRelativeM)
	}
	if payload.GPS.GroundSpeedMs != 5.0 {
		t.Errorf("Kỳ vọng GroundSpeedMs = 5.0, thực tế = %f", payload.GPS.GroundSpeedMs)
	}
}
