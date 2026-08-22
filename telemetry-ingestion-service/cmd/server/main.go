package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/KhuongVAnh/telemetry-ingestion-service/internal/config"
	"github.com/KhuongVAnh/telemetry-ingestion-service/internal/publisher"
	"github.com/KhuongVAnh/telemetry-ingestion-service/internal/resolver"
	"github.com/KhuongVAnh/telemetry-ingestion-service/internal/state"
	"github.com/bluenviron/gomavlib/v3"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
	"github.com/redis/go-redis/v9"
)

// extractIPFromChannel bóc tách địa chỉ IP nguồn từ mô tả Channel của gomavlib.
// Ví dụ: "udpserver(0.0.0.0:14551):10.13.37.2:54321" -> "10.13.37.2"
func extractIPFromChannel(chStr string) string {
	if idx := strings.LastIndex(chStr, "):"); idx != -1 {
		chStr = chStr[idx+2:]
	}
	chStr = strings.TrimPrefix(strings.TrimPrefix(chStr, "udp:"), "tcp:")
	if host, _, err := net.SplitHostPort(chStr); err == nil {
		return host
	}
	return chStr
}

func logChannelEvent(action, chStr string) {
	ip := extractIPFromChannel(chStr)
	if strings.HasPrefix(ip, "10.13.37.") {
		log.Printf("[NETWORK] 🚁 Drone %s: %s", action, chStr)
	} else {
		log.Printf("[NETWORK] 🖥️  GCS %s: %s", action, chStr)
	}
}

