/**
 * ==============================================================================
 * MODULE 4: TACTICAL LEAFLET MAP (map.js)
 * ==============================================================================
 * Mục đích:
 *  - Khởi tạo bản đồ tác chiến Leaflet với lớp nền tối Dark Tactical (CartoDB DarkMatter).
 *  - Tạo và cập nhật Marker máy bay trực quan: xoay theo hướng bay thật (Heading 0-360°)
 *    và tự đổi màu theo trạng thái Arm (Xanh lá khi Arm / Xanh dương khi Disarm).
 *  - Cung cấp các hàm căn chỉnh và phóng to vị trí Drone trên bản đồ.
 * ==============================================================================
 */

/**
 * Khởi tạo bản đồ tác chiến chiến thuật Leaflet Map.
 */
function initTacticalMap() {
  if (map) return;

  // Khởi tạo Leaflet Map căn giữa tọa độ mặc định (Hà Nội: 21.005512, 105.843120, Zoom: 16)
  // Bật preferCanvas: true để vẽ toàn bộ Vector/Polyline lên HTML5 Canvas, tăng tốc độ render x10 lần
  map = L.map('tactical-map', { 
    zoomControl: false,
    preferCanvas: true
  }).setView([21.005512, 105.843120], 16);

  // Đặt nút điều khiển Zoom ở góc trên cùng bên phải
  L.control.zoom({ position: 'topright' }).addTo(map);

  // Lớp bản đồ nền tối quân sự (CartoDB DarkMatter Tile Layer)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB &copy; OpenStreetMap contributors',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);
}

/**
 * Tạo Icon hiển thị Drone dưới dạng hình mũi tên máy bay SVG:
 *  - Tự động xoay góc theo thông số Heading (0° - 360°).
 *  - Phân biệt màu sắc:
 *    + Drone của mình (isMyDrone = true): Xanh Lục Neon (ARMED) hoặc Xanh Cyan Sáng (DISARMED) với hào quang nổi bật.
 *    + Drone người khác (isMyDrone = false): Vàng Cam Hổ Phách (ARMED) hoặc Xám Bạc (DISARMED) để dễ nhận diện.
 * 
 * @param {number} headingDeg Góc phương vị la bàn (0 - 360 độ)
 * @param {boolean} armed Trạng thái khóa động cơ (True: Đã Arm, False: Chưa Arm)
 * @param {boolean} isMyDrone Có phải là Drone do tài khoản này sở hữu hay không
 * @returns {any} Leaflet DivIcon
 */
function createDroneIcon(headingDeg, armed, isMyDrone = true) {
  let color, glow, badgeBorder;

  if (isMyDrone) {
    // 🟢 DRONE CỦA MÌNH: Màu sáng công nghệ nổi bật (Emerald / Cyan)
    color = armed ? '#10b981' : '#00f0ff';
    glow = armed ? 'rgba(16,185,129,0.85)' : 'rgba(0,240,255,0.85)';
    badgeBorder = 'border: 1px solid rgba(0,240,255,0.4); border-radius: 50%;';
  } else {
    // 🟡 DRONE NGƯỜI KHÁC / NGOẠI LAI: Màu Vàng Cam Amber / Xám Bạc
    color = armed ? '#f59e0b' : '#94a3b8';
    glow = armed ? 'rgba(245,158,11,0.6)' : 'rgba(148,163,184,0.4)';
    badgeBorder = 'border: 1px dashed rgba(245,158,11,0.3); border-radius: 50%;';
  }

  return L.divIcon({
    className: 'custom-drone-icon',
    html: `
      <div style="transform: rotate(${headingDeg || 0}deg); transition: transform 0.1s linear; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; ${badgeBorder}">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="${color}" style="filter: drop-shadow(0 0 8px ${glow});">
          <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z"/>
        </svg>
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });
}

/**
 * Di chuyển camera bản đồ đến vị trí Drone được chọn hoặc bao quát toàn bộ phi đội.
 * 
 * @param {string} deviceId Mã Drone cần căn chỉnh ('all' hoặc 'DRONE-001'...)
 */
function focusDroneOnMap(deviceId) {
  if (deviceId === 'all' || !deviceId) {
    activeDroneId = 'all';

    // Nếu đang mở xem camera mà chuyển sang "Theo dõi tất cả" -> Tự động đóng Video
    if (typeof isFpvVideoActive === 'function' && isFpvVideoActive()) {
      closeFpvVideoStream(true);
    }

    // Nếu chọn 'all', tự động điều chỉnh khung nhìn vừa vặn với toàn bộ các Drone đang bay
    const markers = Object.values(droneMarkers);
    if (markers.length > 0 && map) {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
    }
    return;
  }

  // Chọn Drone cho HUD
  selectDroneForHud(deviceId);

  // Phóng to và di chuyển tâm bản đồ tới vị trí Drone
  const marker = droneMarkers[deviceId];
  if (marker && map) {
    map.setView(marker.getLatLng(), 17);
  }
}

/**
 * Gỡ bỏ Marker của Drone khỏi bản đồ khi Drone Offline (Giữ nguyên đường bay lịch sử).
 * 
 * @param {string} deviceId Mã Drone cần gỡ
 * @param {boolean} clearTrail Có xóa vĩnh viễn đường bay không (mặc định là false)
 */
function removeDroneFromMap(deviceId, clearTrail = false) {
  if (!deviceId) return;
  if (droneMarkers[deviceId]) {
    if (map) map.removeLayer(droneMarkers[deviceId]);
    delete droneMarkers[deviceId];
  }
  if (clearTrail && droneFlightTrails[deviceId]) {
    if (map) map.removeLayer(droneFlightTrails[deviceId]);
    delete droneFlightTrails[deviceId];
  }
}

/**
 * Xóa sạch toàn bộ đường bay trên bản đồ khi người dùng chủ động yêu cầu
 */
function clearAllFlightTrails() {
  Object.keys(droneFlightTrails).forEach(id => {
    if (map && droneFlightTrails[id]) {
      map.removeLayer(droneFlightTrails[id]);
    }
  });
  droneFlightTrails = {};
}
