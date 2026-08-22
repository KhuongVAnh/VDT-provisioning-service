#!/bin/bash
# ==============================================================================
# drone_stream_adaptive.sh
# Dynamic Adaptive Bitrate Video Streamer for Drone Companion Computer (Pi 4 / 5G)
# Tự động đo độ trễ mạng VPN & Packet Loss để điều chỉnh Bitrate thời gian thực
# ==============================================================================

set -o pipefail

# --- 1. CẤU HÌNH HỆ THỐNG ---
GATEWAY_VPN_IP="${GATEWAY_VPN_IP:-10.13.37.1}"      # IP Gateway WireGuard Cloud
RTSP_PORT="${RTSP_PORT:-8554}"                      # Port RTSP MediaMTX Ingest
SRT_PORT="${SRT_PORT:-8890}"                        # Port SRT MediaMTX Ingest
PROTOCOL="${PROTOCOL:-rtsp}"                        # rtsp hoặc srt
DEVICE_ID="${DEVICE_ID:-}"                          # Tự động đọc nếu để trống
VIDEO_DEV="${VIDEO_DEV:-/dev/video0}"               # Cổng Camera USB hoặc V4L2
PROBE_INTERVAL=3                                    # Chu kỳ đo chất lượng mạng (giây)

# --- 2. 4 TẦNG BITRATE THÍCH ỨNG (ADAPTIVE BITRATE TIERS) ---
# Tier 1 (Excellent - RTT < 60ms, Loss 0%): 2500 kbps @ 30fps
BITRATE_TIER1=2500000
FPS_TIER1=30

# Tier 2 (Good - RTT 60-120ms, Loss < 3%): 1500 kbps @ 25fps
BITRATE_TIER2=1500000
FPS_TIER2=25

# Tier 3 (Fair/Moderate - RTT 120-250ms, Loss 3-8%): 800 kbps @ 20fps
BITRATE_TIER3=800000
FPS_TIER3=20

# Tier 4 (Poor/Critical - RTT > 250ms hoặc Loss > 8%): 400 kbps @ 15fps
BITRATE_TIER4=400000
FPS_TIER4=15

# --- 3. TỰ ĐỘNG XÁC ĐỊNH DEVICE ID ---
if [ -z "$DEVICE_ID" ]; then
    RAW_SERIAL=$(awk '/Serial/ {print $3}' /proc/cpuinfo 2>/dev/null | tr -d '[:space:]')
    if [ -n "$RAW_SERIAL" ] && [ "$RAW_SERIAL" != "0000000000000000" ]; then
        DEVICE_ID="DRONE-${RAW_SERIAL}"
    else
        DEVICE_ID="DRONE-001"
    fi
fi

echo "================================================================="
echo "  DRONE ADAPTIVE BITRATE VIDEO STREAMING AGENT                   "
echo "  Device ID : $DEVICE_ID                                         "
echo "  Gateway   : $GATEWAY_VPN_IP                                    "
echo "  Protocol  : $PROTOCOL                                          "
echo "================================================================="

CURRENT_TIER=1
CURRENT_BITRATE=$BITRATE_TIER1
CURRENT_FPS=$FPS_TIER1
STREAM_PID=0

