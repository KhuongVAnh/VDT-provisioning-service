package publisher

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/KhuongVAnh/telemetry-ingestion-service/pkg/models"
	"github.com/redis/go-redis/v9"
)

// telemetryQueueItem chứa dữ liệu đo xa đã được tuần tự hóa sẵn sàng để gom batch
type telemetryQueueItem struct {
	DeviceID string
	Payload  *models.TelemetryPayload
	JSONData []byte
}

// rawQueueItem chứa frame byte nhị phân thô MAVLink v2
type rawQueueItem struct {
	DeviceID string
	RawBytes []byte
}

// LiteTelemetryPayload định dạng rút gọn siêu nhẹ cho kênh Lite (1Hz) phục vụ theo dõi tiểu đội
type LiteTelemetryPayload struct {
	DeviceID      string  `json:"deviceId"`
	Connected     bool    `json:"connected"`
	Armed         bool    `json:"armed"`
	FlightMode    string  `json:"flightMode"`
	BatteryPct    int32   `json:"batteryPct"`
	Lat           float64 `json:"lat"`
	Lon           float64 `json:"lon"`
	AltRelativeM  float64 `json:"altRelativeM"`
	GroundSpeedMs float64 `json:"groundSpeedMs"`
	HeadingDeg    float64 `json:"headingDeg"`
	RollDeg       float64 `json:"rollDeg"`
	PitchDeg      float64 `json:"pitchDeg"`
	Timestamp     int64   `json:"timestamp"`
}

// RedisPublisher quản lý luồng ghi dữ liệu và xuất bản sự kiện thời gian thực vào Redis.
// Áp dụng kỹ thuật:
//  1. Micro-Batching Pipeline (chu kỳ 20ms): Gom nhiều frame thực thi trong 1 TCP Roundtrip duy nhất.
//  2. Heartbeat Liveness ZSET (`drone:heartbeats`): Thay thế key String TTL, tra cứu Online/Offline siêu tốc.
//  3. Phân tầng kênh qua `drone:focus_set`: Phát 10Hz Full cho Drone đang lái và 1Hz Lite cho Drone nền.
type RedisPublisher struct {
	client *redis.Client

	// Hàng đợi đệm Micro-Batching trong RAM
	telemetryChan chan *telemetryQueueItem
	rawChan       chan *rawQueueItem

	// Bộ nhớ đệm danh sách Drone đang được Focus (đồng bộ từ Redis Set `drone:focus_set`)
	focusMap sync.Map // key: deviceId (string), value: bool

	// Dấu thời gian gửi bản tin Lite 1Hz gần nhất cho từng Drone
	lastLiteSent sync.Map // key: deviceId (string), value: time.Time

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewRedisPublisher khởi tạo RedisPublisher và kích hoạt các Background Workers
func NewRedisPublisher(client *redis.Client) *RedisPublisher {
	ctx, cancel := context.WithCancel(context.Background())

	pub := &RedisPublisher{
		client:        client,
		telemetryChan: make(chan *telemetryQueueItem, 2000), // Buffer đệm chống tràn khi tải đột biến
		rawChan:       make(chan *rawQueueItem, 2000),
		ctx:           ctx,
		cancel:        cancel,
	}

	if client != nil {
		// 1. Khởi động Worker gom Micro-Batching Pipeline theo chu kỳ 20ms
		pub.wg.Add(1)
		go pub.microBatchFlushLoop()

		// 2. Khởi động Worker đồng bộ danh sách Drone Focus từ Redis Set `drone:focus_set`
		pub.wg.Add(1)
		go pub.syncFocusSetLoop()
	}

	return pub
}

// ==============================================================================
// 1. CÁC HÀM TIẾP NHẬN DỮ LIỆU TỪ UDP INGESTION (NON-BLOCKING ENQUEUE)
// ==============================================================================

// PublishTelemetry tiếp nhận gói tin Telemetry, tuần tự hóa JSON và đẩy vào hàng đợi Micro-Batching.
// Thao tác này là Non-blocking (< 1 micro-giây), không bao giờ làm nghẽn luồng đọc UDP MAVLink.
func (p *RedisPublisher) PublishTelemetry(ctx context.Context, payload *models.TelemetryPayload, _ time.Duration) error {
	if p.client == nil || payload == nil || payload.DeviceID == "" {
		return nil
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("lỗi khi tuần tự hóa JSON Telemetry: %w", err)
	}

	item := &telemetryQueueItem{
		DeviceID: payload.DeviceID,
		Payload:  payload,
		JSONData: jsonData,
	}

	// Đẩy vào Channel đệm (nếu Channel đầy sẽ drop nhẹ kèm cảnh báo thay vì block hệ thống)
	select {
	case p.telemetryChan <- item:
	default:
		log.Printf("[WARN] [REDIS BATCH] Hàng đợi Telemetry đầy (2000 items)! Drop frame của %s", payload.DeviceID)
	}

	return nil
}

// PublishRawFrame tiếp nhận frame byte nhị phân thô MAVLink v2 và đẩy vào hàng đợi Raw Batching
func (p *RedisPublisher) PublishRawFrame(ctx context.Context, deviceID string, rawBytes []byte) error {
	if p.client == nil || deviceID == "" || len(rawBytes) == 0 {
		return nil
	}

	// Sao chép buffer để tránh race condition khi frameWriter tái sử dụng buffer
	copiedBytes := make([]byte, len(rawBytes))
	copy(copiedBytes, rawBytes)

	item := &rawQueueItem{
		DeviceID: deviceID,
		RawBytes: copiedBytes,
	}

	select {
	case p.rawChan <- item:
	default:
		// Drop raw byte nếu hàng đợi quá tải
	}

	return nil
}

// ==============================================================================
// 2. TIẾN TRÌNH GOM MICRO-BATCHING (CHUYẾN XE BUÝT 20ms FLUSH 1 LẦN)
// ==============================================================================

// microBatchFlushLoop là Background Worker chạy liên tục:
// Cứ mỗi 20 mili-giây (hoặc khi gom đủ 50 frames), gom tất cả các lệnh HSET, ZADD và PUBLISH
// vào một Pipeline duy nhất để gửi sang Redis, giảm 95% số lần gọi Syscall và I/O mạng.
func (p *RedisPublisher) microBatchFlushLoop() {
	defer p.wg.Done()

	// Chu kỳ vàng 20ms (tương đương 50 lần flush/giây cho toàn hệ thống)
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-p.ctx.Done():
			// Khi shutdown: Xả sạch toàn bộ item còn tồn trong channel
			p.flushRemaining()
			return

		case <-ticker.C:
			p.flushBatch()
		}
	}
}

