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

// extractIPFromChannel bóc tách địa chỉ IP nguồn từ mô tả Channel của gomavlib
func extractIPFromChannel(chStr string) string {
	// chStr thường có dạng "udp:10.13.37.5:14550" hoặc "10.13.37.5:14550"
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
	log.Println("=============================================================")

	// 1. Đọc cấu hình hệ thống
	cfg := config.LoadConfig()
	log.Printf("[CONFIG] UDP Lắng nghe: %s", cfg.UdpListenAddr)
	log.Printf("[CONFIG] Redis Server : %s (DB %d)", cfg.RedisAddr, cfg.RedisDB)

	// 2. Khởi tạo kết nối Redis
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})

	// Kiểm tra kết nối Redis
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

	// 4. Khởi tạo MAVLink Ingestion Node lắng nghe qua UDP Socket
	node, err := gomavlib.NewNode(gomavlib.NodeConf{
		Endpoints: []gomavlib.EndpointConf{
			gomavlib.EndpointUDPServer{
				Address: cfg.UdpListenAddr,
			},
		},
		Dialect:     ardupilotmega.Dialect,
		OutVersion:  gomavlib.V2,
		OutSystemID: 250, // GCS / Ingestion Server ID
	})
	if err != nil {
		log.Fatalf("[FATAL] Không thể khởi tạo MAVLink UDP Server tại %s: %v", cfg.UdpListenAddr, err)
	}
	defer node.Close()

	log.Printf("[INFO] MAVLink Ingestion Service đang lắng nghe gói tin UDP tại %s...", cfg.UdpListenAddr)

	// 5. Goroutine chạy nền: Quét định kỳ kiểm tra mất Heartbeat (Drone Offline) và bắn sự kiện
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
			// 1. Trích xuất địa chỉ IP người gửi từ Channel String
			remoteIP := extractIPFromChannel(e.Channel.String())

			// 2. Tra cứu IP -> DeviceID
			deviceID := ipResolver.Resolve(ctx, remoteIP)

			// 3. Cập nhật và giải mã gói tin vào State Aggregator
			snapshot, modified := stateAggregator.UpdateState(deviceID, e.SystemID(), remoteIP, e.Message())

			// 4. Nếu gói tin làm thay đổi thông số quan trọng -> Đẩy ngay vào Redis
			if modified {
				err := redisPublisher.PublishTelemetry(ctx, snapshot, time.Duration(cfg.StateTtlSeconds)*time.Second)
				if err != nil {
					_ = fmt.Sprintf("Lỗi publish: %v", err)
				}
			}

		case *gomavlib.EventChannelOpen:
			log.Printf("[NETWORK] Kênh UDP mới được mở: %s", e.Channel.String())

		case *gomavlib.EventChannelClose:
			log.Printf("[NETWORK] Kênh UDP đã đóng: %s", e.Channel.String())
		}
	}

	log.Println("[SHUTDOWN] Go MAVLink Ingestion Service đã dừng an toàn.")
}
