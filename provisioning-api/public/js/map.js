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
 *  - Đổi màu và hiệu ứng phát sáng (Glow): Xanh lá (ARMED) hoặc Xanh dương (DISARMED).
 * 
 * @param {number} headingDeg Góc phương vị la bàn (0 - 360 độ)
 * @param {boolean} armed Trạng thái khóa động cơ (True: Đã Arm, False: Chưa Arm)
 * @returns {any} Leaflet DivIcon
 */
function createDroneIcon(headingDeg, armed) {
  const color = armed ? '#10b981' : '#38bdf8';
  const glow = armed ? 'rgba(16,185,129,0.5)' : 'rgba(56,189,248,0.5)';

  return L.divIcon({
    className: 'custom-drone-icon',
    html: `
      <div style="transform: rotate(${headingDeg || 0}deg); transition: transform 0.1s linear; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="${color}" style="filter: drop-shadow(0 0 8px ${glow});">
          <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z"/>
        </svg>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
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