// flushBatch gom tất cả các item đang chờ trong channel và thực thi 1 Pipeline duy nhất
func (p *RedisPublisher) flushBatch() {
	if p.client == nil {
		return
	}

	pipe := p.client.Pipeline()
	now := time.Now()
	nowUnix := float64(now.Unix())

	// 1. Gom các gói tin Telemetry JSON trong giỏ
	telemetryCount := 0
	for len(p.telemetryChan) > 0 && telemetryCount < 100 {
		item := <-p.telemetryChan
		telemetryCount++

		// A. Ghi snapshot trạng thái vào Hash `drone:states` (Key: deviceId -> Value: Full JSON)
		pipe.HSet(p.ctx, "drone:states", item.DeviceID, string(item.JSONData))

		// B. Cập nhật nhịp tim Liveness vào ZSET `drone:heartbeats` (Score: Unix Timestamp)
		//    Giúp truy vấn Online/Offline siêu tốc: ZRANGEBYSCORE drone:heartbeats (Now - 10) +inf
		pipe.ZAdd(p.ctx, "drone:heartbeats", redis.Z{
			Score:  nowUnix,
			Member: item.DeviceID,
		})

		// C. Phân tầng phát Pub/Sub dựa trên danh sách Focus (`drone:focus_set`):
		isFocused := p.IsFocused(item.DeviceID)

		if isFocused {
			// [DRONE ĐANG ĐƯỢC LÁI TAY / FOCUS]: Bắn luồng 10Hz Full chi tiết
			fullChannel := fmt.Sprintf("channel:drone:telemetry:full:%s", item.DeviceID)
			pipe.Publish(p.ctx, fullChannel, string(item.JSONData))
		}

		// [LUỒNG LITE CHO TIỂU ĐỘI / DRONE NỀN]: Khống chế tần số 1Hz (1000ms/lần)
		lastSent, exists := p.lastLiteSent.Load(item.DeviceID)
		if !exists || now.Sub(lastSent.(time.Time)) >= 1000*time.Millisecond {
			p.lastLiteSent.Store(item.DeviceID, now)

			litePayload := LiteTelemetryPayload{
				DeviceID:      item.Payload.DeviceID,
				Connected:     item.Payload.Connected,
				Armed:         item.Payload.Armed,
				FlightMode:    item.Payload.FlightMode,
				BatteryPct:    item.Payload.Battery.Percentage,
				Lat:           item.Payload.GPS.Lat,
				Lon:           item.Payload.GPS.Lon,
				AltRelativeM:  item.Payload.GPS.AltRelativeM,
				GroundSpeedMs: item.Payload.GPS.GroundSpeedMs,
				HeadingDeg:    item.Payload.GPS.HeadingDeg,
				RollDeg:       item.Payload.Attitude.RollDeg,
				PitchDeg:      item.Payload.Attitude.PitchDeg,
				Timestamp:     item.Payload.Timestamp,
			}
			if liteJSON, err := json.Marshal(litePayload); err == nil {
				liteChannel := fmt.Sprintf("channel:drone:telemetry:lite:%s", item.DeviceID)
				pipe.Publish(p.ctx, liteChannel, string(liteJSON))
			}
		}
	}

	// 2. Gom các gói tin Raw Binary MAVLink trong giỏ
	rawCount := 0
	for len(p.rawChan) > 0 && rawCount < 100 {
		rawItem := <-p.rawChan
		rawCount++

		isFocused := p.IsFocused(rawItem.DeviceID)
		if isFocused {
			// Chỉ phát luồng Raw Full 10-20Hz khi có Pilot đang Focus kết nối điều khiển
			rawFullChan := fmt.Sprintf("channel:drone:raw:full:%s", rawItem.DeviceID)
			pipe.Publish(p.ctx, rawFullChan, rawItem.RawBytes)
		} else {
			// Drone nền: phát luồng Raw Lite (cho QGroundControl Multi-Vehicle)
			rawLiteChan := fmt.Sprintf("channel:drone:raw:lite:%s", rawItem.DeviceID)
			pipe.Publish(p.ctx, rawLiteChan, rawItem.RawBytes)
		}
	}

	// 3. Thực thi Pipeline nếu có lệnh cần gửi
	if pipe.Len() > 0 {
		_, err := pipe.Exec(p.ctx)
		if err != nil {
			log.Printf("[ERROR] [REDIS BATCH] Lỗi thực thi Pipeline (%d lệnh): %v", pipe.Len(), err)
		}
	}
}