# Dọn dẹp tiến trình khi nhận tín hiệu dừng
cleanup() {
    echo ""
    echo "[INFO] Đang dừng tiến trình truyền video thích ứng..."
    if [ "$STREAM_PID" -gt 0 ] && kill -0 "$STREAM_PID" 2>/dev/null; then
        kill "$STREAM_PID" 2>/dev/null
        wait "$STREAM_PID" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# --- 4. HÀM ĐO ĐỘ TRỄ MẠNG & TỶ LỆ MẤT GÓI (NETWORK LINK PROBE) ---
probe_network_quality() {
    local ping_output
    ping_output=$(ping -c 3 -W 1 "$GATEWAY_VPN_IP" 2>/dev/null)
    
    if [ $? -ne 0 ] || [ -z "$ping_output" ]; then
        # Mất kết nối hoàn toàn tới VPN Gateway -> Hạ về Tier 4 khẩn cấp
        echo "999 100"
        return
    fi

    local loss_pct
    loss_pct=$(echo "$ping_output" | grep -oP '\d+(?=% packet loss)' | head -n 1)
    loss_pct=${loss_pct:-0}

    local avg_rtt
    avg_rtt=$(echo "$ping_output" | grep -oP 'min/avg/max.*? = \K[\d.]+' 2>/dev/null | cut -d/ -f2)
    if [ -z "$avg_rtt" ]; then
        avg_rtt=$(echo "$ping_output" | grep -oP 'time=\K[\d.]+' | tail -n 1)
    fi
    avg_rtt=${avg_rtt:-50}
    avg_rtt=${avg_rtt%.*} # Chuyển về số nguyên ms

    echo "${avg_rtt} ${loss_pct}"
}

# --- 5. HÀM TÍNH TOÁN TẦNG BITRATE TỐI ƯU ---
evaluate_target_tier() {
    local rtt="$1"
    local loss="$2"

    if [ "$loss" -gt 8 ] || [ "$rtt" -gt 250 ]; then
        echo 4
    elif [ "$loss" -gt 3 ] || [ "$rtt" -gt 120 ]; then
        echo 3
    elif [ "$rtt" -gt 60 ]; then
        echo 2
    else
        echo 1
    fi
}

# --- 6. HÀM ĐIỀU CHỈNH BITRATE THỜI GIAN THỰC CHO V4L2 ENCODER ---
apply_dynamic_bitrate() {
    local new_tier="$1"
    local target_bitrate
    local target_fps

    case "$new_tier" in
        1) target_bitrate=$BITRATE_TIER1; target_fps=$FPS_TIER1 ;;
        2) target_bitrate=$BITRATE_TIER2; target_fps=$FPS_TIER2 ;;
        3) target_bitrate=$BITRATE_TIER3; target_fps=$FPS_TIER3 ;;
        4) target_bitrate=$BITRATE_TIER4; target_fps=$FPS_TIER4 ;;
    esac

    local bitrate_kbps=$((target_bitrate / 1000))
    echo "[ADAPTIVE] 📡 Chuyển sang Tier $new_tier: Bitrate = ${bitrate_kbps} kbps, FPS = ${target_fps}"

    # 1. Thử thay đổi trực tiếp qua V4L2 ioctl control (cho Raspberry Pi cứng)
    if command -v v4l2-ctl >/dev/null 2>&1 && [ -e "$VIDEO_DEV" ]; then
        v4l2-ctl --device="$VIDEO_DEV" --set-ctrl=video_bitrate="$target_bitrate" 2>/dev/null || true
    fi

    CURRENT_TIER=$new_tier
    CURRENT_BITRATE=$target_bitrate
    CURRENT_FPS=$target_fps
}

