package resolver

import (
	"context"
	"testing"
)

func TestIPResolver(t *testing.T) {
	resolver := NewIPResolver(nil, "10.13.37.")
	ctx := context.Background()

	// 1. Kiểm tra fallback IP VPN
	devID := resolver.Resolve(ctx, "10.13.37.10")
	if devID != "DRONE-IP-10-13-37-10" {
		t.Errorf("Kỳ vọng fallback sang DRONE-IP-10-13-37-10, thực tế: %s", devID)
	}

	// 2. Kiểm tra fallback cho IP bất kỳ
	devLocalID := resolver.Resolve(ctx, "127.0.0.1")
	if devLocalID != "DRONE-IP-127-0-0-1" {
		t.Errorf("Kỳ vọng fallback sang DRONE-IP-127-0-0-1, thực tế: %s", devLocalID)
	}

	// 3. Kiểm tra IP rỗng
	emptyID := resolver.Resolve(ctx, "")
	if emptyID != "DRONE-UNKNOWN" {
		t.Errorf("Kỳ vọng IP rỗng trả về DRONE-UNKNOWN, thực tế: %s", emptyID)
	}

	// 4. Gán mapping thủ công vào local cache
	_ = resolver.SetMapping(ctx, "10.13.37.10", "DRONE-MANUAL-001")
	resolvedID := resolver.Resolve(ctx, "10.13.37.10")
	if resolvedID != "DRONE-MANUAL-001" {
		t.Errorf("Kỳ vọng resolve được DRONE-MANUAL-001, thực tế: %s", resolvedID)
	}
}
