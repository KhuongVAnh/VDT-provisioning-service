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
  const token = typeof getAuthToken === 'function' ? getAuthToken() : '';
  socket = io({
    auth: { token },
    query: { token },
  });

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

  // Khi nhận được gói tin cập nhật Telemetry từ Drone
  socket.on('telemetry:update', (data) => {
    queueTelemetryForRender(data);
  });

  // Nhận dữ liệu stream phản hồi từ phiên Web SSH
  socket.on('ssh:data', (payload) => {
    if (term) {
      const text = typeof payload === 'string' ? payload : (payload?.data || '');
      if (text) {
        term.write(text);
      }
    }
  });

  // Nhận thông báo trạng thái kết nối Web SSH (Connecting / Connected / Closed)
  socket.on('ssh:status', (payload) => {
    if (DOM.sshStatus) {
      DOM.sshStatus.innerText = `Trạng thái: ${payload.message || payload.status}`;
    }
  });
}

function disconnectWebSocket() {
  if (socket) {
    try {
      socket.disconnect();
    } catch (e) {}
    socket = null;
  }
}

// Hàng đợi lưu trữ Telemetry mới nhất chờ vẽ theo chu kỳ làm tươi màn hình (60 FPS)
const telemetryRenderQueue = new Map();
let isRenderFrameScheduled = false;

/**
 * Đưa gói tin Telemetry vào hàng đợi và kích hoạt requestAnimationFrame()
 * Giúp tránh re-render DOM liên tục khi có hàng chục gói tin ùa về cùng lúc
 */
function queueTelemetryForRender(t) {
  if (!t || !t.deviceId) return;
  telemetryRenderQueue.set(t.deviceId, t);

  if (!isRenderFrameScheduled) {
    isRenderFrameScheduled = true;
    requestAnimationFrame(() => {
      isRenderFrameScheduled = false;
      for (const [_, payload] of telemetryRenderQueue.entries()) {
        processTelemetryUpdate(payload);
      }
      telemetryRenderQueue.clear();
    });
  }
}

// Giữ alias tương thích
const handleIncomingTelemetry = queueTelemetryForRender;

/**
 * Xử lý dữ liệu Telemetry thời gian thực nhận được từ Drone:
 *  1. Nếu Drone Online: Cập nhật vị trí Marker trên bản đồ Leaflet và xoay góc Heading.
 *  2. Vẽ đường bay lịch sử (Flight Trail Polyline).
 *  3. Cập nhật số lượng Online trên KPI và bảng Đội Drone.
 *  4. Cập nhật các chỉ số bay lên Cockpit HUD nếu Drone này đang được chọn.
 * 
 * @param {any} t Gói tin Telemetry
 */
let lastFleetTableUpdate = 0;

function processTelemetryUpdate(t) {
  if (!t || !t.deviceId) return;

  // Đánh dấu thời điểm nhận gói tin thực tế tại trình duyệt
  t.lastReceivedAt = Date.now();
  if (t.connected === undefined) t.connected = true;

  // Cập nhật trạng thái telemetry trong bộ nhớ fleetDevices
  const currentUser = typeof getAuthUser === 'function' ? getAuthUser() : null;
  let existingDevice = fleetDevices.find(d => d.deviceId === t.deviceId);
  if (existingDevice) {
    existingDevice.telemetry = t;
  } else if (currentUser && currentUser.role === 'ADMIN') {
    // Chỉ Quản trị viên ADMIN mới tự động bổ sung Drone lạ phát hiện từ telemetry vào danh sách hiển thị
    existingDevice = {
      id: t.deviceId,
      deviceId: t.deviceId,
      hardwareModel: 'Real-time Telemetry Stream',
      vpnIp: t.vpnIp || '10.13.37.X',
      status: 'ACTIVE',
      telemetry: t,
    };
    fleetDevices.push(existingDevice);
    populateDroneDropdowns(fleetDevices);
  } else {
    // Nếu là PILOT và drone này không thuộc quyền sở hữu (không có trong fleetDevices đã claim), bỏ qua không vẽ
    return;
  }

  // 1. Kiểm tra trạng thái Online
  const online = isDroneOnline(t);

  // Cập nhật ngay lập tức ô IP trên ma trận IP Pool
  if (typeof updateIpMatrixRealtime === 'function') {
    const ip = t.vpnIp || existingDevice?.vpnIp;
    updateIpMatrixRealtime(t.deviceId, ip, online);
  }

  // Cập nhật thẻ chỉ số KPI Đang bay
  if (DOM.kpiOnline) {
    const onlineCount = fleetDevices.filter(d => isDroneOnline(d.telemetry)).length;
    DOM.kpiOnline.innerText = onlineCount;
  }

  // Nếu Drone Offline -> Gỡ bỏ khỏi bản đồ tác chiến và cập nhật menu chọn
  if (!online) {
    removeDroneFromMap(t.deviceId);
    populateDroneDropdowns(fleetDevices);
    return;
  }

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

      // Thêm điểm vào đường bay lịch sử (Lưu trữ tới 1000 điểm gần nhất cho toàn bộ chuyến bay)
      const trail = droneFlightTrails[t.deviceId];
      if (trail) {
        const points = trail.getLatLngs();
        points.push([lat, lon]);
        if (points.length > 1000) points.shift();
        trail.setLatLngs(points);
      }
    }
  }

  // Cập nhật thông số lên HUD nếu là Drone đang được chọn hoặc đang ở chế độ 'all'
  if (!activeDroneId || activeDroneId === t.deviceId || activeDroneId === 'all') {
    if (!activeDroneId || activeDroneId === 'all') activeDroneId = t.deviceId;
    updateHudDisplay(t);
  }

  // Cập nhật định kỳ nhẹ bảng Đội Drone (nếu tab Đội Drone đang mở, mỗi 1s tối đa 1 lần)
  const now = Date.now();
  const fleetTab = document.getElementById('tab-fleet');
  if (fleetTab && fleetTab.classList.contains('active') && (now - lastFleetTableUpdate > 1000)) {
    lastFleetTableUpdate = now;
    renderFleetTable(fleetDevices);
  }
}
