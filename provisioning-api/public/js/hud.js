/**
 * ==============================================================================
 * MODULE 3: COCKPIT HUD & LAYOUT ENGINE (hud.js)
 * ==============================================================================
 * Mục đích:
 *  - Xử lý chuyển đổi giữa các Tab chính (Tác chiến, Đội Drone, Web SSH, IP Matrix).
 *  - Điều khiển bộ chuyển đổi bố cục 3 chế độ (Map Dominant, Split, Cockpit FPV).
 *  - Cập nhật số liệu bay thời gian thực lên lớp phủ FPV OSD và Quả cầu chân trời 3D.
 * ==============================================================================
 */

/**
 * Chuyển đổi qua lại giữa các Tab điều hướng trên giao diện.
 * 
 * @param {string} tabId ID của Tab cần kích hoạt ('tab-tactical', 'tab-fleet', 'tab-terminal', 'tab-ip-pool')
 */
function switchTab(tabId) {
  // Ẩn tất cả các nội dung tab và gỡ bỏ class active trên nút bấm
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));

  // Kích hoạt tab được chọn
  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add('active');

  const activeBtn = Array.from(document.querySelectorAll('.nav-tab')).find(b => b.getAttribute('onclick')?.includes(tabId));
  if (activeBtn) activeBtn.classList.add('active');

  // Khắc phục lỗi render kích thước của Leaflet Map khi mở lại tab Tác chiến
  if (tabId === 'tab-tactical' && map) {
    setTimeout(() => map.invalidateSize(), 150);
  }

  // Khắc phục lỗi co giãn kích thước của Xterm Terminal khi mở lại tab Web SSH
  if (tabId === 'tab-terminal' && fitAddon) {
    setTimeout(() => fitAddon.fit(), 150);
  }
}

/**
 * Điều khiển bộ máy bố cục 3 chế độ trong giao diện Tác chiến & FPV:
 *  - 'mode-map': Bản đồ chiếm toàn bộ khung nhìn, Video thu nhỏ góc dưới dạng Picture-in-Picture (PiP).
 *  - 'mode-split': Chia đôi màn hình 50/50, quan sát đồng thời cả Bản đồ và FPV Camera.
 *  - 'mode-cockpit': Buồng lái FPV toàn màn hình, Bản đồ thu nhỏ góc trái hỗ trợ phi công BVLOS.
 * 
 * @param {string} mode Chế độ bố cục ('mode-map' | 'mode-split' | 'mode-cockpit')
 */
function setLayoutMode(mode) {
  currentLayoutMode = mode;
  DOM.viewportGrid.className = `tactical-viewport-grid ${mode}`;

  document.querySelectorAll('.layout-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`btn-${mode}`);
  if (activeBtn) activeBtn.classList.add('active');

  // Làm tươi lại kích thước bản đồ Leaflet sau khi hiệu ứng chuyển bố cục hoàn tất
  if (map) {
    setTimeout(() => map.invalidateSize(), 250);
  }
}

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
