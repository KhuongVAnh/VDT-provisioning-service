package main

import (
	"bytes"
	"context"
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
	"github.com/bluenviron/gomavlib/v3/pkg/dialect"
	"github.com/bluenviron/gomavlib/v3/pkg/dialects/ardupilotmega"
	"github.com/bluenviron/gomavlib/v3/pkg/frame"
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
	log.Printf("[NETWORK] 🚁 Drone %s: %s (IP: %s)", action, chStr, ip)
}

func main() {
	log.Println("=============================================================")
	log.Println("  DRONE TELEMETRY MAVLINK INGESTION SERVICE (GOLANG CORE)    ")
	log.Println("=============================================================")

	// 1. Đọc cấu hình hệ thống
	cfg := config.LoadConfig()
	log.Printf("[CONFIG] UDP lắng nghe Drone  : %s (Drone gửi thẳng lên cổng này)", cfg.UdpListenAddr)
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
	deadbandFilter := state.NewDeadbandFilter(cfg.MaxPublishRateHz)
	redisPublisher := publisher.NewRedisPublisher(redisClient)
	defer redisPublisher.Close()

	log.Printf("[INFO] ✅ IP Resolver đã kích hoạt (VPN Subnet Prefix: %s)", cfg.VpnSubnetPrefix)
	log.Printf("[INFO] ✅ Telemetry Filter đã kích hoạt (Tần số Focus tối đa: %dHz / %dms, Tiết kiệm 90%% tải)", cfg.MaxPublishRateHz, 1000/cfg.MaxPublishRateHz)

	// 4. Khởi tạo MAVLink Node lắng nghe UDP trực tiếp từ Drone:
	node := &gomavlib.Node{
		Endpoints: []gomavlib.EndpointConf{
			// UDP Server lắng nghe trực tiếp từ Drone qua VPN (hoặc Local)
			gomavlib.EndpointUDPServer{
				Address: cfg.UdpListenAddr,
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

	// 4b. Khởi tạo MAVLink Frame Serializer (tuần tự hóa Frame thành raw bytes để bắn vào Redis)
	dialectRW := &dialect.ReadWriter{
		Dialect: ardupilotmega.Dialect,
	}
	if err := dialectRW.Initialize(); err != nil {
		log.Fatalf("[FATAL] Không thể khởi tạo MAVLink Dialect ReadWriter: %v", err)
	}
	frameBuf := bytes.NewBuffer(make([]byte, 0, 512))
	frameWriter := &frame.Writer{
		ByteWriter: frameBuf,
		DialectRW:  dialectRW,
	}
	if err := frameWriter.Initialize(); err != nil {
		log.Fatalf("[FATAL] Không thể khởi tạo MAVLink Frame Writer: %v", err)
	}

	log.Printf("[INFO] ✅ MAVLink Drone Receiver đang lắng nghe UDP tại: %s", cfg.UdpListenAddr)

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
					// bắn gói tin đã đổi trạng thái sang offline kèm trạng thái cuối cùng của nó vào chan của redisPublisher (định kỳ 20ms gửi đi 1 lần)
					_ = redisPublisher.PublishTelemetry(ctx, drone, time.Duration(cfg.StateTtlSeconds)*time.Second)
				}
			}
		}
	}()

	// Quản lý danh sách các Channel kết nối UDP từ Drone
	var droneChannels sync.Map // key: *gomavlib.Channel, value: time.Time (Dấu thời gian nhận gói tin cuối cùng)

	// 5b. Goroutine chạy nền: Quét định kỳ dọn dẹp các UDP Channel không hoạt động (Inactive UDP Channel Pruner)
	go func() {
		pruneInterval := 5 * time.Second
		if cfg.UdpChannelTimeoutSeconds <= 5 {
			pruneInterval = 1 * time.Second
		}
		ticker := time.NewTicker(pruneInterval)
		defer ticker.Stop()
		timeout := time.Duration(cfg.UdpChannelTimeoutSeconds) * time.Second

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				now := time.Now()
				prunedCount := 0
				droneChannels.Range(func(key, value interface{}) bool {
					ch := key.(*gomavlib.Channel)
					lastSeen, ok := value.(time.Time)
					if !ok || now.Sub(lastSeen) > timeout {
						droneChannels.Delete(ch)
						prunedCount++
						log.Printf("[CHANNEL PRUNER] 🧹 Đã thu hồi kênh UDP Drone không hoạt động: %s (Inactive > %v)", ch.String(), timeout)
					}
					return true
				})
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
			// Cập nhật dấu thời gian hoạt động mới nhất cho kênh Drone
			droneChannels.Store(e.Channel, time.Now())

			// 1. Bỏ qua gói tin không hợp lệ hoặc Heartbeat từ GCS
			if e.SystemID() == 0 {
				continue
			}
			if hb, ok := e.Message().(*ardupilotmega.MessageHeartbeat); ok {
				if hb.Type == ardupilotmega.MAV_TYPE_GCS {
					continue
				}
			}

			// 2. Trích xuất địa chỉ IP nguồn từ Channel
			remoteIP := extractIPFromChannel(e.Channel.String())

			// 3. Tra cứu IP -> DeviceID từ Redis drone:ip_map
			deviceID := ipResolver.Resolve(ctx, remoteIP)

			// 4. XUẤT BẢN BYTE MAVLINK NHỊ PHÂN THÔ (RAW BYTES) VÀO "hòm thư" của redisPublisher:
			// Kênh `channel:drone:raw:<deviceID>` phục vụ NestJS WebSocket Gateway (Port 10004) chuyển tiếp xuống Pilot Bridge / QGroundControl
			if deviceID != "" {
				frameBuf.Reset()
				if err := frameWriter.Write(e.Frame); err == nil {
					_ = redisPublisher.PublishRawFrame(ctx, deviceID, frameBuf.Bytes())
				}
			}

			// 5. Cập nhật và giải mã gói tin vào State Aggregator
			snapshot, modified := stateAggregator.UpdateState(deviceID, e.SystemID(), remoteIP, e.Message())

			// 6. Lọc biến thiên (Deadband Filter) & Khống chế tần số tối đa trước khi đẩy vào "hòm thư" của redisPublisher:
			// Giúp giảm tải 85% - 90% cho Redis & Trình duyệt Web Dashboard
			if modified && deadbandFilter.ShouldPublish(snapshot) {
				err := redisPublisher.PublishTelemetry(ctx, snapshot, time.Duration(cfg.StateTtlSeconds)*time.Second)
				if err != nil {
					log.Printf("[ERROR] Lỗi publish Telemetry vào Redis (%s): %v", deviceID, err)
				}
			}

		case *gomavlib.EventChannelOpen:
			droneChannels.Store(e.Channel, time.Now())
			logChannelEvent("kết nối", e.Channel.String())

		case *gomavlib.EventChannelClose:
			droneChannels.Delete(e.Channel)
			logChannelEvent("ngắt kết nối", e.Channel.String())
		}
	}

	log.Println("[SHUTDOWN] Go MAVLink Ingestion Service đã dừng an toàn.")
}
