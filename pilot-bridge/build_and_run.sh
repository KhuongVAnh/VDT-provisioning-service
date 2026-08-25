#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================"
echo "    🚀 BIÊN DỊCH VÀ KHỞI CHẠY QT PILOT BRIDGE         "
echo "======================================================"

# Kiểm tra thư viện MAVLink
if [ ! -d "3rdparty/mavlink/common" ]; then
    echo "[1/3] Đang tải bộ thư viện MAVLink v2 C headers..."
    mkdir -p 3rdparty
    cd 3rdparty
    git clone --depth 1 https://github.com/mavlink/c_library_v2.git mavlink
    cd "$SCRIPT_DIR"
fi

# Kiểm tra thư viện WebRTC libdatachannel
if [ ! -d "3rdparty/libdatachannel/src" ]; then
    echo "[1.5/3] Đang tải bộ thư viện WebRTC libdatachannel..."
    mkdir -p 3rdparty
    cd 3rdparty
    git clone --recursive -b v0.21.1 https://github.com/paullouisageneau/libdatachannel.git libdatachannel
    cd "$SCRIPT_DIR"
fi

echo "[2/3] Đang cấu hình CMake..."
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release

echo "[3/3] Đang biên dịch mã nguồn C++..."
cmake --build build -j$(nproc)

echo "======================================================"
echo "    ✅ BIÊN DỊCH THÀNH CÔNG! ĐANG KHỞI CHẠY APP...    "
echo "======================================================"
export QT_QPA_PLATFORM=xcb
./build/pilot_bridge "$@"