// flushRemaining xả sạch hàng đợi khi hệ thống chuẩn bị tắt (Graceful Shutdown)
func (p *RedisPublisher) flushRemaining() {
	log.Println("[INFO] [REDIS BATCH] Đang xả sạch các gói tin còn đọng trong hàng đợi...")
	for len(p.telemetryChan) > 0 || len(p.rawChan) > 0 {
		p.flushBatch()
	}
}

// ==============================================================================
// 3. ĐỒNG BỘ DANH SÁCH FOCUS TỪ REDIS SET `drone:focus_set`
// ==============================================================================

// syncFocusSetLoop định kỳ 1 giây đọc toàn bộ thành viên trong `drone:focus_set` từ Redis
// và nạp vào bộ nhớ RAM (`sync.Map`) để tra cứu trong 0 nano-giây khi gom frame.
func (p *RedisPublisher) syncFocusSetLoop() {
	defer p.wg.Done()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			p.syncFocusSetOnce()
		}
	}
}

func (p *RedisPublisher) syncFocusSetOnce() {
	if p.client == nil {
		return
	}

	members, err := p.client.SMembers(p.ctx, "drone:focus_set").Result()
	if err != nil {
		return
	}

	currentMap := make(map[string]bool)
	for _, devID := range members {
		currentMap[devID] = true
		p.focusMap.Store(devID, true)
	}

	// Xóa các Drone không còn nằm trong focus_set
	p.focusMap.Range(func(key, _ interface{}) bool {
		devID := key.(string)
		if !currentMap[devID] {
			p.focusMap.Delete(devID)
		}
		return true
	})
}

// IsFocused kiểm tra nhanh xem một Drone có đang được Pilot/Admin Focus hay không (0ms RAM lookup)
func (p *RedisPublisher) IsFocused(deviceID string) bool {
	val, ok := p.focusMap.Load(deviceID)
	return ok && val.(bool)
}

// ==============================================================================
// 4. CÁC HÀM TIỆN ÍCH KHÁC
// ==============================================================================

// GetAllStates lấy toàn bộ trạng thái tức thời của các drone đang được lưu trong Redis
func (p *RedisPublisher) GetAllStates(ctx context.Context) (map[string]*models.TelemetryPayload, error) {
	if p.client == nil {
		return nil, nil
	}

	rawMap, err := p.client.HGetAll(ctx, "drone:states").Result()
	if err != nil {
		return nil, err
	}

	result := make(map[string]*models.TelemetryPayload)
	for devID, jsonStr := range rawMap {
		var payload models.TelemetryPayload
		if err := json.Unmarshal([]byte(jsonStr), &payload); err == nil {
			result[devID] = &payload
		}
	}
	return result, nil
}

// Close dừng Background Workers, xả sạch hàng đợi và đóng kết nối Redis an toàn
func (p *RedisPublisher) Close() {
	if p.cancel != nil {
		p.cancel()
	}
	p.wg.Wait()

	if p.client != nil {
		if err := p.client.Close(); err != nil {
			log.Printf("[REDIS] Lỗi khi đóng kết nối Redis: %v", err)
		}
	}
}
