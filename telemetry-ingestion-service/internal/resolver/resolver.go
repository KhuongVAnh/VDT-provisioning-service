package resolver

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// IPResolver chịu trách nhiệm ánh xạ địa chỉ IP VPN hoặc SystemID sang DeviceID duy nhất của Drone
type IPResolver struct {
	redisClient *redis.Client
	localCache  sync.Map // Bộ nhớ đệm cục bộ (in-memory)
	cacheTTL    time.Duration
}

// NewIPResolver khởi tạo bộ giải mã ánh xạ IP/SysID sang DeviceID
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

// Resolve tìm DeviceID dựa vào địa chỉ IP và SystemID của gói tin MAVLink
func (r *IPResolver) Resolve(ctx context.Context, vpnIP string, sysID uint8) string {
	// A. Trường hợp là IP VPN thực sự (10.13.37.X từ WireGuard)
	if strings.HasPrefix(vpnIP, "10.13.37.") {
		if val, ok := r.localCache.Load(vpnIP); ok {
			entry := val.(cacheEntry)
			if time.Now().Before(entry.expiresAt) {
				return entry.deviceID
			}
			r.localCache.Delete(vpnIP)
		}

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

		// Fallback IP VPN
		sanitizedIP := strings.ReplaceAll(vpnIP, ".", "-")
		fallbackID := fmt.Sprintf("DRONE-IP-%s", sanitizedIP)
		r.localCache.Store(vpnIP, cacheEntry{
			deviceID:  fallbackID,
			expiresAt: time.Now().Add(30 * time.Second),
		})
		log.Printf("[RESOLVER] Không tìm thấy DeviceID cho IP VPN %s, dùng: %s", vpnIP, fallbackID)
		return fallbackID
	}

	// B. Trường hợp IP cục bộ / Docker Bridge (127.0.0.1, 172.x.x.x, 192.168.x.x):
	// Phân biệt các Drone qua SystemID để tránh trùng lặp
	sysKey := fmt.Sprintf("sys:%d", sysID)
	if val, ok := r.localCache.Load(sysKey); ok {
		entry := val.(cacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.deviceID
		}
		r.localCache.Delete(sysKey)
	}

	if r.redisClient != nil && sysID > 0 {
		deviceID, err := r.redisClient.HGet(ctx, "drone:sys_map", strconv.Itoa(int(sysID))).Result()
		if err == nil && deviceID != "" {
			r.localCache.Store(sysKey, cacheEntry{
				deviceID:  deviceID,
				expiresAt: time.Now().Add(r.cacheTTL),
			})
			return deviceID
		}
	}

	// Fallback SystemID
	var fallbackID string
	if sysID > 0 {
		fallbackID = fmt.Sprintf("DRONE-SYS-%02d", sysID)
	} else {
		fallbackID = "DRONE-UNKNOWN"
	}

	r.localCache.Store(sysKey, cacheEntry{
		deviceID:  fallbackID,
		expiresAt: time.Now().Add(30 * time.Second),
	})
	log.Printf("[RESOLVER] IP không phải VPN (%s), phân giải theo SysID %d -> %s", vpnIP, sysID, fallbackID)
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

// SetSysMapping cập nhật ánh xạ SystemID -> DeviceID vào cả RAM và Redis
func (r *IPResolver) SetSysMapping(ctx context.Context, sysID uint8, deviceID string) error {
	sysKey := fmt.Sprintf("sys:%d", sysID)
	r.localCache.Store(sysKey, cacheEntry{
		deviceID:  deviceID,
		expiresAt: time.Now().Add(r.cacheTTL),
	})

	if r.redisClient != nil {
		return r.redisClient.HSet(ctx, "drone:sys_map", strconv.Itoa(int(sysID)), deviceID).Err()
	}
	return nil
}
