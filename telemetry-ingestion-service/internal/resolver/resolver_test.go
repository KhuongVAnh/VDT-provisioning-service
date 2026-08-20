package resolver

import (
	"context"
	"testing"
)

func TestIPResolverFallback(t *testing.T) {
	// Khởi tạo Resolver không có Redis để kiểm tra fallback
	resolver := NewIPResolver(nil)
	ctx := context.Background()

	// 1. Kiểm tra fallback tự động
	devID := resolver.Resolve(ctx, "10.13.37.10")
	if devID != "DRONE-IP-10-13-37-10" {
		t.Errorf("Kỳ vọng fallback sang DRONE-IP-10-13-37-10, thực tế: %s", devID)
	}

	// 2. Gán mapping thủ công vào local cache
	_ = resolver.SetMapping(ctx, "10.13.37.10", "DRONE-MANUAL-001")
	resolvedID := resolver.Resolve(ctx, "10.13.37.10")
	if resolvedID != "DRONE-MANUAL-001" {
		t.Errorf("Kỳ vọng resolve được DRONE-MANUAL-001, thực tế: %s", resolvedID)
	}
}
