/**
 * ==============================================================================
 * MODULE 2: REST API CLIENT & TIỆN ÍCH (api.js)
 * ==============================================================================
 * Mục đích:
 *  - Xử lý các yêu cầu gọi REST API tới NestJS Gateway (Port 10004).
 *  - Đồng bộ dữ liệu định kỳ (KPIs, Đội Drone, Ma trận IP) mà KHÔNG làm gián đoạn
 *    luồng Telemetry thời gian thực hoặc xóa đường bay (Flight Trails) của Drone.
 * ==============================================================================
 */

/**
 * Kiểm tra xem một Drone có đang Online thời gian thực hay không.
 * Điều kiện: Gói tin Telemetry nhận được cách đây không quá 15 giây hoặc có luồng Socket live.
 */
function isDroneOnline(t) {
  if (!t) return false;
  if (t.connected === false && !t.lastReceivedAt) return false;
  if (t.lastReceivedAt && (Date.now() - t.lastReceivedAt < 15000)) return true;
  if (t.timestamp && (Date.now() - t.timestamp < 15000)) return true;
  if (t.flightMode && t.flightMode !== 'UNKNOWN' && t.connected !== false) return true;
  return !!t.connected;
}

/**
 * Chuyển đổi góc Heading (0° - 360°) thành tên hướng tiếng Việt 8 phương vị.
 */
function getCompassDirection(deg) {
  const directions = ['BẮC', 'ĐÔNG BẮC', 'ĐÔNG', 'ĐÔNG NAM', 'NAM', 'TÂY NAM', 'TÂY', 'TÂY BẮC'];
  const index = Math.round(((deg %= 360) < 0 ? deg + 360 : deg) / 45) % 8;
  return directions[index];
}

/**
 * Sao chép tọa độ GPS hiện tại trên HUD vào Clipboard của người dùng.
 */
function copyGpsCoordinates() {
  const lat = DOM.hud.lat?.innerText || '0';
  const lon = DOM.hud.lon?.innerText || '0';
  navigator.clipboard.writeText(`${lat}, ${lon}`)
    .then(() => alert(`✅ Đã sao chép tọa độ GPS: ${lat}, ${lon}`))
    .catch(() => alert(`Tọa độ: ${lat}, ${lon}`));
}

/**
 * Hàm gọi API chung (Wrapper) hỗ trợ hiển thị hộp thoại xác nhận, xử lý lỗi và làm mới dữ liệu.
 */
async function apiAction(url, method, body, confirmMsg, successMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;

  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) options.body = JSON.stringify(body);

    const res = await authFetch(url, options);
    const json = await res.json();

    if (json.status === 'success') {
      if (successMsg) alert(successMsg);
      refreshAllData();
      return json;
    } else {
      alert('⚠️ Lỗi: ' + (json.message || 'Thao tác thất bại'));
    }
  } catch (err) {
    alert('❌ Lỗi kết nối máy chủ: ' + err.message);
  }
}

/**
 * Tải và cập nhật danh sách đội Drone từ Gateway (Hợp nhất telemetry realtime)
 */
async function fetchFleetData() {
  if (!getAuthToken()) return;
  try {
    const res = await authFetch('/api/v1/telemetry/fleet/states');
    const json = await res.json();
    if (json?.status === 'success') {
      const incomingList = json.data || [];
      // Giữ nguyên các thông tin telemetry realtime (lastReceivedAt, gps, heading) đã nhận qua Socket
      incomingList.forEach(incoming => {
        const existing = fleetDevices.find(d => d.deviceId === incoming.deviceId);
        if (existing && existing.telemetry) {
          incoming.telemetry = {
            ...incoming.telemetry,
            ...existing.telemetry,
            lastReceivedAt: existing.telemetry.lastReceivedAt || incoming.telemetry?.lastReceivedAt
          };
        }
      });
      fleetDevices = incomingList;
      renderFleetTable(fleetDevices);
      populateDroneDropdowns(fleetDevices);
    }
  } catch (err) {
    console.warn('[API] Lỗi khi tải danh sách Drone:', err);
  }
}

/**
 * Tải và cập nhật các chỉ số tổng quan (KPIs)
 */
async function fetchDashboardStats() {
  if (!getAuthToken()) return;
  try {
    const res = await authFetch('/api/v1/dashboard/stats');
    const json = await res.json();
    if (json?.status === 'success') {
      const d = json.data;
      const totalDrones = fleetDevices.length || d.devices?.total || 0;
      const onlineCount = fleetDevices.filter(dev => isDroneOnline(dev.telemetry)).length;

      if (DOM.kpiTotal) DOM.kpiTotal.innerText = totalDrones;
      if (DOM.kpiActivePending) {
        DOM.kpiActivePending.innerText = `${d.devices?.active || totalDrones} Active • ${d.devices?.pending || 0} Pending`;
      }
      if (DOM.kpiOnline) DOM.kpiOnline.innerText = onlineCount;
      if (DOM.kpiIpUsage) DOM.kpiIpUsage.innerText = `${d.ipPool?.utilizationPercentage || 0}%`;
      if (DOM.kpiIpCounts) {
        DOM.kpiIpCounts.innerText = `${d.ipPool?.usedCount || 0} / ${d.ipPool?.totalCapacity || 253} IP Đã Cấp`;
      }
    }
  } catch (err) {
    console.warn('[API] Lỗi khi tải thống kê Dashboard:', err);
  }
}

/**
 * Tải và cập nhật Ma trận IP (Chỉ dành cho Admin)
 */
async function fetchIpPoolMatrix() {
  const user = getAuthUser();
  if (!user || user.role !== 'ADMIN') return;

  try {
    const res = await authFetch('/api/v1/dashboard/ip-pool');
    const json = await res.json();
    if (json?.status === 'success') {
      renderIpMatrix(json.data || []);
    }
  } catch (err) {
    console.warn('[API] Lỗi khi tải IP Matrix:', err);
  }
}

/**
 * Làm mới toàn bộ dữ liệu hệ thống (Chạy khi khởi tạo hoặc khi người dùng bấm nút Refresh)
 * KHÔNG can thiệp hoặc xóa đè các Marker/Đường bay đang được vẽ mượt qua WebSocket
 */
async function refreshAllData() {
  if (!getAuthToken()) return;
  await Promise.all([
    fetchFleetData(),
    fetchDashboardStats(),
    fetchIpPoolMatrix()
  ]);
}
