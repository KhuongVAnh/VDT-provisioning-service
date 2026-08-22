package config

import (
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

// Config chứa toàn bộ thông số cấu hình của Go Ingestion Service
type Config struct {
	// === CẤU HÌNH NHẬN GÓI TIN TỪ DRONE ===
	// Địa chỉ UDP Server lắng nghe gói tin MAVLink trực tiếp từ Drone qua VPN
	// Drone cấu hình địa chỉ MAVLink Router đến VPS_IP:14551
	// Vì Drone kết nối qua WireGuard VPN, IP nguồn gói UDP sẽ là 10.13.37.X thực tế
	// Thiết lập bằng biến môi trường UDP_LISTEN_ADDR, ví dụ: "0.0.0.0:14551"
	UdpListenAddr string

	// === CẤU HÌNH GCS ROUTER (Thay thế mavlink-routerd) ===
	// Cổng TCP Server cho QGroundControl / Mission Planner kết nối vào (tương đương TcpServerPort trong main.conf)
	// Thiết lập bằng biến môi trường TCP_GCS_PORT, ví dụ: "10002"
	TcpGcsPort string

	// === CẤU HÌNH REDIS ===
	RedisAddr                string // Địa chỉ Redis Server (ví dụ: "127.0.0.1:6380")
	RedisPassword            string // Mật khẩu Redis (nếu có)
	RedisDB                  int    // Database index trong Redis (mặc định 0)
	StateTtlSeconds          int    // Thời gian sống (TTL) của trạng thái tức thời trong Redis (giây)
	PublishIntervalMs        int    // Tần suất đẩy dữ liệu tổng hợp ra Redis Pub/Sub (mili-giây)
	DefaultMavlinkDial       string // Phương ngữ MAVLink mặc định
	VpnSubnetPrefix          string // Tiền tố dải mạng VPN (ví dụ: "10.13.37.")
	UdpChannelTimeoutSeconds int    // Thời gian timeout thu hồi kênh UDP không hoạt động (giây)
}

// LoadConfig đọc cấu hình từ file .env và biến môi trường của hệ điều hành
// Thứ tự ưu tiên:
// 1. Biến môi trường hệ thống / Docker container (cao nhất)
// 2. File .env nội bộ bên trong service (./.env)
// 3. File .env tổng ở thư mục cha (../.env)
// 4. Giá trị mặc định (fallback)
func LoadConfig() *Config {
	// Nạp file .env nội bộ trước (ưu tiên)
	_ = godotenv.Load(".env")
	// Nạp file .env thư mục cha (chỉ bổ sung các biến chưa có, không ghi đè)
	_ = godotenv.Load("../.env")

	cfg := &Config{
		// Lắng nghe tại 0.0.0.0:14551 - Drone gửi MAVLink thẳng tới cổng này
		// Khi Drone kết nối qua WireGuard VPN, gói UDP mang đúng IP nguồn VPN
		UdpListenAddr: getEnv("UDP_LISTEN_ADDR", "0.0.0.0:14551"),
		// Cổng TCP cho QGroundControl / Mission Planner kết nối vào
		TcpGcsPort:               getEnv("TCP_GCS_PORT", "10002"),
		RedisAddr:                getEnv("REDIS_ADDR", "127.0.0.1:6380"),
		RedisPassword:            getEnv("REDIS_PASSWORD", ""),
		RedisDB:                  getEnvAsInt("REDIS_DB", 0),
		StateTtlSeconds:          getEnvAsInt("STATE_TTL_SECONDS", 30),
		PublishIntervalMs:        getEnvAsInt("PUBLISH_INTERVAL_MS", 100),
		DefaultMavlinkDial:       getEnv("MAVLINK_DIALECT", "ardupilotmega"),
		VpnSubnetPrefix:          getEnv("VPN_SUBNET_PREFIX", "10.13.37."),
		UdpChannelTimeoutSeconds: getEnvAsInt("UDP_CHANNEL_TIMEOUT_SECONDS", 30),
	}

	return cfg
}

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return val
	}
	return fallback
}

func getEnvAsInt(key string, fallback int) int {
	valStr := getEnv(key, "")
	if val, err := strconv.Atoi(valStr); err == nil {
		return val
	}
	return fallback
}
