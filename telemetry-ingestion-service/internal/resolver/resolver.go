package resolver

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// IPResolver chịu trách nhiệm ánh xạ địa chỉ IP VPN (10.13.37.X) của gói tin UDP sang DeviceID duy nhất của Drone
type IPResolver struct {
	redisClient *redis.Client
	localCache  sync.Map // Bộ nhớ đệm cục bộ (in-memory) để tăng tốc độ truy vấn cực đại
	cacheTTL    time.Duration
}

// NewIPResolver khởi tạo bộ giải mã ánh xạ IP sang DeviceID
func NewIPResolver(redisClient *redis.Client) *IPResolver {
	return &IPResolver{
		redisClient: redisClient,
		cacheTTL:    5 * time.Minute,
	}
}

type cacheEntry struct {
	deviceID  string
	expiresAt time.Time
}

// Resolve tìm DeviceID dựa vào địa chỉ IP VPN nguồn của gói tin UDP MAVLink
func (r *IPResolver) Resolve(ctx context.Context, vpnIP string) string {
	// 1. Kiểm tra trong bộ nhớ đệm RAM cục bộ trước (tốc độ nano-giây)
	if val, ok := r.localCache.Load(vpnIP); ok {
		entry := val.(cacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.deviceID
		}
		// Hết hạn cache
		r.localCache.Delete(vpnIP)
	}

	// 2. Nếu chưa có trong RAM, truy vấn bảng băm `drone:ip_map` trong Redis
	if r.redisClient != nil {
		deviceID, err := r.redisClient.HGet(ctx, "drone:ip_map", vpnIP).Result()
		if err == nil && deviceID != "" {
			r.localCache.Store(vpnIP, cacheEntry{
				deviceID:  deviceID,
				expiresAt: time.Now().Add(r.cacheTTL),
			})
			return deviceID
		}
	}

	// 3. Fallback thông minh: Nếu chưa kịp đồng bộ với Database, sinh DeviceID tạm theo IP
	// Ví dụ: 10.13.37.5 -> DRONE-IP-10-13-37-5
	sanitizedIP := strings.ReplaceAll(vpnIP, ".", "-")
	fallbackID := fmt.Sprintf("DRONE-IP-%s", sanitizedIP)

	// Lưu tạm vào cache 30 giây để không spam truy vấn Redis liên tục
	r.localCache.Store(vpnIP, cacheEntry{
		deviceID:  fallbackID,
		expiresAt: time.Now().Add(30 * time.Second),
	})

	log.Printf("[RESOLVER] Không tìm thấy DeviceID cho IP %s, sử dụng định danh tạm thời: %s", vpnIP, fallbackID)
	return fallbackID
}

// SetMapping cập nhật chủ động ánh xạ IP -> DeviceID vào cả RAM và Redis
func (r *IPResolver) SetMapping(ctx context.Context, vpnIP, deviceID string) error {
	r.localCache.Store(vpnIP, cacheEntry{
		deviceID:  deviceID,
		expiresAt: time.Now().Add(r.cacheTTL),
	})

	if r.redisClient != nil {
		return r.redisClient.HSet(ctx, "drone:ip_map", vpnIP, deviceID).Err()
	}
	return nil
}
