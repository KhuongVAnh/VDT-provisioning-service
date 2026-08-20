package config

import (
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

// Config chứa toàn bộ thông số cấu hình của Go Ingestion Service
type Config struct {
	UdpListenAddr      string // Địa chỉ cổng UDP lắng nghe gói tin MAVLink (ví dụ: ":14551" hoặc "0.0.0.0:14551")
	RedisAddr          string // Địa chỉ Redis Server (ví dụ: "127.0.0.1:6380" hoặc "redis:6380")
	RedisPassword      string // Mật khẩu Redis (nếu có)
	RedisDB            int    // Database index trong Redis (mặc định 0)
	StateTtlSeconds    int    // Thời gian sống (TTL) của trạng thái tức thời trong Redis (giây)
	PublishIntervalMs  int    // Tần suất đẩy dữ liệu tổng hợp ra Redis Pub/Sub (mili-giây, mặc định 100ms = 10Hz)
	DefaultMavlinkDial string // Phương ngữ MAVLink mặc định (ardupilotmega hoặc common)
}

// LoadConfig đọc cấu hình từ file .env và biến môi trường của hệ điều hành
func LoadConfig() *Config {
	if err := godotenv.Load(); err != nil {
		log.Println("[INFO] Không tìm thấy file .env, sử dụng biến môi trường hệ thống hoặc giá trị mặc định.")
	}

	cfg := &Config{
		UdpListenAddr:      getEnv("UDP_LISTEN_ADDR", ":14551"),
		RedisAddr:          getEnv("REDIS_ADDR", "127.0.0.1:6380"),
		RedisPassword:      getEnv("REDIS_PASSWORD", ""),
		RedisDB:            getEnvAsInt("REDIS_DB", 0),
		StateTtlSeconds:    getEnvAsInt("STATE_TTL_SECONDS", 30),
		PublishIntervalMs:  getEnvAsInt("PUBLISH_INTERVAL_MS", 100),
		DefaultMavlinkDial: getEnv("MAVLINK_DIALECT", "ardupilotmega"),
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