# --- 7. KHỞI ĐỘNG LUỒNG STREAM GSTREAMER / FFMPEG ---
start_streaming_pipeline() {
    local bitrate="$1"
    local fps="$2"

    if [ "$PROTOCOL" = "srt" ]; then
        TARGET_URL="srt://${GATEWAY_VPN_IP}:${SRT_PORT}?streamid=publish:live/${DEVICE_ID}&latency=100"
    else
        TARGET_URL="rtsp://${GATEWAY_VPN_IP}:${RTSP_PORT}/live/${DEVICE_ID}"
    fi

    echo "[STREAM] Khởi chạy Pipeline đẩy về: $TARGET_URL (Bitrate: $((bitrate/1000)) kbps)"

    # Nếu có Camera Pi (libcamerasrc hoặc v4l2src)
    if command -v gst-launch-1.0 >/dev/null 2>&1; then
        if [ -e "$VIDEO_DEV" ]; then
            gst-launch-1.0 -v v4l2src device="$VIDEO_DEV" ! \
                video/x-raw,width=1280,height=720,framerate=${fps}/1 ! \
                v4l2h264enc extra-controls="controls,h264_profile=1,video_bitrate=${bitrate}" ! \
                h264parse ! rtspclientsink location="$TARGET_URL" protocols=tcp &
            STREAM_PID=$!
            return
        elif command -v libcamerasrc >/dev/null 2>&1; then
            gst-launch-1.0 -v libcamerasrc ! \
                video/x-raw,width=1280,height=720,framerate=${fps}/1 ! \
                v4l2h264enc extra-controls="controls,h264_profile=1,video_bitrate=${bitrate}" ! \
                h264parse ! rtspclientsink location="$TARGET_URL" protocols=tcp &
            STREAM_PID=$!
            return
        fi
    fi

    # Fallback FFmpeg: Nếu có file video mẫu (sample_video.mp4) hoặc sinh test pattern
    SAMPLE_FILE="${VIDEO_FILE:-./sample_video.mp4}"
    if [ ! -f "$SAMPLE_FILE" ] && [ -f "../sample_video.mp4" ]; then
        SAMPLE_FILE="../sample_video.mp4"
    elif [ ! -f "$SAMPLE_FILE" ] && [ -f "./drone_sample.mp4" ]; then
        SAMPLE_FILE="./drone_sample.mp4"
    fi

    if [ -f "$SAMPLE_FILE" ]; then
        echo "[INFO] Chưa có camera vật lý -> Phát file video mẫu: $SAMPLE_FILE"
        ffmpeg -re -stream_loop -1 -i "$SAMPLE_FILE" \
            -c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -pix_fmt yuv420p \
            -b:v "${bitrate}" -maxrate "$((bitrate * 12 / 10))" \
            -bufsize "$((bitrate * 2))" -g "$fps" -an -f rtsp -rtsp_transport tcp "$TARGET_URL" >/dev/null 2>&1 &
        STREAM_PID=$!
    else
        echo "[INFO] Chưa có camera vật lý và không tìm thấy file video -> Phát test pattern 720p"
        ffmpeg -re -f lavfi -i "testsrc=size=1280x720:rate=${fps}" \
            -c:v libx264 -preset ultrafast -tune zerolatency -b:v "${bitrate}" -maxrate "$((bitrate * 12 / 10))" \
            -bufsize "$((bitrate * 2))" -g "$fps" -an -f rtsp -rtsp_transport tcp "$TARGET_URL" >/dev/null 2>&1 &
        STREAM_PID=$!
    fi
}

# --- 8. VÒNG LẶP CHÍNH THEO DÕI VÀ THÍCH ỨNG (MAIN ADAPTIVE LOOP) ---
start_streaming_pipeline "$CURRENT_BITRATE" "$CURRENT_FPS"

STABLE_COUNT=0

while true; do
    sleep "$PROBE_INTERVAL"

    # Kiểm tra xem tiến trình stream còn sống không, nếu chết thì khởi động lại
    if [ "$STREAM_PID" -eq 0 ] || ! kill -0 "$STREAM_PID" 2>/dev/null; then
        echo "[WARN] Pipeline truyền video bị ngắt! Đang khởi động lại sau 2 giây..."
        sleep 2
        start_streaming_pipeline "$CURRENT_BITRATE" "$CURRENT_FPS"
        continue
    fi

    # Đo thông số mạng hiện tại
    read -r rtt loss < <(probe_network_quality)
    target_tier=$(evaluate_target_tier "$rtt" "$loss")

    # Cơ chế Chống Rung Giật (Hysteresis):
    # - Nếu mạng XẤU ĐI -> Hạ Tier NGAY LẬP TỨC (để tránh rớt kết nối)
    # - Nếu mạng TỐT LÊN -> Chờ ổn định 3 chu kỳ liên tiếp (9 giây) mới tăng Tier
    if [ "$target_tier" -gt "$CURRENT_TIER" ]; then
        echo "[NETWORK ALERT] Mạng suy giảm (RTT: ${rtt}ms, Loss: ${loss}%)! Hạ Bitrate ngay lập tức."
        STABLE_COUNT=0
        apply_dynamic_bitrate "$target_tier"
    elif [ "$target_tier" -lt "$CURRENT_TIER" ]; then
        STABLE_COUNT=$((STABLE_COUNT + 1))
        if [ "$STABLE_COUNT" -ge 3 ]; then
            echo "[NETWORK RECOVERY] Mạng đã ổn định trở lại (RTT: ${rtt}ms, Loss: ${loss}%). Nâng chất lượng video."
            STABLE_COUNT=0
            apply_dynamic_bitrate "$target_tier"
        fi
    else
        STABLE_COUNT=0
    fi
done
