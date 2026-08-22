package main

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/KhuongVAnh/telemetry-ingestion-service/internal/publisher"
	"github.com/KhuongVAnh/telemetry-ingestion-service/internal/resolver"
	"github.com/KhuongVAnh/telemetry-ingestion-service/internal/state"
	"github.com/bluenviron/gomavlib/v3"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
)

func TestFullIngestionPipeline(t *testing.T) {
	// Tìm cổng UDP tự do
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Không thể mở UDP port: %v", err)
	}
	serverAddr := pc.LocalAddr().String()
	pc.Close()

	// 1. Khởi tạo Ingestion Server Node
	serverNode := &gomavlib.Node{
		Endpoints: []gomavlib.EndpointConf{
			gomavlib.EndpointUDPServer{
				Address: serverAddr,
			},
		},
		Dialect:     ardupilotmega.Dialect,
		OutVersion:  gomavlib.V2,
		OutSystemID: 250,
	}
	if err := serverNode.Initialize(); err != nil {
		t.Fatalf("Không thể tạo server node: %v", err)
	}
	defer serverNode.Close()

	ipResolver := resolver.NewIPResolver(nil, "10.13.37.")
	stateAggregator := state.NewStateAggregator()
	redisPublisher := publisher.NewRedisPublisher(nil)

	// 2. Khởi tạo Simulator Client Node
	clientNode := &gomavlib.Node{
		Endpoints: []gomavlib.EndpointConf{
			gomavlib.EndpointUDPClient{
				Address: serverAddr,
			},
		},
		Dialect:     ardupilotmega.Dialect,
		OutVersion:  gomavlib.V2,
		OutSystemID: 1,
	}
	if err := clientNode.Initialize(); err != nil {
		t.Fatalf("Không thể tạo client node: %v", err)
	}
	defer clientNode.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	receivedCh := make(chan bool, 10)

	// Vòng lặp Server
	go func() {
		for evt := range serverNode.Events() {
			if e, ok := evt.(*gomavlib.EventFrame); ok {
				if e.SystemID() == 255 || e.SystemID() == 0 {
					continue
				}
				deviceID := ipResolver.Resolve(ctx, "127.0.0.1", e.SystemID())
				snapshot, modified := stateAggregator.UpdateState(deviceID, e.SystemID(), "127.0.0.1", e.Message())
				if modified {
					_ = redisPublisher.PublishTelemetry(ctx, snapshot, 30*time.Second)
					t.Logf("Server đã giải mã thành công gói tin %T từ %s (Lat: %f, Alt: %f)",
						e.Message(), deviceID, snapshot.GPS.Lat, snapshot.GPS.AltRelativeM)
					receivedCh <- true
				}
			}
		}
	}()

	// 3. Client gửi bản tin Heartbeat và GlobalPositionInt
	time.Sleep(100 * time.Millisecond)

	err = clientNode.WriteMessageAll(&ardupilotmega.MessageHeartbeat{
		Type:           ardupilotmega.MAV_TYPE_QUADROTOR,
		Autopilot:      ardupilotmega.MAV_AUTOPILOT_ARDUPILOTMEGA,
		BaseMode:       ardupilotmega.MAV_MODE_FLAG_SAFETY_ARMED,
		CustomMode:     4,
		SystemStatus:   ardupilotmega.MAV_STATE_ACTIVE,
		MavlinkVersion: 3,
	})
	if err != nil {
		t.Fatalf("Lỗi gửi Heartbeat: %v", err)
	}

	err = clientNode.WriteMessageAll(&ardupilotmega.MessageGlobalPositionInt{
		TimeBootMs:  1000,
		Lat:         210055120,
		Lon:         1058431200,
		Alt:         55000,
		RelativeAlt: 45000,
		Vx:          300,
		Vy:          400,
		Hdg:         9000,
	})
	if err != nil {
		t.Fatalf("Lỗi gửi GlobalPositionInt: %v", err)
	}

	// Chờ nhận đủ 2 bản tin
	receivedCount := 0
	timeout := time.After(2 * time.Second)

	for receivedCount < 2 {
		select {
		case <-receivedCh:
			receivedCount++
		case <-timeout:
			t.Fatalf("Timeout! Chỉ nhận được %d/2 gói tin", receivedCount)
		}
	}

	snap, found := stateAggregator.GetSnapshot("DRONE-SYS-01")
	if !found {
		t.Fatalf("Không tìm thấy snapshot cho DRONE-SYS-01")
	}
	if snap.GPS.Lat != 21.005512 {
		t.Errorf("Kỳ vọng Lat = 21.005512, thực tế = %f", snap.GPS.Lat)
	}
	if snap.GPS.AltRelativeM != 45.0 {
		t.Errorf("Kỳ vọng Alt = 45.0, thực tế = %f", snap.GPS.AltRelativeM)
	}
}
