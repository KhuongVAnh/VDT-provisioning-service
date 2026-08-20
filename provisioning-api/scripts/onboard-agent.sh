#!/bin/bash

# ==============================================================================
# onboard-agent.sh
# Dynamic Onboarding, Routing & OTA Auto-Updating Agent for Raspberry Pi 4
# ==============================================================================

set -o pipefail

# --- 1. CONFIGURATION (Tập trung cấu hình ở đầu script) ---
PROVISION_API_URL="http://103.253.20.32:10004/api/v1/provisioning/register"
PROVISION_TOKEN="FACTORY_SECRET_KEY_2026"
HARDWARE_MODEL="Raspberry Pi 4 Model B Rev 1.5"

INTERFACE_WWAN="wwan0"
MAX_WWAN_WAIT=120           # Thời gian tối đa chờ mạng 5G có IP (giây)
API_MAX_RETRIES=10          # Số lần thử gọi API tối đa
API_RETRY_INTERVAL=5        # Khoảng cách giữa các lần gọi lại API (giây)
MAVLINK_DEFAULT_BAUD=57600   # Baudrate mặc định kết nối Flight Controller

WG_CONF="/etc/wireguard/wg0.conf"
WG_CONF_BAK="/etc/wireguard/wg0.conf.bak"
MAVLINK_CONF="/etc/mavlink-router/main.conf"
MAVLINK_CONF_BAK="/etc/mavlink-router/main.conf.bak"

# Đường dẫn URL GitHub Raw để tải bản cập nhật tự động (OTA) cho đúng 2 file
GITHUB_RAW_BASE="https://raw.githubusercontent.com/KhuongVAnh/VDT-provisioning-service/main/provisioning-api"
OTA_SCRIPT_URL="${GITHUB_RAW_BASE}/scripts/onboard-agent.sh"
OTA_SERVICE_URL="${GITHUB_RAW_BASE}/config/drone-onboard.service"

# --- 2. PRE-FLIGHT CHECKS (Kiểm tra quyền và công cụ bắt buộc) ---
if [ "$(id -u)" -ne 0 ]; then
    echo "[ERROR] Script bat buoc phai chay voi quyen root (sudo)." >&2
    exit 1
fi

for cmd in jq curl wg ip awk grep sed stty timeout sha256sum; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "[ERROR] Thieu cong cu bat buoc: '$cmd'. Vui long cai dat truoc khi tiep tuc." >&2
        exit 1
    fi
done

echo "========================================================"
echo "    DRONE DYNAMIC ONBOARDING & ROUTING AGENT           "
echo "========================================================"

# --- 3. DEVICE ID DISCOVERY (Nhận diện thiết bị duy nhất) ---
# Ưu tiên đọc CPU Serial từ /proc/cpuinfo
RAW_SERIAL=$(awk '/Serial/ {print $3}' /proc/cpuinfo 2>/dev/null | tr -d '[:space:]')

# Nếu không có hoặc toàn số 0 thì fallback sang MAC address của eth0 hoặc wlan0
if [ -z "$RAW_SERIAL" ] || [ "$RAW_SERIAL" = "0000000000000000" ]; then
    if [ -f /sys/class/net/eth0/address ]; then
        RAW_SERIAL=$(cat /sys/class/net/eth0/address | tr -d ':[:space:]')
    elif [ -f /sys/class/net/wlan0/address ]; then
        RAW_SERIAL=$(cat /sys/class/net/wlan0/address | tr -d ':[:space:]')
    fi
fi

if [ -z "$RAW_SERIAL" ]; then
    echo "[ERROR] Khong the xac dinh duoc Device ID duy nhat cho thiet bi." >&2
    exit 1
fi

DEVICE_ID="DRONE-${RAW_SERIAL}"
echo "[INFO] Device ID xac dinh: $DEVICE_ID"
echo "[INFO] Hardware Model: $HARDWARE_MODEL"

