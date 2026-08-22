package resolver

import (
	"context"
	"testing"
)

func TestIPResolverFallback(t *testing.T) {
	resolver := NewIPResolver(nil, "10.13.37.")
	ctx := context.Background()

	// 1. Kiểm tra fallback IP VPN
	devID := resolver.Resolve(ctx, "10.13.37.10", 1)
	if devID != "DRONE-IP-10-13-37-10" {
		t.Errorf("Kỳ vọng fallback sang DRONE-IP-10-13-37-10, thực tế: %s", devID)
	}

	// 2. Kiểm tra fallback SystemID cho IP local / Docker
	devSysID := resolver.Resolve(ctx, "127.0.0.1", 3)
	if devSysID != "DRONE-SYS-03" {
		t.Errorf("Kỳ vọng fallback sang DRONE-SYS-03, thực tế: %s", devSysID)
	}

	// 3. Gán mapping thủ công vào local cache
	_ = resolver.SetMapping(ctx, "10.13.37.10", "DRONE-MANUAL-001")
	resolvedID := resolver.Resolve(ctx, "10.13.37.10", 1)
	if resolvedID != "DRONE-MANUAL-001" {
		t.Errorf("Kỳ vọng resolve được DRONE-MANUAL-001, thực tế: %s", resolvedID)
	}

	// 4. Gán sys mapping
	_ = resolver.SetSysMapping(ctx, 5, "DRONE-SIM-0005")
	resolvedSysID := resolver.Resolve(ctx, "172.19.0.1", 5)
	if resolvedSysID != "DRONE-SIM-0005" {
		t.Errorf("Kỳ vọng resolve được DRONE-SIM-0005, thực tế: %s", resolvedSysID)
	}
}
