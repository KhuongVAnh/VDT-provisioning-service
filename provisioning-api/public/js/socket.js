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
    // Chỉ Quản trị viên ADMIN mới tự động bổ sung Drone lạ phát hiện từ telemetry vào danh sách quản trị
    existingDevice = {
      id: t.deviceId,
      deviceId: t.deviceId,
      hardwareModel: 'Real-time Telemetry Stream',
      vpnIp: t.vpnIp || '10.13.37.X',
      status: 'ACTIVE',
      isOwner: true,
      telemetry: t,
    };
    fleetDevices.push(existingDevice);
    populateDroneDropdowns(fleetDevices);
  } else {
    // Nếu là PILOT và drone này không thuộc quyền sở hữu, TUYỆT ĐỐI KHÔNG đưa vào fleetDevices
    return;
  }

  // Xác định Drone này có thuộc quyền sở hữu của User hiện tại hay không
  const isMyDrone = currentUser?.role === 'ADMIN' || (existingDevice.isOwner !== false && (existingDevice.userId === currentUser?.id || existingDevice.isOwner === true));

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
    const ownerLabel = isMyDrone ? '<span style="color:#00f0ff;">[Drone Của Bạn]</span>' : '<span style="color:#f59e0b;">[Phi Đội Khác]</span>';

    if (!droneMarkers[t.deviceId]) {
      // Nếu Drone chưa có Marker trên bản đồ -> Tạo mới với màu sắc phân biệt
      const marker = L.marker([lat, lon], {
        icon: createDroneIcon(heading, t.armed, isMyDrone)
      }).addTo(map);

      marker.bindTooltip(`<b>${t.deviceId}</b> ${ownerLabel}<br>IP: ${t.vpnIp || '10.13.37.X'}<br>Mode: ${t.flightMode || 'ONLINE'}`, {
        permanent: false,
        direction: 'top'
      });

      marker.on('click', () => selectDroneForHud(t.deviceId));
      droneMarkers[t.deviceId] = marker;

      // Khởi tạo đường bay: Drone của mình nét Cyan sáng, Drone người khác nét Amber đứt khúc
      droneFlightTrails[t.deviceId] = L.polyline([[lat, lon]], {
        color: isMyDrone ? '#00f0ff' : '#f59e0b',
        weight: isMyDrone ? 2.5 : 1.5,
        opacity: isMyDrone ? 0.75 : 0.45,
        dashArray: isMyDrone ? undefined : '4, 4'
      }).addTo(map);

      populateDroneDropdowns(fleetDevices);

      // Nếu đây là Drone đầu tiên xuất hiện, tự động căn giữa bản đồ vào vị trí Drone
      if (Object.keys(droneMarkers).length === 1) {
        map.setView([lat, lon], 16);
      }
    } else {
      // 🟢 TỐI ƯU HÓA SIÊU NHẸ:
      const marker = droneMarkers[t.deviceId];
      marker.setLatLng([lat, lon]);

      // 1. Xoay góc Heading trực tiếp bằng CSS Transform (không hủy và tạo lại DOM bằng setIcon)
      const iconEl = marker.getElement();
      if (iconEl) {
        const wrapper = iconEl.querySelector('div');
        if (wrapper) {
          wrapper.style.transform = `rotate(${heading || 0}deg)`;
        }
      }

      // 2. Chỉ gọi setIcon khi trạng thái Arm hoặc quyền sở hữu thay đổi
      if (marker._lastArmedState !== t.armed || marker._lastIsMyDrone !== isMyDrone) {
        marker._lastArmedState = t.armed;
        marker._lastIsMyDrone = isMyDrone;
        marker.setIcon(createDroneIcon(heading, t.armed, isMyDrone));
      }

      // 3. Tối ưu đường bay: Dùng trail.addLatLng (O(1)) trực tiếp thay vì gán lại toàn bộ mảng
      const trail = droneFlightTrails[t.deviceId];
      if (trail) {
        trail.addLatLng([lat, lon]);
        const points = trail.getLatLngs();
        if (points.length > 1000) {
          points.shift();
          trail.setLatLngs(points);
        }
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
