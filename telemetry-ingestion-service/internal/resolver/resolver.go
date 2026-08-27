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

// IPResolver chịu trách nhiệm ánh xạ địa chỉ IP VPN sang DeviceID duy nhất của Drone
type IPResolver struct {
	redisClient     *redis.Client
	localCache      sync.Map // Bộ nhớ đệm cục bộ (in-memory)
	cacheTTL        time.Duration
	vpnSubnetPrefix string
}

// NewIPResolver khởi tạo bộ giải mã ánh xạ IP sang DeviceID
func NewIPResolver(redisClient *redis.Client, vpnSubnetPrefix string) *IPResolver {
	if vpnSubnetPrefix == "" {
		vpnSubnetPrefix = "10.13.37."
	}
	return &IPResolver{
		redisClient:     redisClient,
		cacheTTL:        5 * time.Minute,
		vpnSubnetPrefix: vpnSubnetPrefix,
	}
}

type cacheEntry struct {
	deviceID  string
	expiresAt time.Time
}

// Resolve tìm DeviceID dựa vào địa chỉ IP của gói tin MAVLink
func (r *IPResolver) Resolve(ctx context.Context, vpnIP string) string {
	if vpnIP == "" {
		return "DRONE-UNKNOWN"
	}

	// 1. Kiểm tra RAM Cache
	if val, ok := r.localCache.Load(vpnIP); ok {
		entry := val.(cacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.deviceID
		}
		r.localCache.Delete(vpnIP)
	}

	// 2. Tra cứu Redis Hash `drone:ip_map`
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

	// 3. Fallback theo định dạng IP
	sanitizedIP := strings.ReplaceAll(vpnIP, ".", "-")
	fallbackID := fmt.Sprintf("DRONE-IP-%s", sanitizedIP)
	r.localCache.Store(vpnIP, cacheEntry{
		deviceID:  fallbackID,
		expiresAt: time.Now().Add(30 * time.Second),
	})
	log.Printf("[RESOLVER] Không tìm thấy DeviceID cho IP %s, dùng: %s", vpnIP, fallbackID)
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
