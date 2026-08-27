# Multi-stage Dockerfile cho Go MAVLink Ingestion Service
# Stage 1: Build binary
FROM golang:alpine AS builder

WORKDIR /app

# Cho phép tự động cập nhật toolchain nếu thư viện yêu cầu Go mới hơn
ENV GOTOOLCHAIN=auto

# Cài đặt git và build tools cần thiết
RUN apk add --no-cache git gcc musl-dev

# Copy dependency files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary tĩnh (CGO_ENABLED=0)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/ingest-server ./cmd/server

# Stage 2: Production Minimal Image
FROM alpine:latest

WORKDIR /app

# Cài đặt chứng chỉ SSL CA và múi giờ
RUN apk add --no-cache ca-certificates tzdata

# Copy binary từ builder
COPY --from=builder /app/ingest-server /app/ingest-server

# Cấu hình biến môi trường mặc định khớp với hệ thống
ENV UDP_LISTEN_ADDR="0.0.0.0:14551" \
    REDIS_ADDR="redis:6380" \
    REDIS_DB=0 \
    STATE_TTL_SECONDS=30

# Mở cổng UDP cho Drone MAVLink
EXPOSE 14551/udp

# Chạy Ingestion Server
CMD ["/app/ingest-server"]
