package state

import (
	"testing"
	"time"

	"github.com/KhuongVAnh/telemetry-ingestion-service/pkg/models"
)

func TestDeadbandFilter(t *testing.T) {
	filter := NewDeadbandFilter()

	p1 := &models.TelemetryPayload{
		DeviceID:   "DRONE-1",
		Connected:  true,
		FlightMode: "STABILIZE",
		Armed:      false,
		GPS: models.GpsInfo{
			Lat:          21.00500,
			Lon:          105.84300,
			AltRelativeM: 50.0,
			HeadingDeg:   90.0,
		},
		Battery: models.BatteryInfo{
			Percentage: 90,
			VoltageMv:  12600,
		},
	}

	// Lần đầu tiên -> Bắt buộc phát
	if !filter.ShouldPublish(p1) {
		t.Errorf("Lần đầu phát hiện Drone phải trả về true")
	}

	// Gửi ngay lập tức dữ liệu y hệt sau 10ms -> Phải lọc bỏ (false)
	p2 := *p1
	if filter.ShouldPublish(&p2) {
		t.Errorf("Dữ liệu giống hệt trong 10ms phải bị lọc bỏ")
	}

	// Gửi sự kiện khẩn cấp: Armed = true -> Bắt buộc phát ngay lập tức (true)
	p3 := *p1
	p3.Armed = true
	if !filter.ShouldPublish(&p3) {
		t.Errorf("Sự kiện khẩn cấp Armed=true phải được phát ngay lập tức")
	}

	// Sau khi phát p3, chờ 300ms và thay đổi độ cao > 0.3m -> Phải phát
	time.Sleep(300 * time.Millisecond)
	p4 := p3
	p4.GPS.AltRelativeM = 50.5 // Delta = 0.5m > 0.3m
	if !filter.ShouldPublish(&p4) {
		t.Errorf("Độ cao biến thiên 0.5m sau 300ms phải được phát")
	}
}