# --- 4. SMART AUTOPILOT / FLIGHT CONTROLLER (AP) DETECTION & MAVLINK PROBING ---
# Tự động quét và nhận diện Flight Controller bất kể cắm vào cổng nào / chip nào:
# - Native USB: MicroAir, Pixhawk, Cube, ArduPilot, PX4, STM32, Holybro, CUAV, Matek, SpeedyBee...
# - USB-UART Bridge: CP210x, FTDI, CH340, PL2303...
# - Loại trừ hoàn toàn các cổng Modem SIM (SIMCom, Quectel...)
# - Thăm dò MAVLink Heartbeat (0xFD / 0xFE) để đảm bảo không nhận nhầm LiDAR/Gimbal/GPS.

echo "[INFO] Dang tu dong quet va nhan dien Flight Controller (Autopilot)..."
FC_DEVICE=""
MODEM_FILTER_REGEX="SIMCom|SIM82|SIM7|Quectel|RM50|RM52|Qualcomm|Fibocom|Telit|Modem|CDC-WDM|Android|EC20|EC25"

# Hàm thăm dò tín hiệu MAVLink trên một cổng serial cụ thể (thử đọc trong 1 giây)
probe_mavlink_port() {
    local port="$1"
    [ ! -e "$port" ] && return 1
    stty -F "$port" "$MAVLINK_DEFAULT_BAUD" raw -echo 2>/dev/null || true
    # MAVLink v2 bắt đầu bằng byte 0xFD, MAVLink v1 bắt đầu bằng byte 0xFE
    if timeout 1 head -c 128 "$port" 2>/dev/null | grep -q -P '[\xFD\xFE]'; then
        return 0
    fi
    return 1
}

# Quét qua các ứng viên
CANDIDATES=()

if [ -d /dev/serial/by-id ]; then
    # 1. Tìm các thiết bị Native Autopilot trước
    while IFS= read -r line; do
        [ -n "$line" ] && CANDIDATES+=("$line")
    done < <(find /dev/serial/by-id/ -maxdepth 1 -type l \( \
        -iname "*ArduPilot*" -o \
        -iname "*Pixhawk*" -o \
        -iname "*Cube*" -o \
        -iname "*MicroAir*" -o \
        -iname "*PX4*" -o \
        -iname "*Holybro*" -o \
        -iname "*CUAV*" -o \
        -iname "*Matek*" -o \
        -iname "*SpeedyBee*" -o \
        -iname "*STM32*" \
    \) 2>/dev/null)

    # 2. Tìm các chip USB-to-UART (đã lọc bỏ Modem SIM)
    while IFS= read -r line; do
        [ -n "$line" ] && CANDIDATES+=("$line")
    done < <(find /dev/serial/by-id/ -maxdepth 1 -type l \( \
        -iname "*CP210*" -o \
        -iname "*Silicon_Labs*" -o \
        -iname "*FTDI*" -o \
        -iname "*FT232*" -o \
        -iname "*CH34*" -o \
        -iname "*PL2303*" -o \
        -iname "*ProLific*" -o \
        -iname "*CH91*" \
    \) 2>/dev/null | grep -E -v "$MODEM_FILTER_REGEX")

    # 3. Bất kỳ serial device nào khác (không phải modem SIM)
    while IFS= read -r line; do
        [ -n "$line" ] && CANDIDATES+=("$line")
    done < <(find /dev/serial/by-id/ -maxdepth 1 -type l 2>/dev/null | grep -E -v "$MODEM_FILTER_REGEX")
fi

# 4. Thêm các cổng /dev/ttyACM*
for acm in /dev/ttyACM*; do
    [ -e "$acm" ] && CANDIDATES+=("$acm")
done

# 5. Thêm cổng GPIO phần cứng
[ -e "/dev/serial0" ] && CANDIDATES+=("/dev/serial0")

