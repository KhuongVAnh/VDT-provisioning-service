package state

import (
	"math"
	"sync"
	"time"

	"github.com/KhuongVAnh/telemetry-ingestion-service/pkg/models"
)

// DeadbandFilter quản lý lọc biến thiên Telemetry và giới hạn tần số phát (Deadband & Rate Limiting)
type DeadbandFilter struct {
	mu           sync.Mutex
	lastSent     map[string]*models.TelemetryPayload
	lastSentTime map[string]time.Time

	// Ngưỡng lọc biến thiên
	minDistanceM  float64 // 0.5 mét
	minAltM       float64 // 0.3 mét
	minHeadingDeg float64 // 2.0 độ
	minAngleDeg   float64 // 1.5 độ (Roll/Pitch)
	minBatteryPct int     // 1%
	minVoltageMv  uint16  // 100 mV (0.1V)
	minSpeedMs    float64 // 0.5 m/s

	minInterval time.Duration // 250ms (Khống chế tần số tối đa 4Hz)
	maxInterval time.Duration // 2s (Heartbeat Liveness bắt buộc)
}

// NewDeadbandFilter khởi tạo bộ lọc Deadband
func NewDeadbandFilter() *DeadbandFilter {
	return &DeadbandFilter{
		lastSent:      make(map[string]*models.TelemetryPayload),
		lastSentTime:  make(map[string]time.Time),
		minDistanceM:  0.5,
		minAltM:       0.3,
		minHeadingDeg: 2.0,
		minAngleDeg:   1.5,
		minBatteryPct: 1,
		minVoltageMv:  100, // 100 mV = 0.1V
		minSpeedMs:    0.5,
		minInterval:   250 * time.Millisecond,
		maxInterval:   2 * time.Second,
	}
}

// ShouldPublish kiểm tra xem snapshot mới có vượt qua ngưỡng biến thiên (hoặc sự kiện khẩn cấp) để phát hay không
func (f *DeadbandFilter) ShouldPublish(snapshot *models.TelemetryPayload) bool {
	if snapshot == nil || snapshot.DeviceID == "" {
		return false
	}

	f.mu.Lock()
	defer f.mu.Unlock()

	last, exists := f.lastSent[snapshot.DeviceID]
	lastTime := f.lastSentTime[snapshot.DeviceID]
	now := time.Now()

	// 1. Nếu là lần đầu tiên phát hiện Drone -> BẮN NGAY
	if !exists || last == nil {
		f.markSent(snapshot, now)
		return true
	}

	// 2. SỰ KIỆN KHẨN CẤP (CRITICAL EVENTS) -> BẮN NGAY LẬP TỨC (Bỏ qua rate limit):
	// - Đổi chế độ bay (flightMode)
	// - Chuyển trạng thái động cơ (armed)
	// - Mất kết nối hoặc có kết nối lại (connected)
	// - Thay đổi GPS Fix Type
	if snapshot.FlightMode != last.FlightMode ||
		snapshot.Armed != last.Armed ||
		snapshot.Connected != last.Connected ||
		snapshot.GPS.FixType != last.GPS.FixType {
		f.markSent(snapshot, now)
		return true
	}

	// 3. Khống chế tần số tối đa (Rate Limit: không phát nhanh hơn minInterval)
	if now.Sub(lastTime) < f.minInterval {
		return false
	}

	// 4. HEARTBEAT LIVENESS: Nếu đã quá maxInterval (2s) chưa gửi gói nào -> BẮT BUỘC PHÁT để báo Drone còn Online
	if now.Sub(lastTime) >= f.maxInterval {
		f.markSent(snapshot, now)
		return true
	}

	// 5. KIỂM TRA NGƯỠNG BIẾN THIÊN (DEADBAND THRESHOLDS):
	// A. Khoảng cách GPS
	distM := haversineDistance(last.GPS.Lat, last.GPS.Lon, snapshot.GPS.Lat, snapshot.GPS.Lon)
	if distM >= f.minDistanceM {
		f.markSent(snapshot, now)
		return true
	}

	// B. Độ cao tương đối
	if math.Abs(snapshot.GPS.AltRelativeM-last.GPS.AltRelativeM) >= f.minAltM {
		f.markSent(snapshot, now)
		return true
	}

	// C. Vận tốc mặt đất
	if math.Abs(snapshot.GPS.GroundSpeedMs-last.GPS.GroundSpeedMs) >= f.minSpeedMs {
		f.markSent(snapshot, now)
		return true
	}

	// D. Góc hướng mũi tên la bàn (Heading)
	if headingDiff(last.GPS.HeadingDeg, snapshot.GPS.HeadingDeg) >= f.minHeadingDeg {
		f.markSent(snapshot, now)
		return true
	}

	// E. Góc nghiêng Attitude (Roll / Pitch)
	if math.Abs(snapshot.Attitude.RollDeg-last.Attitude.RollDeg) >= f.minAngleDeg ||
		math.Abs(snapshot.Attitude.PitchDeg-last.Attitude.PitchDeg) >= f.minAngleDeg {
		f.markSent(snapshot, now)
		return true
	}

	// F. Dung lượng pin & Điện áp
	if int(math.Abs(float64(snapshot.Battery.Percentage-last.Battery.Percentage))) >= f.minBatteryPct ||
		int(math.Abs(float64(int(snapshot.Battery.VoltageMv)-int(last.Battery.VoltageMv)))) >= int(f.minVoltageMv) {
		f.markSent(snapshot, now)
		return true
	}

	// Không có biến thiên đáng kể -> Lọc bỏ để giảm tải cho Redis và CPU
	return false
}

func (f *DeadbandFilter) markSent(snapshot *models.TelemetryPayload, now time.Time) {
	clone := *snapshot
	f.lastSent[snapshot.DeviceID] = &clone
	f.lastSentTime[snapshot.DeviceID] = now
}

// haversineDistance tính khoảng cách mặt đất giữa 2 tọa độ GPS (đơn vị: mét)
func haversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	if lat1 == 0 && lon1 == 0 && lat2 == 0 && lon2 == 0 {
		return 0
	}
	const R = 6371000.0 // Bán kính trái đất (mét)
	dLat := (lat2 - lat1) * (math.Pi / 180.0)
	dLon := (lon2 - lon1) * (math.Pi / 180.0)
	lat1Rad := lat1 * (math.Pi / 180.0)
	lat2Rad := lat2 * (math.Pi / 180.0)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Sin(dLon/2)*math.Sin(dLon/2)*math.Cos(lat1Rad)*math.Cos(lat2Rad)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

// headingDiff tính độ lệch góc la bàn ngắn nhất (0 - 180 độ)
func headingDiff(h1, h2 float64) float64 {
	diff := math.Abs(h1 - h2)
	if diff > 180 {
		diff = 360 - diff
	}
	return diff
}
