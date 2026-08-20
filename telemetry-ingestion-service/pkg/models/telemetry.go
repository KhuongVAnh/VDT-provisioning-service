package models

// BatteryInfo chứa thông tin nguồn điện và mức pin
type BatteryInfo struct {
	Percentage int32  `json:"percentage"` // % pin còn lại (0 - 100)
	VoltageMv  uint16 `json:"voltageMv"`  // Điện áp (mV)
	CurrentCa  int16  `json:"currentCa"`  // Dòng điện tiêu thụ (cA)
}

// GpsInfo chứa thông tin định vị vệ tinh GPS
type GpsInfo struct {
	FixType       uint8   `json:"fixType"`       // 0: No GPS, 2: 2D, 3: 3D Fix, 4: DGPS, 5: RTK Float, 6: RTK Fixed
	Satellites    uint8   `json:"satellites"`    // Số lượng vệ tinh bắt được
	Lat           float64 `json:"lat"`           // Vĩ độ (Degrees)
	Lon           float64 `json:"lon"`           // Kinh độ (Degrees)
	AltRelativeM  float64 `json:"altRelativeM"`  // Độ cao so với điểm cất cánh (mét)
	AltMslM       float64 `json:"altMslM"`       // Độ cao so với mực nước biển (mét)
	HeadingDeg    float64 `json:"headingDeg"`    // Hướng mũi drone (0 - 360 độ)
	GroundSpeedMs float64 `json:"groundSpeedMs"` // Tốc độ mặt đất (m/s)
}

// AttitudeInfo chứa góc nghiêng và tư thế không gian của phi cơ
type AttitudeInfo struct {
	RollDeg  float64 `json:"rollDeg"`  // Góc nghiêng ngang (-180 đến 180 độ)
	PitchDeg float64 `json:"pitchDeg"` // Góc chúc/ngóc (-90 đến 90 độ)
	YawDeg   float64 `json:"yawDeg"`   // Góc xoay hướng (0 đến 360 độ)
}

// VfrHudInfo chứa thông số buồng lái ảo HUD
type VfrHudInfo struct {
	AirspeedMs  float64 `json:"airspeedMs"`  // Tốc độ gió (m/s)
	ClimbRateMs float64 `json:"climbRateMs"` // Tốc độ nâng/hạ độ cao (m/s)
	ThrottlePct uint16  `json:"throttlePct"` // Mức ga động cơ (0 - 100%)
}

// TelemetryPayload là cấu trúc dữ liệu JSON tổng hợp của 1 drone gửi vào Redis
type TelemetryPayload struct {
	DeviceID      string       `json:"deviceId"`      // Mã định danh duy nhất (CPU Serial)
	SysID         uint8        `json:"sysid"`         // MAVLink System ID (1 - 255)
	VpnIP         string       `json:"vpnIp"`         // Địa chỉ IP VPN nội bộ (10.13.37.X)
	Connected     bool         `json:"connected"`     // Trạng thái kết nối (true nếu nhận heartbeat < 5s)
	Armed         bool         `json:"armed"`         // Trạng thái khóa/mở động cơ
	FlightMode    string       `json:"flightMode"`    // Chế độ bay (STABILIZE, LOITER, GUIDED, AUTO, RTL...)
	Battery       BatteryInfo  `json:"battery"`       // Thông số pin
	GPS           GpsInfo      `json:"gps"`           // Thông số GPS
	Attitude      AttitudeInfo `json:"attitude"`      // Thông số tư thế bay
	VfrHud        VfrHudInfo   `json:"vfrHud"`        // Thông số HUD
	LastHeartbeat int64        `json:"lastHeartbeat"` // Unix timestamp (ms) của heartbeat gần nhất
	Timestamp     int64        `json:"timestamp"`     // Unix timestamp (ms) lúc xử lý
}