# Thăm dò từng ứng viên bằng MAVLink probing (nếu có nhiều thiết bị)
if [ ${#CANDIDATES[@]} -gt 1 ]; then
    echo "[INFO] Phat hien nhieu thiet bi Serial (${#CANDIDATES[@]}). Tien hanh tham do goi tin MAVLink..."
    for cand in "${CANDIDATES[@]}"; do
        if probe_mavlink_port "$cand"; then
            FC_DEVICE="$cand"
            echo "[INFO] Xac thuc thanh cong Flight Controller qua MAVLink stream: $FC_DEVICE"
            break
        fi
    done
fi

# Nếu chưa chọn được qua probe, lấy ứng viên ưu tiên cao nhất
if [ -z "$FC_DEVICE" ] && [ ${#CANDIDATES[@]} -gt 0 ]; then
    FC_DEVICE="${CANDIDATES[0]}"
    echo "[INFO] Chon thiet bi Serial phu hop nhat theo ID: $FC_DEVICE"
fi

# Fallback cuối cùng
if [ -z "$FC_DEVICE" ]; then
    FC_DEVICE="/dev/ttyUSB0"
    echo "[WARN] Khong tim thay Autopilot qua ID. Fallback mac dinh ve: $FC_DEVICE"
fi

echo "[INFO] Cong Flight Controller xac dinh: $FC_DEVICE"

# --- 5. DYNAMIC UPDATE FOR MAVLINK ROUTER ---
# Đảm bảo /etc/mavlink-router/main.conf luôn phản ánh đúng cổng Flight Controller hiện tại
mkdir -p /etc/mavlink-router /etc/wireguard /etc/drone

if [ -f "$MAVLINK_CONF" ]; then
    CURRENT_FC=$(awk -F '=' '/^Device=/ {print $2}' "$MAVLINK_CONF" | tr -d '[:space:]')
    if [ "$CURRENT_FC" != "$FC_DEVICE" ]; then
        echo "[INFO] Phat hien thay doi cong ngoai vi FC (Cu: $CURRENT_FC -> Moi: $FC_DEVICE). Cap nhat main.conf..."
        sed -i "s|^Device=.*|Device=$FC_DEVICE|" "$MAVLINK_CONF"
        if systemctl is-active --quiet mavlink-router; then
            systemctl restart mavlink-router || true
            echo "[INFO] Da khoi dong lai mavlink-router voi cong moi."
        fi
    fi
fi

# --- 6. HÀM TỰ ĐỘNG CẬP NHẬT OTA (CHỈ TẢI ĐÚNG 2 FILE KHI CÓ THAY ĐỔI) ---
# Tác dụng: Tiết kiệm tối đa bộ nhớ thẻ nhớ và data 4G/5G.
# - Sử dụng cờ 'curl -z' (If-Modified-Since) để hỏi GitHub: Nếu file không đổi thì không tải nội dung.
# - Kiểm tra tính toàn vẹn cú pháp bằng 'bash -n' trước khi ghi đè để chống hỏng hệ thống.
check_and_apply_ota_updates() {
    local target_script="/opt/drone/onboard-agent.sh"
    local target_service="/etc/systemd/system/drone-onboard.service"
    local tmp_script="/tmp/onboard-agent.sh.new"
    local tmp_service="/tmp/drone-onboard.service.new"

    echo "[INFO] Dang kiem tra ban cap nhat OTA (.sh & .service) tu GitHub..."

    # 1. Kiểm tra cập nhật file script onboard-agent.sh
    if [ -f "$target_script" ]; then
        # curl -z "$target_script": Chỉ tải về nếu file trên GitHub mới hơn file nội bộ hiện tại
        if curl -fsSL -z "$target_script" --connect-timeout 4 "$OTA_SCRIPT_URL" -o "$tmp_script" 2>/dev/null; then
            # Kiểm tra: File tải về phải có dung lượng (>0 byte) và cú pháp Bash phải chuẩn xác 100%
            if [ -s "$tmp_script" ] && bash -n "$tmp_script" 2>/dev/null; then
                local old_hash=$(sha256sum "$target_script" 2>/dev/null | awk '{print $1}')
                local new_hash=$(sha256sum "$tmp_script" 2>/dev/null | awk '{print $1}')

                if [ "$old_hash" != "$new_hash" ]; then
                    echo "[INFO] [OTA] Phat hien script moi tren GitHub! Tien hanh cap nhat..."
                    cp -f "$tmp_script" "$target_script"
                    chmod +x "$target_script"
                    rm -f "$tmp_script"

                    # Khởi chạy lại chính nó bằng phiên bản mới vừa cập nhật (Hot-Reload)
                    echo "[INFO] [OTA] Cap nhat script thanh cong! Khoi chay phien ban moi..."
                    exec "$target_script" "$@"
                fi
            fi
        fi
        rm -f "$tmp_script"
    fi

    # 2. Kiểm tra cập nhật file drone-onboard.service
    if [ -f "$target_service" ]; then
        if curl -fsSL -z "$target_service" --connect-timeout 4 "$OTA_SERVICE_URL" -o "$tmp_service" 2>/dev/null; then
            if [ -s "$tmp_service" ]; then
                local old_srv_hash=$(sha256sum "$target_service" 2>/dev/null | awk '{print $1}')
                local new_srv_hash=$(sha256sum "$tmp_service" 2>/dev/null | awk '{print $1}')

                if [ "$old_srv_hash" != "$new_srv_hash" ]; then
                    echo "[INFO] [OTA] Phat hien service moi tren GitHub! Cap nhat systemd..."
                    cp -f "$tmp_service" "$target_service"
                    systemctl daemon-reload
                fi
            fi
        fi
        rm -f "$tmp_service"
    fi
}

# --- 7. FAST BOOT CHECK (Nếu đã có cấu hình WireGuard thì kích hoạt ngay) ---
if [ -f "$WG_CONF" ]; then
    echo "[INFO] Cau hinh WireGuard da ton tai ($WG_CONF). Tien hanh Fast Boot..."
    systemctl enable wg-quick@wg0 >/dev/null 2>&1 || true
    if ! wg show wg0 >/dev/null 2>&1; then
        echo "[INFO] Dang kich hoat giao dien mang wg0..."
        systemctl restart wg-quick@wg0 || true
    fi

    # Nếu card mạng WireGuard đã lên thành công -> Kiểm tra OTA nhanh và sẵn sàng bay
    if wg show wg0 >/dev/null 2>&1; then
        echo "[INFO] WireGuard wg0 da hoat dong on dinh."
        # Đảm bảo mavlink-router cũng đang chạy
        if systemctl list-unit-files "mavlink-router*" >/dev/null 2>&1; then
            systemctl enable --now mavlink-router >/dev/null 2>&1 || systemctl restart mavlink-router >/dev/null 2>&1 || true
        fi

        # Kiểm tra cập nhật OTA ngầm (nếu có Internet) mà không làm gián đoạn bay
        check_and_apply_ota_updates || true

        echo "========================================================"
        echo "    FAST BOOT HOAN TAT: DRONE SAN SANG HOAT DONG!      "
        echo "    Device ID : $DEVICE_ID                              "
        echo "    FC Port   : $FC_DEVICE                              "
        echo "========================================================"
        exit 0
    else
        echo "[WARN] Interface wg0 chua len duoc (co the file loi/het han). Chuyen sang luong Cloud Provisioning..."
    fi
fi

# --- 8. WAIT FOR 5G / CELLULAR NETWORK (Dành cho lần xuất xưởng hoặc khi cần cấp lại) ---
echo "[INFO] Dang tu dong quet va cho ket noi mang 5G / Di dong..."
ELAPSED=0
ACTIVE_INTERFACE=""
ACTIVE_IP=""

while true; do
    # 1. Tìm interface có Default Gateway ra Internet (ưu tiên cao nhất)
    DEFAULT_IF=$(ip route show default 2>/dev/null | awk '/default/ {print $5}' | head -n 1)
    if [ -n "$DEFAULT_IF" ] && [ "$DEFAULT_IF" != "lo" ] && [[ "$DEFAULT_IF" != wg* ]] && [ "$DEFAULT_IF" != "docker0" ]; then
        ACTIVE_IP=$(ip -4 addr show dev "$DEFAULT_IF" 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n 1)
        if [ -n "$ACTIVE_IP" ]; then
            ACTIVE_INTERFACE="$DEFAULT_IF"
            echo "[INFO] Tim thay card mang Internet mac dinh: $ACTIVE_INTERFACE (IP: $ACTIVE_IP)"
            break
        fi
    fi

    # 2. Quét qua tất cả interface di động phổ biến (wwan*, usb*, enx*, wwx*, ppp*, eth1, eth2)
    for candidate_if in $(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | grep -E '^(wwan|usb|enx|wwx|ppp|eth1|eth2)'); do
        candidate_ip=$(ip -4 addr show dev "$candidate_if" 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n 1)
        if [ -n "$candidate_ip" ]; then
            ACTIVE_INTERFACE="$candidate_if"
            ACTIVE_IP="$candidate_ip"
            echo "[INFO] Tu dong nhan dien module SIM tren card: $ACTIVE_INTERFACE (IP: $ACTIVE_IP)"
            break 2
        fi
    done

    # 3. Fallback: Kiểm tra interface cấu hình sẵn nếu có
    if [ -n "$INTERFACE_WWAN" ] && ip link show dev "$INTERFACE_WWAN" >/dev/null 2>&1; then
        candidate_ip=$(ip -4 addr show dev "$INTERFACE_WWAN" 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n 1)
        if [ -n "$candidate_ip" ]; then
            ACTIVE_INTERFACE="$INTERFACE_WWAN"
            ACTIVE_IP="$candidate_ip"
            echo "[INFO] Giao dien $INTERFACE_WWAN da san sang voi IP: $ACTIVE_IP"
            break
        fi
    fi

    if [ "$ELAPSED" -ge "$MAX_WWAN_WAIT" ]; then
        echo "[ERROR] Qua thoi gian cho mang di dong ($MAX_WWAN_WAIT giay). Khong tim thay ket noi Internet IPv4." >&2
        exit 1
    fi

    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo "[INFO] Dang cho module SIM nhan IP tu nha mang... (${ELAPSED}/${MAX_WWAN_WAIT}s)"
done

# Kiểm tra OTA trước khi gọi API Provisioning
check_and_apply_ota_updates || true

# --- 9. CALL PROVISIONING API (Gọi API với cơ chế Retry & Bảo mật) ---
echo "[INFO] Bat dau gui yeu cau dang ky toi Provisioning API..."

PAYLOAD=$(jq -n \
  --arg deviceId "$DEVICE_ID" \
  --arg hardwareModel "$HARDWARE_MODEL" \
  --arg provisionToken "$PROVISION_TOKEN" \
  '{deviceId: $deviceId, hardwareModel: $hardwareModel, provisionToken: $provisionToken}')

RESPONSE_FILE=$(mktemp /tmp/provision_response.XXXXXX)
chmod 600 "$RESPONSE_FILE"
trap 'rm -f "$RESPONSE_FILE"' EXIT

API_SUCCESS=0
for i in $(seq 1 "$API_MAX_RETRIES"); do
    echo "[INFO] Goi Provisioning API (Lan $i/$API_MAX_RETRIES)..."
    
    if curl -fsS -X POST \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        "$PROVISION_API_URL" > "$RESPONSE_FILE" 2>/dev/null; then
        
        API_SUCCESS=1
        echo "[INFO] Ket noi thanh cong toi Provisioning API!"
        break
    else
        echo "[WARN] Khong the ket noi toi API hoac Server tra ve ma loi. Thu lai sau ${API_RETRY_INTERVAL}s..."
        sleep "$API_RETRY_INTERVAL"
    fi
done

if [ "$API_SUCCESS" -ne 1 ]; then
    echo "[ERROR] Goi Provisioning API that bai sau $API_MAX_RETRIES lan thu." >&2
    exit 1
fi

# --- 10. VALIDATE API RESPONSE ---
echo "[INFO] Dang kiem tra tinh hop le cua du lieu phan hoi..."

STATUS=$(jq -r '.status // empty' "$RESPONSE_FILE")
if [ "$STATUS" != "success" ]; then
    ERR_MSG=$(jq -r '.message // "Unknown error"' "$RESPONSE_FILE")
    echo "[ERROR] API tu choi cap phat: $ERR_MSG" >&2
    exit 1
fi

ASSIGNED_IP=$(jq -r '.data.assignedIp // empty' "$RESPONSE_FILE")
VPN_ADDRESS=$(jq -r '.data.vpn.address // empty' "$RESPONSE_FILE")
PRIVATE_KEY=$(jq -r '.data.vpn.privateKey // empty' "$RESPONSE_FILE")
SERVER_PUBKEY=$(jq -r '.data.vpn.serverPublicKey // empty' "$RESPONSE_FILE")
SERVER_ENDPOINT=$(jq -r '.data.vpn.serverEndpoint // empty' "$RESPONSE_FILE")
ALLOWED_IPS=$(jq -r '.data.vpn.allowedIps // empty' "$RESPONSE_FILE")
PERSISTENT_KEEPALIVE=$(jq -r '.data.vpn.persistentKeepalive // empty' "$RESPONSE_FILE")
MAVLINK_HOST=$(jq -r '.data.mavlink.targetHost // empty' "$RESPONSE_FILE")
MAVLINK_PORT=$(jq -r '.data.mavlink.targetPort // empty' "$RESPONSE_FILE")

# Xác thực không được để trống bất kỳ trường quan trọng nào
for field_var in ASSIGNED_IP VPN_ADDRESS PRIVATE_KEY SERVER_PUBKEY SERVER_ENDPOINT ALLOWED_IPS PERSISTENT_KEEPALIVE MAVLINK_HOST MAVLINK_PORT; do
    eval "val=\$$field_var"
    if [ -z "$val" ] || [ "$val" = "null" ]; then
        echo "[ERROR] Du lieu phan hoi thieu truong bat buoc: $field_var. Huy bo qua trinh ghi cau hinh!" >&2
        exit 1
    fi
done

echo "[INFO] Xac thuc du lieu thanh cong! IP duoc cap: $ASSIGNED_IP"

# --- 11. BACKUP & WRITE CONFIGURATIONS ---
[ -f "$WG_CONF" ] && cp -f "$WG_CONF" "$WG_CONF_BAK"
[ -f "$MAVLINK_CONF" ] && cp -f "$MAVLINK_CONF" "$MAVLINK_CONF_BAK"

echo "[INFO] Dang ghi file cau hinh $WG_CONF..."
cat <<EOF > "$WG_CONF"
[Interface]
Address = $VPN_ADDRESS
PrivateKey = $PRIVATE_KEY

[Peer]
PublicKey = $SERVER_PUBKEY
Endpoint = $SERVER_ENDPOINT
AllowedIPs = $ALLOWED_IPS
PersistentKeepalive = $PERSISTENT_KEEPALIVE
EOF

chmod 600 "$WG_CONF"

echo "[INFO] Dang ghi file cau hinh $MAVLINK_CONF..."
cat <<EOF > "$MAVLINK_CONF"
[General]
TcpServerPort=5760
ReportStats=false
MavlinkDialect=ardupilotmega

[UartEndpoint alpha]
Device=$FC_DEVICE
Baud=$MAVLINK_DEFAULT_BAUD

[UdpEndpoint cloud]
Mode=Normal
Address=$MAVLINK_HOST
Port=$MAVLINK_PORT
EOF

chmod 644 "$MAVLINK_CONF"

# --- 12. START & VERIFY WIREGUARD (Rollback nếu lỗi) ---
echo "[INFO] Dang khoi dong giao dien mang WireGuard wg0..."

systemctl enable wg-quick@wg0 >/dev/null 2>&1 || true
if ! systemctl restart wg-quick@wg0; then
    echo "[ERROR] Khong the khoi dong WireGuard qua systemctl!" >&2
    if [ -f "$WG_CONF_BAK" ]; then
        mv -f "$WG_CONF_BAK" "$WG_CONF"
        systemctl restart wg-quick@wg0 || true
    fi
    exit 1
fi

sleep 2
if ! wg show wg0 >/dev/null 2>&1; then
    echo "[ERROR] Interface wg0 khong ton tai sau khi khoi dong!" >&2
    if [ -f "$WG_CONF_BAK" ]; then
        mv -f "$WG_CONF_BAK" "$WG_CONF"
        systemctl restart wg-quick@wg0 || true
    fi
    exit 1
fi

# --- 13. START MAVLINK ROUTER ---
echo "[INFO] Dang khoi dong mavlink-router..."
if systemctl list-unit-files "mavlink-router*" >/dev/null 2>&1; then
    systemctl enable --now mavlink-router >/dev/null 2>&1 || systemctl restart mavlink-router >/dev/null 2>&1 || true
    echo "[INFO] Da khoi dong mavlink-router service."
fi

# Dọn dẹp backup
rm -f "$WG_CONF_BAK" "$MAVLINK_CONF_BAK"

echo "========================================================"
echo "    PROVISIONING HOAN TAT THANH CONG!                   "
echo "    Device ID : $DEVICE_ID                              "
echo "    VPN IP    : $ASSIGNED_IP                            "
echo "    FC Port   : $FC_DEVICE                              "
echo "    Server VPN: $MAVLINK_HOST                           "
echo "========================================================"

exit 0
