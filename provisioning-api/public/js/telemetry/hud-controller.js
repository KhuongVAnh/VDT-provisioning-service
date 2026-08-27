/**
 * ==============================================================================
 * MODULE TELEMETRY 2: COCKPIT HUD CONTROLLER (hud-controller.js)
 * ==============================================================================
 * Mục đích:
 *  - Cập nhật các chỉ số bay thời gian thực lên lớp phủ FPV OSD và Sidebar.
 *  - Điều khiển chuyển động xoay của Quả cầu Chân trời nhân tạo 3D (Roll/Pitch).
 *  - Xử lý lựa chọn Drone mục tiêu và phân quyền mở luồng Video.
 * ==============================================================================
 */

/**
 * Cập nhật toàn bộ thông số bay thời gian thực từ Telemetry lên:
 *  1. Sidebar giám sát: Chân trời nhân tạo 3D, GPS, Tốc độ, Độ cao, Chế độ bay.
 *  2. Lớp phủ FPV OSD: Băng đo tốc độ (trái), độ cao (phải), la bàn (đỉnh), thước góc nghiêng (tâm).
 * 
 * @param {any} t Gói tin Telemetry thời gian thực của Drone
 */
function updateHudDisplay(t) {
  if (!t) return resetHudDisplay();

  const isOnline = t.connected !== false;
  const devId = t.deviceId || 'CHƯA CHỌN';

  // --- A. CẬP NHẬT TELEMETRY SIDEBAR ---
  if (DOM.hud.deviceId) DOM.hud.deviceId.innerText = devId;

  if (DOM.hud.flightMode) {
    DOM.hud.flightMode.innerText = (t.flightMode && t.flightMode !== 'UNKNOWN') ? t.flightMode : (isOnline ? 'ONLINE' : 'OFFLINE');
    DOM.hud.flightMode.style.color = isOnline ? '#f59e0b' : '#64748b';
  }

  if (DOM.hud.armed) {
    DOM.hud.armed.innerText = t.armed ? 'ARMED' : 'DISARMED';
    DOM.hud.armed.style.color = t.armed ? '#10b981' : '#94a3b8';
  }

  const batPct = Math.min(100, Math.max(0, Math.round(t.battery?.percentage ?? 0)));
  if (DOM.hud.battery) DOM.hud.battery.innerText = `${batPct}%`;

  const alt = t.gps?.altRelativeM || t.gps?.altMslM || 0;
  const spd = t.gps?.groundSpeedMs || 0;
  const hdg = Math.round(t.gps?.headingDeg || 0);

  if (DOM.hud.altitude) DOM.hud.altitude.innerText = `${alt.toFixed(1)} m`;
  if (DOM.hud.speed) DOM.hud.speed.innerText = `${spd.toFixed(1)} m/s`;
  if (DOM.hud.heading) DOM.hud.heading.innerText = `${hdg.toString().padStart(3, '0')}°`;

  const roll = t.attitude?.rollDeg || 0;
  const pitch = t.attitude?.pitchDeg || 0;

  if (DOM.hud.angles) DOM.hud.angles.innerText = `${roll.toFixed(1)}° / ${pitch.toFixed(1)}°`;

  // Xoay và dịch chuyển Quả cầu Chân trời nhân tạo 3D theo góc Roll & Pitch
  if (DOM.hud.horizon) {
    DOM.hud.horizon.style.transform = `rotate(${-roll}deg) translateY(${pitch * 1.5}px)`;
  }

  // Tọa độ GPS & Số lượng vệ tinh
  if (DOM.hud.lat) DOM.hud.lat.innerText = (t.gps?.lat || 0).toFixed(6);
  if (DOM.hud.lon) DOM.hud.lon.innerText = (t.gps?.lon || 0).toFixed(6);
  if (DOM.hud.sats) DOM.hud.sats.innerText = `${t.gps?.satellites || 14} SAT`;


  // --- B. CẬP NHẬT LỚP PHỦ FPV COCKPIT OSD ---
  if (DOM.osd.droneName) DOM.osd.droneName.innerText = devId;
  if (DOM.osd.spd) DOM.osd.spd.innerText = spd.toFixed(1);
  if (DOM.osd.alt) DOM.osd.alt.innerText = alt.toFixed(1);
  if (DOM.osd.hdg) DOM.osd.hdg.innerText = `${hdg}° (${getCompassDirection(hdg)})`;

  // Thước đo góc nghiêng ở tâm màn hình FPV
  if (DOM.osd.pitchLadder) {
    DOM.osd.pitchLadder.style.transform = `rotate(${-roll}deg) translateY(${pitch * 2}px)`;
  }

  if (DOM.osd.modeText) {
    DOM.osd.modeText.innerText = `${t.armed ? 'ARMED' : 'DISARMED'} • ${t.flightMode || 'GUIDED'}`;
    DOM.osd.modePill.style.color = t.armed ? '#10b981' : '#f59e0b';
  }

  if (DOM.osd.batText) {
    const volt = (t.battery?.voltageMv ? (t.battery.voltageMv / 1000).toFixed(1) : '15.8');
    DOM.osd.batText.innerText = `${batPct}% (${volt}V)`;
  }
}

/**
 * Khôi phục toàn bộ các chỉ số trên HUD về trạng thái rỗng / mặc định ban đầu.
 */
