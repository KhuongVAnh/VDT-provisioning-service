package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strings"
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
// Channel string thường có dạng: "udp:10.13.37.5:14550" hoặc "tcp:203.1.2.3:5760"
func extractIPFromChannel(chStr string) string {
	trimmed := strings.TrimPrefix(chStr, "udp:")
	trimmed = strings.TrimPrefix(trimmed, "tcp:")
	host, _, err := net.SplitHostPort(trimmed)
	if err == nil {
		return host
	}
	return trimmed
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
	ipResolver := resolver.NewIPResolver(redisClient)
	stateAggregator := state.NewStateAggregator()
	redisPublisher := publisher.NewRedisPublisher(redisClient)
	defer redisPublisher.Close()

	// 4. Khởi tạo MAVLink Node đa Endpoint - thay thế hoàn toàn mavlink-routerd:
	//
	//  ┌─────────────────────────────────────────────────────────────────────┐
	//  │ [Drone 10.13.37.2] ──UDP 14550──►                                  │
	//  │ [Drone 10.13.37.3] ──UDP 14550──► [GOLANG NODE] ──TCP 10002──►     │
	//  │ (IP nguồn được bảo toàn 100%)              [QGroundControl/MP]     │
	//  └─────────────────────────────────────────────────────────────────────┘
	//
	//  gomavlib tự động định tuyến (route) bản tin 2 chiều giữa tất cả Endpoint:
	//  - Gói tin từ Drone sẽ được bắn đến QGroundControl để hiển thị trên map
	//  - Lệnh điều khiển từ QGroundControl sẽ được bắn ngược xuống Drone tương ứng
	//
	tcpGcsAddr := fmt.Sprintf("0.0.0.0:%s", cfg.TcpGcsPort)

	node, err := gomavlib.NewNode(gomavlib.NodeConf{
		Endpoints: []gomavlib.EndpointConf{
			// Endpoint 1: UDP Server lắng nghe trực tiếp từ Drone qua VPN
			// QUAN TRỌNG: Bind vào 10.13.37.1 (WireGuard VPN interface IP trên VPS)
			// để đọc được đúng IP nguồn 10.13.37.X của từng Drone
			gomavlib.EndpointUDPServer{
				Address: cfg.UdpListenAddr,
			},
			// Endpoint 2: TCP Server cho QGroundControl / Mission Planner kết nối vào
			// Tương đương [General] TcpServerPort=10002 trong main.conf của mavlink-routerd
			gomavlib.EndpointTCPServer{
				Address: tcpGcsAddr,
			},
		},
		Dialect:     ardupilotmega.Dialect,
		OutVersion:  gomavlib.V2,
		OutSystemID: 250, // GCS System ID chuẩn (1-255, thường dùng 254 hoặc 250)
	})
	if err != nil {
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
				disconnectedDrones := stateAggregator.CheckHeartbeats(5 * time.Second)
				for _, drone := range disconnectedDrones {
					log.Printf("[HEARTBEAT] Cảnh báo: Drone %s (%s) bị mất tín hiệu Heartbeat!", drone.DeviceID, drone.VpnIP)
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

	// 7. Vòng lặp chính tiếp nhận và xử lý sự kiện MAVLink (Event Loop)
	for evt := range node.Events() {
		switch e := evt.(type) {
		case *gomavlib.EventFrame:
			// 1. Trích xuất địa chỉ IP nguồn từ Channel String
			//    Nếu gói tin từ Drone (qua UDP 10.13.37.X): remoteIP = "10.13.37.X" ✅
			//    Nếu gói tin từ QGroundControl (qua TCP): không xử lý Telemetry, chỉ route
			remoteIP := extractIPFromChannel(e.Channel.String())

			// 2. Chỉ xử lý Telemetry cho các gói tin đến từ Drone qua VPN (10.13.37.X)
			//    Bỏ qua gói tin từ QGroundControl (IP ngoài dải 10.13.37.X) để không lẫn dữ liệu
			if !strings.HasPrefix(remoteIP, "10.13.37.") {
				continue
			}

			// 3. Tra cứu IP -> DeviceID
			deviceID := ipResolver.Resolve(ctx, remoteIP)

			// 4. Cập nhật và giải mã gói tin vào State Aggregator
			snapshot, modified := stateAggregator.UpdateState(deviceID, e.SystemID(), remoteIP, e.Message())

			// 5. Nếu gói tin làm thay đổi thông số quan trọng -> Đẩy ngay vào Redis
			if modified {
				err := redisPublisher.PublishTelemetry(ctx, snapshot, time.Duration(cfg.StateTtlSeconds)*time.Second)
				if err != nil {
					log.Printf("[ERROR] Lỗi publish Telemetry vào Redis: %v", err)
				}
			}

		case *gomavlib.EventChannelOpen:
			remoteIP := extractIPFromChannel(e.Channel.String())
			if strings.HasPrefix(remoteIP, "10.13.37.") {
				log.Printf("[NETWORK] 🚁 Drone kết nối VPN: %s", e.Channel.String())
			} else {
				log.Printf("[NETWORK] 🖥️  GCS kết nối TCP: %s", e.Channel.String())
			}

		case *gomavlib.EventChannelClose:
			remoteIP := extractIPFromChannel(e.Channel.String())
			if strings.HasPrefix(remoteIP, "10.13.37.") {
				log.Printf("[NETWORK] 🚁 Drone ngắt kết nối: %s", e.Channel.String())
			} else {
				log.Printf("[NETWORK] 🖥️  GCS ngắt kết nối: %s", e.Channel.String())
			}
		}
	}

	log.Println("[SHUTDOWN] Go MAVLink Ingestion Service đã dừng an toàn.")
}
