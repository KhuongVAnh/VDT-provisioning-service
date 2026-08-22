package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/bluenviron/gomavlib/v3"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
	"github.com/redis/go-redis/v9"
)

// DroneAgent đại diện cho 1 Drone ảo được mô phỏng
type DroneAgent struct {
	DeviceID     string
	SysID        uint8
	VpnIP        string
	Node         *gomavlib.Node
	BaseLat      float64
	BaseLon      float64
	CurrentLat   float64
	CurrentLon   float64
	AltRelativeM float64
	HeadingDeg   float64
	SpeedMs      float64
	BatteryPct   int32
	AngleRad     float64
	RadiusM      float64
	FlightMode   uint32
	IsArmed      bool
}

func main() {
	numDrones := flag.Int("drones", 3, "Số lượng Drone ảo cần mô phỏng đồng thời")
	targetAddr := flag.String("target", "127.0.0.1:14551", "Địa chỉ UDP của Go Ingestion Service")
	redisAddr := flag.String("redis", "127.0.0.1:6380", "Địa chỉ Redis Server để đồng bộ ánh xạ IP")
	subnetPrefix := flag.String("subnet", "10.13.37.", "Tiền tố dải mạng VPN (ví dụ: 10.13.37.)")
	flag.Parse()

	log.Println("=============================================================")
	log.Println("     DRONE FLEET MAVLINK REAL-TIME FLIGHT SIMULATOR          ")
	log.Printf("     - Số Drone mô phỏng : %d phi cơ\n", *numDrones)
	log.Printf("     - Dải mạng VPN      : %sX\n", *subnetPrefix)
	log.Printf("     - Mục tiêu Ingest   : %s (UDP)\n", *targetAddr)
	log.Printf("     - Redis Server      : %s\n", *redisAddr)
	log.Println("=============================================================")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 1. Kết nối Redis để nạp ánh xạ IP -> DeviceID và SystemID -> DeviceID
	rdb := redis.NewClient(&redis.Options{Addr: *redisAddr})
	if err := rdb.Ping(ctx).Err(); err == nil {
		log.Println("[SIMULATOR] ✅ Đã kết nối Redis, tiến hành đồng bộ ánh xạ IP & SystemID...")
	} else {
		log.Printf("[SIMULATOR] ⚠️ Cảnh báo không kết nối được Redis (%s): %v. Ingestion Service sẽ dùng fallback IP/SysID.", *redisAddr, err)
	}

	// Tọa độ gốc trung tâm (Khu vực ĐHBK Hà Nội / HUST Campus)
	centerLat := 21.005512
	centerLon := 105.843120

	var agents []*DroneAgent

	for i := 1; i <= *numDrones; i++ {
		devID := fmt.Sprintf("DRONE-SIM-%04d", i)
		vpnIP := fmt.Sprintf("%s%d", *subnetPrefix, i+1) // 10.13.37.2, 10.13.37.3...
		sysID := uint8(i)

		// Đăng ký ánh xạ vào Redis (cả IP và SystemID)
		if rdb != nil {
			_ = rdb.HSet(ctx, "drone:ip_map", vpnIP, devID).Err()
			_ = rdb.HSet(ctx, "drone:sys_map", strconv.Itoa(int(sysID)), devID).Err()
		}

		node := &gomavlib.Node{
			Endpoints: []gomavlib.EndpointConf{
				gomavlib.EndpointUDPClient{
					Address: *targetAddr,
				},
			},
			Dialect:     ardupilotmega.Dialect,
			OutVersion:  gomavlib.V2,
			OutSystemID: sysID,
		}
		if err := node.Initialize(); err != nil {
			log.Fatalf("[SIMULATOR] Không thể khởi tạo UDP Client cho Drone %s: %v", devID, err)
		}

		agent := &DroneAgent{
			DeviceID:     devID,
			SysID:        sysID,
			VpnIP:        vpnIP,
			Node:         node,
			BaseLat:      centerLat + (rand.Float64()-0.5)*0.005,
			BaseLon:      centerLon + (rand.Float64()-0.5)*0.005,
			AltRelativeM: 30.0 + float64(i)*15.0,   // Độ cao từ 45m đến 90m
			SpeedMs:      8.0 + rand.Float64()*4.0, // Tốc độ 8-12 m/s
			BatteryPct:   98 - int32(i*2),
			AngleRad:     rand.Float64() * 2 * math.Pi,
			RadiusM:      150.0 + float64(i)*80.0, // Bán kính bay lượn tròn 150m - 300m
			FlightMode:   4,                       // 4 = GUIDED mode
			IsArmed:      true,
		}

		// Khởi chạy goroutine đọc sự kiện từ Node để nhận phản hồi từ QGroundControl
		go func(a *DroneAgent) {
			for evt := range a.Node.Events() {
				if frm, ok := evt.(*gomavlib.EventFrame); ok {
					// Nếu QGroundControl ping hoặc gửi lệnh, log nhẹ debug
					_ = frm
				}
			}
		}(agent)

		agents = append(agents, agent)
		log.Printf("[SIMULATOR] 🚁 Đã kích hoạt phi cơ: %s (SysID: %d, VPN IP: %s, Cao độ: %.1fm)", devID, sysID, vpnIP, agent.AltRelativeM)
	}

	// Bắt tín hiệu ngắt để đóng node an toàn
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Vòng lặp phát Telemetry tần số cao (10Hz) và tần số thấp (1Hz)
	ticker10Hz := time.NewTicker(100 * time.Millisecond)
	ticker1Hz := time.NewTicker(1 * time.Second)
	defer ticker10Hz.Stop()
	defer ticker1Hz.Stop()

	log.Println("[SIMULATOR] 🚀 Đang phát luồng Telemetry thời gian thực tới Ingestion Server...")

	for {
		select {
		case <-sigChan:
			log.Println("\n[SIMULATOR] Dừng phát mô phỏng Drone...")
			for _, a := range agents {
				a.Node.Close()
			}
			return

		// Gói tin tốc độ cao 10Hz: GPS Position, Attitude, VFR HUD
		case <-ticker10Hz.C:
			for _, a := range agents {
				// Cập nhật quỹ đạo bay hình tròn quanh tâm
				a.AngleRad += 0.035
				if a.AngleRad > 2*math.Pi {
					a.AngleRad -= 2 * math.Pi
				}

				latOffset := (a.RadiusM * math.Sin(a.AngleRad)) / 111320.0
				lonOffset := (a.RadiusM * math.Cos(a.AngleRad)) / (111320.0 * math.Cos(a.BaseLat*math.Pi/180.0))
				a.CurrentLat = a.BaseLat + latOffset
				a.CurrentLon = a.BaseLon + lonOffset

				// Hướng bay Heading tiếp tuyến với đường tròn
				headingRad := a.AngleRad + math.Pi/2
				headingDeg := headingRad * (180.0 / math.Pi)
				for headingDeg < 0 {
					headingDeg += 360
				}
				for headingDeg >= 360 {
					headingDeg -= 360
				}
				a.HeadingDeg = headingDeg

				// Góc nghiêng Roll nghiêng nhẹ khi vào cua (-12 độ)
				rollRad := -0.21
				pitchRad := -0.05

				// 1. Gửi bản tin GLOBAL_POSITION_INT (#33)
				_ = a.Node.WriteMessageAll(&ardupilotmega.MessageGlobalPositionInt{
					TimeBootMs:  uint32(time.Now().UnixMilli() % 10000000),
					Lat:         int32(a.CurrentLat * 1e7),
					Lon:         int32(a.CurrentLon * 1e7),
					Alt:         int32((a.AltRelativeM + 12.0) * 1000), // MSL alt (mm)
					RelativeAlt: int32(a.AltRelativeM * 1000),          // Relative alt (mm)
					Vx:          int16(a.SpeedMs * math.Sin(headingRad) * 100),
					Vy:          int16(a.SpeedMs * math.Cos(headingRad) * 100),
					Vz:          0,
					Hdg:         uint16(a.HeadingDeg * 100), // cdeg
				})

				// 2. Gửi bản tin ATTITUDE (#30)
				_ = a.Node.WriteMessageAll(&ardupilotmega.MessageAttitude{
					TimeBootMs: uint32(time.Now().UnixMilli() % 10000000),
					Roll:       float32(rollRad),
					Pitch:      float32(pitchRad),
					Yaw:        float32(headingRad),
				})

				// 3. Gửi bản tin VFR_HUD (#74)
				_ = a.Node.WriteMessageAll(&ardupilotmega.MessageVfrHud{
					Airspeed:    float32(a.SpeedMs + 0.5),
					Groundspeed: float32(a.SpeedMs),
					Heading:     int16(a.HeadingDeg),
					Throttle:    52,
					Alt:         float32(a.AltRelativeM),
					Climb:       0.1,
				})
			}

		// Gói tin tần số 1Hz: Heartbeat, Pin SysStatus, GPS Raw Fix
		case <-ticker1Hz.C:
			for _, a := range agents {
				if a.BatteryPct > 5 && rand.Float64() < 0.15 {
					a.BatteryPct--
				}

				// 1. Gửi bản tin HEARTBEAT (#0)
				_ = a.Node.WriteMessageAll(&ardupilotmega.MessageHeartbeat{
					Type:           ardupilotmega.MAV_TYPE_QUADROTOR,
					Autopilot:      ardupilotmega.MAV_AUTOPILOT_ARDUPILOTMEGA,
					BaseMode:       ardupilotmega.MAV_MODE_FLAG_SAFETY_ARMED,
					CustomMode:     a.FlightMode, // 4 = GUIDED
					SystemStatus:   ardupilotmega.MAV_STATE_ACTIVE,
					MavlinkVersion: 3,
				})

				// 2. Gửi bản tin SYS_STATUS (#1)
				_ = a.Node.WriteMessageAll(&ardupilotmega.MessageSysStatus{
					BatteryRemaining: int8(a.BatteryPct),
					VoltageBattery:   15400, // 15.4V (4S LiPo)
					CurrentBattery:   1250,  // 12.5A
				})

				// 3. Gửi bản tin GPS_RAW_INT (#24)
				_ = a.Node.WriteMessageAll(&ardupilotmega.MessageGpsRawInt{
					TimeUsec:          uint64(time.Now().UnixMicro()),
					FixType:           ardupilotmega.GPS_FIX_TYPE_3D_FIX,
					Lat:               int32(a.CurrentLat * 1e7),
					Lon:               int32(a.CurrentLon * 1e7),
					Alt:               int32((a.AltRelativeM + 12.0) * 1000),
					Eph:               120,
					Epv:               140,
					Vel:               uint16(a.SpeedMs * 100),
					Cog:               uint16(a.HeadingDeg * 100),
					SatellitesVisible: 16,
				})
			}
		}
	}
}
