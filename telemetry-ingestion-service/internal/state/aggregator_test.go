package state

import (
	"testing"
	"time"

	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
)

func TestStateAggregator(t *testing.T) {
	agg := NewStateAggregator()

	// 1. Cập nhật gói tin Heartbeat
	hbMsg := &ardupilotmega.MessageHeartbeat{
		BaseMode:   128,
		CustomMode: 4, // GUIDED
	}
	snapshot, modified := agg.UpdateState("DRONE-001", 1, "10.13.37.5", hbMsg)

	if !modified {
		t.Errorf("Kỳ vọng UpdateState trả về modified = true")
	}
	if snapshot.DeviceID != "DRONE-001" {
		t.Errorf("Kỳ vọng DeviceID = DRONE-001, thực tế: %s", snapshot.DeviceID)
	}
	if snapshot.FlightMode != "GUIDED" {
		t.Errorf("Kỳ vọng FlightMode = GUIDED, thực tế: %s", snapshot.FlightMode)
	}

	// 2. Cập nhật thêm tọa độ GPS
	gpsMsg := &ardupilotmega.MessageGlobalPositionInt{
		Lat:         210000000,
		Lon:         1050000000,
		RelativeAlt: 30000,
	}
	snapshot2, _ := agg.UpdateState("DRONE-001", 1, "10.13.37.5", gpsMsg)

	if snapshot2.GPS.Lat != 21.0 {
		t.Errorf("Kỳ vọng GPS Lat = 21.0, thực tế: %f", snapshot2.GPS.Lat)
	}
	// FlightMode từ heartbeat trước đó vẫn phải được giữ nguyên
	if snapshot2.FlightMode != "GUIDED" {
		t.Errorf("Kỳ vọng FlightMode vẫn được giữ là GUIDED")
	}

	// 3. Lấy snapshot riêng
	snap, found := agg.GetSnapshot("DRONE-001")
	if !found || snap.GPS.Lat != 21.0 {
		t.Errorf("Kỳ vọng GetSnapshot tìm thấy drone với Lat = 21.0")
	}

	// 4. Kiểm tra heartbeat timeout
	time.Sleep(10 * time.Millisecond)
	disconnected := agg.CheckHeartbeats(5 * time.Millisecond)
	if len(disconnected) != 1 {
		t.Errorf("Kỳ vọng 1 drone bị đánh dấu disconnected do quá timeout")
	}
	if disconnected[0].Connected {
		t.Errorf("Kỳ vọng Connected = false sau khi timeout")
	}
}
