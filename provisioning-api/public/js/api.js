/**
 * ==============================================================================
 * MODULE 2: REST API CLIENT & TIỆN ÍCH (api.js)
 * ==============================================================================
 * Mục đích:
 *  - Xử lý các yêu cầu gọi REST API tới NestJS Gateway (Port 10004).
 *  - Đồng bộ và làm mới dữ liệu toàn hệ thống (KPIs, Đội Drone, Ma trận IP).
 *  - Cung cấp các hàm tiện ích tính toán la bàn, kiểm tra online, sao chép tọa độ.
 * ==============================================================================
 */

/**
 * Kiểm tra xem một Drone có đang Online thời gian thực hay không.
 * Điều kiện: Có kết nối và gói tin Telemetry nhận được cách đây không quá 10 giây.
 * 
 * @param {any} t Dữ liệu Telemetry của Drone
 * @returns {boolean} True nếu Drone đang trực tuyến
 */
function isDroneOnline(t) {
  if (!t || t.connected === false) return false;
  if (t.timestamp && (Date.now() - t.timestamp > 10000)) return false;
  return true;
}

/**
 * Chuyển đổi góc Heading (0° - 360°) thành tên hướng tiếng Việt 8 phương vị.
 * 
 * @param {number} deg Góc phương vị la bàn (0 - 360)
 * @returns {string} Tên hướng (BẮC, ĐÔNG BẮC, ĐÔNG, ...)
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
 * 
 * @param {string} url Đường dẫn API
 * @param {string} method Phương thức HTTP (GET, POST, PUT, DELETE, ...)
 * @param {any} body Dữ liệu gửi kèm (Body JSON)
 * @param {string|null} confirmMsg Thông báo hỏi xác nhận người dùng trước khi gọi
 * @param {string|null} successMsg Thông báo khi thực thi thành công
 * @returns {Promise<any>} Dữ liệu JSON trả về từ Server
 */
async function apiAction(url, method, body, confirmMsg, successMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;

  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);
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
 * Tải và làm mới toàn bộ dữ liệu từ Gateway bằng cách gọi song song 3 API:
 *  1. /api/v1/dashboard/stats: Thống kê tổng số thiết bị, mức sử dụng IP VPN.
 *  2. /api/v1/telemetry/fleet/states: Trạng thái bay và telemetry mới nhất của từng Drone.
 *  3. /api/v1/dashboard/ip-pool: Ma trận 254 địa chỉ IP WireGuard.
 */
async function refreshAllData() {
  try {
    const [statsRes, fleetRes, ipRes] = await Promise.all([
      fetch('/api/v1/dashboard/stats').then(r => r.json()).catch(() => null),
      fetch('/api/v1/telemetry/fleet/states').then(r => r.json()).catch(() => null),
      fetch('/api/v1/dashboard/ip-pool').then(r => r.json()).catch(() => null),
    ]);

    // 1. Cập nhật danh sách đội Drone
    if (fleetRes?.status === 'success') {
      fleetDevices = fleetRes.data || [];
      renderFleetTable(fleetDevices);
      populateDroneDropdowns(fleetDevices);

      // Cập nhật vị trí và telemetry lên bản đồ
      fleetDevices.forEach(d => {
        if (d.telemetry) handleIncomingTelemetry(d.telemetry);
      });
    }

    // 2. Cập nhật các thẻ KPI tổng quan
    if (statsRes?.status === 'success') {
      const d = statsRes.data;
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

    // 3. Cập nhật Ma trận IP Subnet
    if (ipRes?.status === 'success') {
      renderIpMatrix(ipRes.data || []);
    }
  } catch (err) {
    console.error('[API] Lỗi khi làm mới dữ liệu hệ thống:', err);
  }
}
