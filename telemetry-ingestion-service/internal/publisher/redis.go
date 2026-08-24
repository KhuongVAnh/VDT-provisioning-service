package publisher

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/KhuongVAnh/telemetry-ingestion-service/pkg/models"
	"github.com/redis/go-redis/v9"
)

// RedisPublisher chịu trách nhiệm đẩy dữ liệu trạng thái và luồng sự kiện Realtime vào Redis
type RedisPublisher struct {
	client *redis.Client
}

// NewRedisPublisher khởi tạo bộ phát Redis Publisher
func NewRedisPublisher(client *redis.Client) *RedisPublisher {
	return &RedisPublisher{
		client: client,
	}
}

// PublishTelemetry đẩy đồng thời snapshot trạng thái vào Redis Hashes và stream JSON vào Redis Pub/Sub
func (p *RedisPublisher) PublishTelemetry(ctx context.Context, payload *models.TelemetryPayload, ttl time.Duration) error {
	if p.client == nil {
		return nil
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("lỗi khi tuần tự hóa JSON Telemetry: %w", err)
	}

	pipe := p.client.Pipeline()

	// 1. Lưu snapshot trạng thái mới nhất vào Hash map tổng `drone:states` (Key: deviceId -> Value: JSON)
	pipe.HSet(ctx, "drone:states", payload.DeviceID, string(jsonData))

	// 2. Lưu riêng từng key `drone:state:<deviceId>` kèm thời gian sống (TTL)
	stateKey := fmt.Sprintf("drone:state:%s", payload.DeviceID)
	pipe.Set(ctx, stateKey, string(jsonData), ttl)

	// 3. Đẩy sự kiện realtime vào 2 kênh Pub/Sub:
	// - Kênh riêng cho drone đó: `channel:drone:telemetry:<deviceId>` (phục vụ client chỉ theo dõi 1 drone)
	// - Kênh tổng hợp: `channel:drone:telemetry:all` (phục vụ màn hình giám sát toàn bộ phi đội)
	singleChannel := fmt.Sprintf("channel:drone:telemetry:%s", payload.DeviceID)
	pipe.Publish(ctx, singleChannel, string(jsonData))
	pipe.Publish(ctx, "channel:drone:telemetry:all", string(jsonData))

	// Thực thi pipeline trong 1 network roundtrip duy nhất để đạt hiệu năng tối đa
	_, err = pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("lỗi khi thực thi Redis pipeline: %w", err)
	}

	return nil
}

// PublishRawFrame đẩy luồng byte nhị phân thô MAVLink v2 (Raw Bytes) vào kênh Redis Pub/Sub:
// Kênh `channel:drone:raw:<deviceId>` để NestJS Binary WebSocket Gateway chuyển tiếp trực tiếp cho QGroundControl.
func (p *RedisPublisher) PublishRawFrame(ctx context.Context, deviceID string, rawBytes []byte) error {
	if p.client == nil || len(rawBytes) == 0 {
		return nil
	}
	channel := fmt.Sprintf("channel:drone:raw:%s", deviceID)
	return p.client.Publish(ctx, channel, rawBytes).Err()
}

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

// Close đóng kết nối Redis client
func (p *RedisPublisher) Close() {
	if p.client != nil {
		if err := p.client.Close(); err != nil {
			log.Printf("[REDIS] Lỗi khi đóng kết nối Redis: %v", err)
		}
	}
}
