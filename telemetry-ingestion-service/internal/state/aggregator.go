package state

import (
	"sync"
	"time"

	"github.com/KhuongVAnh/telemetry-ingestion-service/internal/mavlink"
	"github.com/KhuongVAnh/telemetry-ingestion-service/pkg/models"
	"github.com/bluenviron/gomavlib/v3/pkg/message"
)

// StateAggregator quản lý và tổng hợp trạng thái tức thời (In-Memory State) của toàn bộ phi đội Drone
type StateAggregator struct {
	mu     sync.RWMutex
	states map[string]*models.TelemetryPayload
}

// NewStateAggregator khởi tạo bộ tổng hợp trạng thái phi đội
func NewStateAggregator() *StateAggregator {
	return &StateAggregator{
		states: make(map[string]*models.TelemetryPayload),
	}
}

// UpdateState nhận gói tin MAVLink mới, cập nhật vào thực thể trạng thái của Drone và trả về bản snapshot
func (s *StateAggregator) UpdateState(deviceID string, sysid uint8, vpnIP string, msg message.Message) (*models.TelemetryPayload, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	payload, exists := s.states[deviceID]
	if !exists {
		payload = &models.TelemetryPayload{
			DeviceID:  deviceID,
			SysID:     sysid,
			VpnIP:     vpnIP,
			Connected: true,
			Battery: models.BatteryInfo{
				Percentage: 100,
			},
			GPS: models.GpsInfo{
				FixType: 3,
			},
			FlightMode: "STABILIZE",
		}
		s.states[deviceID] = payload
	}

	// Cập nhật thông tin nhận dạng và dấu thời gian hoạt động tức thời
	payload.SysID = sysid
	payload.VpnIP = vpnIP
	nowMs := time.Now().UnixMilli()
	payload.Timestamp = nowMs
	payload.LastHeartbeat = nowMs
	payload.Connected = true

	// Giải mã nội dung gói tin
	modified := mavlink.DecodeMessage(msg, payload)

	// Tạo bản sao (clone) an toàn để trả về cho luồng xử lý khác mà không lo race condition
	snapshot := *payload
	return &snapshot, modified
}

// GetSnapshot lấy snapshot trạng thái của một drone cụ thể
func (s *StateAggregator) GetSnapshot(deviceID string) (*models.TelemetryPayload, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	payload, exists := s.states[deviceID]
	if !exists {
		return nil, false
	}
	snapshot := *payload
	return &snapshot, true
}

// CheckHeartbeats định kỳ quét và đánh dấu Disconnected cho các drone mất tín hiệu quá thời gian cho phép
func (s *StateAggregator) CheckHeartbeats(timeout time.Duration) []*models.TelemetryPayload {
	s.mu.Lock()
	defer s.mu.Unlock()

	nowMs := time.Now().UnixMilli()
	timeoutMs := timeout.Milliseconds()
	var disconnectedList []*models.TelemetryPayload

	for _, payload := range s.states {
		if payload.Connected && (nowMs-payload.Timestamp) > timeoutMs {
			payload.Connected = false
			snapshot := *payload
			disconnectedList = append(disconnectedList, &snapshot)
		}
	}
	return disconnectedList
}
