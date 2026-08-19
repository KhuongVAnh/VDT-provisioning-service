#!/bin/sh

# onboard-agent.sh
# Zero-Touch Provisioning Agent for Drone Companion Computer (Raspberry Pi)

# Configuration
PROVISION_API_URL="http://103.253.20.32:10004/api/v1/provisioning/register"
PROVISION_TOKEN="FACTORY_SECRET_KEY_2026"
HARDWARE_MODEL="Raspberry Pi 4 Model B Rev 1.5"

# Required dependencies: jq, curl, wireguard-tools
for cmd in jq curl wg; do
  if ! command -v $cmd >/dev/null 2>&1; then
    echo "Error: Required command '$cmd' not found. Please install it."
    exit 1
  fi
done

echo "Starting Drone Provisioning Agent..."

# 1. Read CPU Serial from /proc/cpuinfo
# Using sed/awk to reliably extract Serial on Pi
DEVICE_ID=$(cat /proc/cpuinfo | grep 'Serial' | awk '{print $3}')
if [ -z "$DEVICE_ID" ]; then
    # Fallback to eth0 MAC address if CPU serial is empty or not found
    DEVICE_ID=$(cat /sys/class/net/eth0/address | tr -d ':')
fi

if [ -z "$DEVICE_ID" ]; then
    echo "Error: Could not determine unique Device ID."
    exit 1
fi

DEVICE_ID="DRONE-${DEVICE_ID}"
echo "Detected Device ID: $DEVICE_ID"

# 2. Wait until wwan0 has a usable IP address
INTERFACE="wwan0"
MAX_WAIT=120
WAIT_TIME=0

echo "Waiting for $INTERFACE to get an IP address..."
while ! ip -4 addr show dev $INTERFACE | grep -q inet; do
    sleep 5
    WAIT_TIME=$((WAIT_TIME + 5))
    if [ $WAIT_TIME -ge $MAX_WAIT ]; then
        echo "Timeout waiting for $INTERFACE IP."
        # We exit 1, allowing systemd to restart this service later
        exit 1
    fi
done

echo "$INTERFACE is up and has an IP address."

# 3. Call Provisioning API
echo "Registering device with Cloud..."
PAYLOAD=$(jq -n \
  --arg deviceId "$DEVICE_ID" \
  --arg hardwareModel "$HARDWARE_MODEL" \
  --arg provisionToken "$PROVISION_TOKEN" \
  '{deviceId: $deviceId, hardwareModel: $hardwareModel, provisionToken: $provisionToken}')

RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$PROVISION_API_URL")

# Check if curl succeeded
if [ $? -ne 0 ]; then
    echo "Error: Failed to connect to provisioning API."
    exit 1
fi

# Parse response
STATUS=$(echo "$RESPONSE" | jq -r '.status')

if [ "$STATUS" != "success" ]; then
    MESSAGE=$(echo "$RESPONSE" | jq -r '.message')
    echo "Provisioning failed: $MESSAGE"
    exit 1
fi

echo "Provisioning successful!"

# Extract data
ASSIGNED_IP=$(echo "$RESPONSE" | jq -r '.data.assignedIp')
VPN_ADDRESS=$(echo "$RESPONSE" | jq -r '.data.vpn.address')
PRIVATE_KEY=$(echo "$RESPONSE" | jq -r '.data.vpn.privateKey')
SERVER_PUBKEY=$(echo "$RESPONSE" | jq -r '.data.vpn.serverPublicKey')
SERVER_ENDPOINT=$(echo "$RESPONSE" | jq -r '.data.vpn.serverEndpoint')
ALLOWED_IPS=$(echo "$RESPONSE" | jq -r '.data.vpn.allowedIps')
PERSISTENT_KEEPALIVE=$(echo "$RESPONSE" | jq -r '.data.vpn.persistentKeepalive')
MAVLINK_HOST=$(echo "$RESPONSE" | jq -r '.data.mavlink.targetHost')
MAVLINK_PORT=$(echo "$RESPONSE" | jq -r '.data.mavlink.targetPort')

# 4. Generate configurations

echo "Generating /etc/wireguard/wg0.conf..."
mkdir -p /etc/wireguard
cat <<EOF > /etc/wireguard/wg0.conf
[Interface]
Address = $VPN_ADDRESS
PrivateKey = $PRIVATE_KEY

[Peer]
PublicKey = $SERVER_PUBKEY
Endpoint = $SERVER_ENDPOINT
AllowedIPs = $ALLOWED_IPS
PersistentKeepalive = $PERSISTENT_KEEPALIVE
EOF
chmod 600 /etc/wireguard/wg0.conf

echo "Generating /etc/mavlink-router/main.conf..."
mkdir -p /etc/mavlink-router
cat <<EOF > /etc/mavlink-router/main.conf
[General]
TcpServerPort=5760
ReportStats=false
MavlinkDialect=ardupilotmega

[UartEndpoint alpha]
Device=/dev/ttyUSB0
Baud=921600

[UdpEndpoint cloud]
Mode=Normal
Address=$MAVLINK_HOST
Port=$MAVLINK_PORT
EOF

# 5. Start Services
echo "Starting wg-quick@wg0..."
systemctl enable --now wg-quick@wg0
systemctl restart wg-quick@wg0

echo "Starting mavlink-router..."
systemctl enable --now mavlink-router
systemctl restart mavlink-router

# 6. Disable the onboarding service so it doesn't run again on next boot
echo "Disabling drone-onboard.service..."
systemctl disable drone-onboard.service

echo "Provisioning completed successfully!"
exit 0
