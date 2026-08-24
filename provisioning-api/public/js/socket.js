/**
 * ==============================================================================
 * MODULE 7: WEBSOCKET & TELEMETRY STREAM (socket.js)
 * ==============================================================================
 * Mục đích:
 *  - Thiết lập kết nối thời gian thực 2 chiều Socket.IO tới Gateway (Port 10004).
 *  - Đăng ký nhận luồng Telemetry nhị phân 10Hz từ Redis Pub/Sub của Ingestion Engine.
 *  - Cập nhật vị trí tọa độ, góc xoay la bàn, đường bay (Flight Trails) và đẩy lên HUD.
 * ==============================================================================
 */

/**
 * Khởi tạo kết nối Socket.IO tới máy chủ Gateway và lắng nghe các sự kiện thời gian thực.
 */
function initWebSocket() {
  socket = io();

  // Khi kết nối WebSocket thành công
  socket.on('connect', () => {
    console.log('[WEBSOCKET] Đã kết nối Socket.IO thành công (Socket ID:', socket.id, ')');
    const wsBadge = document.getElementById('ws-status-text');
    if (wsBadge) wsBadge.innerText = 'GATEWAY 10004 LIVE';

    // Đăng ký nhận luồng Telemetry của toàn bộ phi đội Drone
    socket.emit('subscribe:all');
  });

  // Khi mất kết nối tới máy chủ
  socket.on('disconnect', () => {
    console.warn('[WEBSOCKET] Mất kết nối Socket.IO! Đang chờ tự động kết nối lại...');
    const wsBadge = document.getElementById('ws-status-text');
    if (wsBadge) wsBadge.innerText = 'MẤT KẾT NỐI (RECONNECTING...)';
  });

  // Khi nhận được gói tin cập nhật Telemetry từ Drone (Tần số ~ 10Hz)
  socket.on('telemetry:update', (data) => {
    handleIncomingTelemetry(data);
  });

  // Nhận dữ liệu stream phản hồi từ phiên Web SSH
  socket.on('ssh:data', (payload) => {
    if (term && payload?.data) {
      term.write(payload.data);
    }
  });

  // Nhận thông báo trạng thái kết nối Web SSH (Connecting / Connected / Closed)
  socket.on('ssh:status', (payload) => {
    if (DOM.sshStatus) {
      DOM.sshStatus.innerText = `Trạng thái: ${payload.message || payload.status}`;
    }
  });
}

/**
 * Xử lý dữ liệu Telemetry thời gian thực nhận được từ Drone:
 *  1. Cập nhật vị trí Marker trên bản đồ Leaflet và xoay góc Heading.
 *  2. Vẽ đường bay lịch sử (Flight Trail Polyline).
 *  3. Cập nhật các chỉ số bay lên Cockpit HUD nếu Drone này đang được chọn.
 * 
 * @param {any} t Gói tin Telemetry
 */
function handleIncomingTelemetry(t) {
  if (!t || !t.deviceId) return;

  const lat = t.gps?.lat;
  const lon = t.gps?.lon;
  const heading = t.gps?.headingDeg || 0;

  // Cập nhật vị trí trên bản đồ nếu tọa độ GPS hợp lệ (khác 0,0)
  if (lat && lon && lat !== 0 && lon !== 0 && map) {
    if (!droneMarkers[t.deviceId]) {
      // Nếu Drone chưa có Marker trên bản đồ -> Tạo mới
      const marker = L.marker([lat, lon], {
        icon: createDroneIcon(heading, t.armed)
      }).addTo(map);

      marker.bindTooltip(`<b>${t.deviceId}</b><br>IP: ${t.vpnIp || '10.13.37.X'}<br>Mode: ${t.flightMode || 'ONLINE'}`, {
        permanent: false,
        direction: 'top'
      });

      marker.on('click', () => selectDroneForHud(t.deviceId));
      droneMarkers[t.deviceId] = marker;

      // Khởi tạo đường bay nét mảnh màu Cyan
      droneFlightTrails[t.deviceId] = L.polyline([[lat, lon]], {
        color: '#00f0ff',
        weight: 2,
        opacity: 0.65
      }).addTo(map);

      populateDroneDropdowns(fleetDevices);

      // Nếu đây là Drone đầu tiên xuất hiện, tự động căn giữa bản đồ vào vị trí Drone
      if (Object.keys(droneMarkers).length === 1) {
        map.setView([lat, lon], 16);
      }
    } else {
      // Cập nhật tọa độ và góc xoay cho Marker đã có
      droneMarkers[t.deviceId].setLatLng([lat, lon]);
      droneMarkers[t.deviceId].setIcon(createDroneIcon(heading, t.armed));

      // Thêm điểm vào đường bay lịch sử (Giới hạn tối đa 150 điểm gần nhất để tối ưu RAM)
      const trail = droneFlightTrails[t.deviceId];
      if (trail) {
        const points = trail.getLatLngs();
        points.push([lat, lon]);
        if (points.length > 150) points.shift();
        trail.setLatLngs(points);
      }
    }
  }

  // Cập nhật thông số lên HUD nếu là Drone đang được chọn hoặc đang ở chế độ 'all'
  if (!activeDroneId || activeDroneId === t.deviceId || activeDroneId === 'all') {
    if (!activeDroneId || activeDroneId === 'all') activeDroneId = t.deviceId;
    updateHudDisplay(t);
  }
}