function resetHudDisplay() {
  if (DOM.hud.deviceId) DOM.hud.deviceId.innerText = 'CHƯA CHỌN';
  if (DOM.hud.flightMode) { DOM.hud.flightMode.innerText = '--'; DOM.hud.flightMode.style.color = '#64748b'; }
  if (DOM.hud.armed) { DOM.hud.armed.innerText = 'DISARMED'; DOM.hud.armed.style.color = '#94a3b8'; }
  if (DOM.hud.battery) DOM.hud.battery.innerText = '--%';
  if (DOM.hud.altitude) DOM.hud.altitude.innerText = '0.0 m';
  if (DOM.hud.speed) DOM.hud.speed.innerText = '0.0 m/s';
  if (DOM.hud.heading) DOM.hud.heading.innerText = '000°';
  if (DOM.hud.angles) DOM.hud.angles.innerText = '0.0° / 0.0°';
  if (DOM.hud.horizon) DOM.hud.horizon.style.transform = 'rotate(0deg) translateY(0px)';
}

/**
 * Cập nhật trạng thái bật/tắt (Disable) của nút xem Live Video FPV theo quyền sở hữu Drone
 */
function updateVideoControlPermission(deviceId) {
  const btnVideo = document.getElementById('btn-toggle-video');
  const btnLabel = document.getElementById('btn-video-label');
  if (!btnVideo) return;

  if (!deviceId || deviceId === 'all') {
    btnVideo.disabled = false;
    btnVideo.style.opacity = '1';
    btnVideo.style.cursor = 'pointer';
    btnVideo.title = 'Bật/Tắt Live FPV';
    if (btnLabel && !isFpvVideoActive()) btnLabel.innerText = 'Bật Live FPV';
    return;
  }

  const currentUser = typeof getAuthUser === 'function' ? getAuthUser() : null;
  const drone = fleetDevices.find(d => d.deviceId === deviceId);
  const isMine = currentUser?.role === 'ADMIN' || (drone && drone.isOwner !== false && (drone.userId === currentUser?.id || drone.isOwner === true));

  if (!isMine) {
    // Nếu là Drone của người khác -> Tự động đóng Video và Khóa nút
    if (typeof isFpvVideoActive === 'function' && isFpvVideoActive()) {
      closeFpvVideoStream(true);
    }
    btnVideo.disabled = true;
    btnVideo.style.opacity = '0.4';
    btnVideo.style.cursor = 'not-allowed';
    btnVideo.title = '⚠️ Bạn không có quyền truy cập Live Camera của Drone này';
    if (btnLabel) btnLabel.innerText = 'Khóa Live FPV';
  } else {
    // Drone của mình -> Mở khóa nút bình thường
    btnVideo.disabled = false;
    btnVideo.style.opacity = '1';
    btnVideo.style.cursor = 'pointer';
    btnVideo.title = 'Bật/Tắt Live FPV';
    if (btnLabel && !isFpvVideoActive()) btnLabel.innerText = 'Bật Live FPV';
  }
}

/**
 * Chọn Drone để hiển thị thông số chi tiết lên Cockpit HUD.
 * Đồng thời kích hoạt Focus Mode qua WebSocket và chuyển luồng FPV nếu đang mở xem.
 * 
 * @param {string} deviceId Mã Drone
 */
function selectDroneForHud(deviceId) {
  if (!deviceId) return;
  const prevDroneId = activeDroneId;
  activeDroneId = deviceId;
  if (DOM.mapSelect && DOM.mapSelect.value !== deviceId) {
    const hasOption = Array.from(DOM.mapSelect.options).some(opt => opt.value === deviceId);
    if (hasOption) {
      DOM.mapSelect.value = deviceId;
    }
  }

  // Cập nhật quyền xem Video FPV
  updateVideoControlPermission(deviceId);

  // Kích hoạt Focus Mode 10Hz qua WebSocket Rooms
  if (typeof socket !== 'undefined' && socket && socket.connected) {
    if (prevDroneId && prevDroneId !== 'all' && prevDroneId !== deviceId) {
      socket.emit('unsubscribe:drone', { deviceId: prevDroneId });
    }
    if (deviceId !== 'all') {
      socket.emit('subscribe:drone', { deviceId: deviceId });
    } else {
      socket.emit('subscribe:all');
    }
  }

  const drone = fleetDevices.find(d => d.deviceId === deviceId);
  if (drone && drone.telemetry) {
    updateHudDisplay(drone.telemetry);
  }

  // Chuyển đổi camera FPV nếu đang mở xem
  const currentUser = typeof getAuthUser === 'function' ? getAuthUser() : null;
  const isMine = currentUser?.role === 'ADMIN' || (drone && drone.isOwner !== false);
  const isVideoOpen = typeof isFpvVideoActive === 'function' ? isFpvVideoActive() : !!activeFpvDroneId;

  if (isVideoOpen && deviceId !== 'all' && isMine) {
    if (activeFpvDroneId !== deviceId) {
      console.log(`[FPV] Chuyển đổi camera: Ngắt luồng ${activeFpvDroneId || prevDroneId} -> Tự động bật xem ${deviceId}...`);
      startFpvVideoStream(deviceId);
    }
  }
}
