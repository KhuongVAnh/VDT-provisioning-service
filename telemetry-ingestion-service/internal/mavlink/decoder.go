package mavlink

import (
	"math"

	"github.com/KhuongVAnh/telemetry-ingestion-service/pkg/models"
	"github.com/bluenviron/gomavlib/v3/pkg/dialect"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
	"github.com/bluenviron/gomavlib/v3/pkg/message"
)

var dialectRW, _ = dialect.NewReadWriter(ardupilotmega.Dialect)

// ArduCopterModeToString chuyển đổi mã Custom Mode của ArduPilot Copter sang tên hiển thị
func ArduCopterModeToString(customMode uint32) string {
	copterModes := map[uint32]string{
		0:  "STABILIZE",
		1:  "ACRO",
		2:  "ALT_HOLD",
		3:  "AUTO",
		4:  "GUIDED",
		5:  "LOITER",
		6:  "RTL",
		7:  "CIRCLE",
		9:  "LAND",
		11: "DRIFT",
		13: "SPORT",
		14: "FLIP",
		15: "AUTOTUNE",
		16: "POSHOLD",
		17: "BRAKE",
		18: "THROW",
		19: "AVOID_ADSB",
		20: "GUIDED_NOGPS",
		21: "SMART_RTL",
		22: "FLOWHOLD",
		23: "FOLLOW",
		24: "ZIGZAG",
		25: "SYSTEMID",
		26: "AUTOROTATE",
		27: "AUTO_RTL",
	}

	if name, ok := copterModes[customMode]; ok {
		return name
	}
	return "UNKNOWN"
}

// DecodeMessage bóc tách thông tin từ các bản tin MAVLink và cập nhật vào TelemetryPayload của drone
func DecodeMessage(msg message.Message, payload *models.TelemetryPayload) bool {
	// Nếu gomavlib trả về MessageRaw (chưa decode), giải mã sang message struct tương ứng
	if raw, ok := msg.(*message.MessageRaw); ok {
		if dialectRW != nil {
			if mrw := dialectRW.GetMessage(raw.ID); mrw != nil {
				// Thử đọc theo chuẩn V2 trước, nếu lỗi thử V1
				decoded, err := mrw.Read(raw, true)
				if err != nil {
					decoded, err = mrw.Read(raw, false)
				}
				if err == nil && decoded != nil {
					msg = decoded
				}
			}
		}
	}

	switch m := msg.(type) {
	// 1. Bản tin HEARTBEAT (#0): Trạng thái động cơ, Armed/Disarmed, Chế độ bay (Flight Mode)
	case *ardupilotmega.MessageHeartbeat:
		// Kiểm tra cờ MAV_MODE_FLAG_SAFETY_ARMED (bit thứ 7 = 128)
		payload.Armed = (m.BaseMode & 128) != 0
		payload.FlightMode = ArduCopterModeToString(m.CustomMode)
		payload.Connected = true
		return true

	// 2. Bản tin GLOBAL_POSITION_INT (#33): Tọa độ GPS độ chính xác cao, Độ cao và Vận tốc
	case *ardupilotmega.MessageGlobalPositionInt:
		payload.GPS.Lat = float64(m.Lat) / 1e7
		payload.GPS.Lon = float64(m.Lon) / 1e7
		payload.GPS.AltRelativeM = float64(m.RelativeAlt) / 1000.0 // mm -> mét
		payload.GPS.AltMslM = float64(m.Alt) / 1000.0             // mm -> mét

		// Tính toán hướng bay Heading (0 - 360 độ)
		if m.Hdg != 65535 {
			payload.GPS.HeadingDeg = float64(m.Hdg) / 100.0 // cdeg -> deg
		}

		// Tính toán tốc độ mặt đất GroundSpeed từ Vx (Bắc) và Vy (Đông)
		vx := float64(m.Vx) / 100.0 // cm/s -> m/s
		vy := float64(m.Vy) / 100.0
		payload.GPS.GroundSpeedMs = math.Round(math.Sqrt(vx*vx+vy*vy)*100) / 100
		return true

	// 3. Bản tin SYS_STATUS (#1): Thông số nguồn điện và dung lượng pin
	case *ardupilotmega.MessageSysStatus:
		payload.Battery.Percentage = int32(m.BatteryRemaining)
		payload.Battery.VoltageMv = m.VoltageBattery
		payload.Battery.CurrentCa = m.CurrentBattery
		return true

	// 4. Bản tin ATTITUDE (#30): Góc nghiêng không gian 3 chiều (Roll, Pitch, Yaw)
	case *ardupilotmega.MessageAttitude:
		// Đổi từ Radian sang Độ (Degrees) và làm tròn 1 chữ số thập phân
		payload.Attitude.RollDeg = math.Round(float64(m.Roll)*(180.0/math.Pi)*10) / 10
		payload.Attitude.PitchDeg = math.Round(float64(m.Pitch)*(180.0/math.Pi)*10) / 10
		yawDeg := float64(m.Yaw) * (180.0 / math.Pi)
		if yawDeg < 0 {
			yawDeg += 360.0
		}
		payload.Attitude.YawDeg = math.Round(yawDeg*10) / 10
		return true

	// 5. Bản tin VFR_HUD (#74): Thông số buồng lái ảo HUD
	case *ardupilotmega.MessageVfrHud:
		payload.VfrHud.AirspeedMs = math.Round(float64(m.Airspeed)*10) / 10
		payload.VfrHud.ClimbRateMs = math.Round(float64(m.Climb)*10) / 10
		payload.VfrHud.ThrottlePct = uint16(m.Throttle)
		return true

	// 6. Bản tin GPS_RAW_INT (#24): Trạng thái khóa vệ tinh GPS và tọa độ thô
	case *ardupilotmega.MessageGpsRawInt:
		payload.GPS.FixType = uint8(m.FixType)
		payload.GPS.Satellites = m.SatellitesVisible
		if m.Lat != 0 && m.Lon != 0 {
			payload.GPS.Lat = float64(m.Lat) / 1e7
			payload.GPS.Lon = float64(m.Lon) / 1e7
			payload.GPS.AltMslM = float64(m.Alt) / 1000.0
		}
		if m.Cog != 65535 {
			payload.GPS.HeadingDeg = float64(m.Cog) / 100.0
		}
		if m.Vel != 65535 {
			payload.GPS.GroundSpeedMs = math.Round((float64(m.Vel)/100.0)*100) / 100
		}
		return true
	}

	return false
}