func main() {
	log.Println("=============================================================")
	log.Println("  DRONE TELEMETRY MAVLINK INGESTION SERVICE (GOLANG CORE)    ")
	log.Println("  [GCS ROUTER MODE] Thay thế mavlink-routerd hoàn toàn       ")
	log.Println("=============================================================")

	// 1. Đọc cấu hình hệ thống
	cfg := config.LoadConfig()
	log.Printf("[CONFIG] UDP lắng nghe Drone  : %s (Drone gửi thẳng lên cổng này)", cfg.UdpListenAddr)
	log.Printf("[CONFIG] TCP GCS Server       : 0.0.0.0:%s (cho QGroundControl/MP)", cfg.TcpGcsPort)
	log.Printf("[CONFIG] Redis Server         : %s (DB %d)", cfg.RedisAddr, cfg.RedisDB)

	// 2. Khởi tạo kết nối Redis
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})

	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Printf("[WARN] Không thể kết nối Redis (%s): %v. Dịch vụ sẽ tiếp tục và thử lại.", cfg.RedisAddr, err)
	} else {
		log.Println("[INFO] Kết nối Redis thành công!")
	}

	// 3. Khởi tạo các module nội bộ
	ipResolver := resolver.NewIPResolver(redisClient, cfg.VpnSubnetPrefix)
	stateAggregator := state.NewStateAggregator()
	redisPublisher := publisher.NewRedisPublisher(redisClient)
	defer redisPublisher.Close()

	log.Printf("[INFO] ✅ IP Resolver đã kích hoạt (VPN Subnet Prefix: %s)", cfg.VpnSubnetPrefix)

	// 4. Khởi tạo MAVLink Node đa Endpoint - thay thế hoàn toàn mavlink-routerd:
	tcpGcsAddr := fmt.Sprintf("0.0.0.0:%s", cfg.TcpGcsPort)

	node := &gomavlib.Node{
		Endpoints: []gomavlib.EndpointConf{
			// Endpoint 1: UDP Server lắng nghe trực tiếp từ Drone qua VPN (hoặc Local)
			gomavlib.EndpointUDPServer{
				Address: cfg.UdpListenAddr,
			},
			// Endpoint 2: TCP Server cho QGroundControl / Mission Planner kết nối vào
			gomavlib.EndpointTCPServer{
				Address: tcpGcsAddr,
			},
		},
		Dialect:     ardupilotmega.Dialect,
		OutVersion:  gomavlib.V2,
		OutSystemID: 250, // GCS System ID chuẩn
	}
	if err := node.Initialize(); err != nil {
		log.Fatalf("[FATAL] Không thể khởi tạo MAVLink Node: %v", err)
	}
	defer node.Close()

	log.Printf("[INFO] ✅ MAVLink Drone Receiver đang lắng nghe UDP tại: %s", cfg.UdpListenAddr)
	log.Printf("[INFO] ✅ MAVLink GCS TCP Server đang chạy tại: %s", tcpGcsAddr)
	log.Println("[INFO]    QGroundControl → Kết nối TCP → IP_VPS:10002")

	// 5. Goroutine chạy nền: Quét định kỳ kiểm tra mất Heartbeat (Drone Offline)
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				disconnectedDrones := stateAggregator.CheckHeartbeats(10 * time.Second)
				for _, drone := range disconnectedDrones {
					log.Printf("[HEARTBEAT] Cảnh báo: Drone %s (%s) bị mất tín hiệu quá 10s (Offline)!", drone.DeviceID, drone.VpnIP)
					_ = redisPublisher.PublishTelemetry(ctx, drone, time.Duration(cfg.StateTtlSeconds)*time.Second)
				}
			}
		}
	}()

	// 6. Goroutine chạy nền: Bắt tín hiệu Graceful Shutdown (Ctrl+C, SIGTERM)
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		log.Println("\n[SHUTDOWN] Nhận tín hiệu dừng dịch vụ, đang dọn dẹp tài nguyên...")
		cancel()
		node.Close()
	}()

	// Quản lý danh sách các Channel kết nối (phân biệt GCS TCP và Drone UDP)
	var (
		gcsChannels   sync.Map // key: *gomavlib.Channel, value: struct{}
		droneChannels sync.Map // key: *gomavlib.Channel, value: struct{}
	)

	// 7. Vòng lặp chính tiếp nhận và xử lý sự kiện MAVLink (Event Loop)
	for evt := range node.Events() {
		switch e := evt.(type) {
		case *gomavlib.EventFrame:
			isGCS := strings.Contains(e.Channel.String(), "tcp") || e.SystemID() == 255

			// 1. ĐỊNH TUYẾN 2 CHIỀU ĐỘC LẬP (CHỐNG FORWARD CHÉO GIỮA CÁC DRONE):
			if isGCS {
				// Nếu là Lệnh/Heartbeat từ GCS (QGroundControl / Mission Planner):
				// Chuyển tiếp xuống TẤT CẢ các Drone đang kết nối
				droneChannels.Range(func(key, _ interface{}) bool {
					ch := key.(*gomavlib.Channel)
					_ = node.WriteFrameTo(ch, e.Frame)
					return true
				})
				// Bỏ qua không phân tích telemetry từ GCS
				continue
			}

			// Nếu là Telemetry từ Drone (UDP):
			// Đảm bảo kênh Drone đã được lưu
			droneChannels.Store(e.Channel, struct{}{})

			// CHỈ chuyển tiếp gói tin sang các GCS đang kết nối (TCP 10002)
			// TUYỆT ĐỐI KHÔNG forward sang các Drone khác để tránh xung đột System ID / routing loop
			gcsChannels.Range(func(key, _ interface{}) bool {
				ch := key.(*gomavlib.Channel)
				_ = node.WriteFrameTo(ch, e.Frame)
				return true
			})

			// 2. Bỏ qua gói tin không hợp lệ hoặc Heartbeat từ GCS
			if e.SystemID() == 0 {
				continue
			}
			if hb, ok := e.Message().(*ardupilotmega.MessageHeartbeat); ok {
				if hb.Type == ardupilotmega.MAV_TYPE_GCS {
					continue
				}
			}

			// 3. Trích xuất địa chỉ IP nguồn từ Channel
			remoteIP := extractIPFromChannel(e.Channel.String())

			// 4. Tra cứu IP/SysID -> DeviceID (Bảo toàn IP nguồn 10.13.37.X qua WireGuard hoặc SystemID khi test qua Docker bridge/local)
			deviceID := ipResolver.Resolve(ctx, remoteIP, e.SystemID())

			// 5. Cập nhật và giải mã gói tin vào State Aggregator
			snapshot, modified := stateAggregator.UpdateState(deviceID, e.SystemID(), remoteIP, e.Message())

			// 6. Nếu gói tin làm thay đổi thông số quan trọng -> Đẩy ngay vào Redis Pub/Sub & Hash
			if modified {
				err := redisPublisher.PublishTelemetry(ctx, snapshot, time.Duration(cfg.StateTtlSeconds)*time.Second)
				if err != nil {
					log.Printf("[ERROR] Lỗi publish Telemetry vào Redis (%s): %v", deviceID, err)
				}
			}

		case *gomavlib.EventChannelOpen:
			isTCP := strings.Contains(e.Channel.String(), "tcp")
			if isTCP {
				gcsChannels.Store(e.Channel, struct{}{})
			} else {
				droneChannels.Store(e.Channel, struct{}{})
			}
			logChannelEvent("kết nối", e.Channel.String())

		case *gomavlib.EventChannelClose:
			gcsChannels.Delete(e.Channel)
			droneChannels.Delete(e.Channel)
			logChannelEvent("ngắt kết nối", e.Channel.String())
		}
	}

	log.Println("[SHUTDOWN] Go MAVLink Ingestion Service đã dừng an toàn.")
}
