/**
 * ==============================================================================
 * APPLICATION ENTRYPOINT & COORDINATOR (app.js)
 * ==============================================================================
 * Mục đích:
 *  - Điều phối chuyển đổi Tab chính (Tác chiến, Đội Drone, Web SSH, IP Matrix).
 *  - Điều khiển bộ chuyển đổi bố cục 3 chế độ (Map / Split / Cockpit FPV).
 *  - Khởi tạo toàn bộ các thành phần khi Người dùng xác thực thành công.
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

  // Khắc phục lỗi render kích thước của Leaflet Map và làm tươi menu chọn Drone khi mở lại tab Tác chiến
  if (tabId === 'tab-tactical') {
    if (typeof populateDroneDropdowns === 'function') {
      populateDroneDropdowns(fleetDevices);
    }
    if (map) {
      setTimeout(() => map.invalidateSize(), 150);
    }
  }

  // Tải lại danh sách thiết bị khi mở tab Đội Drone
  if (tabId === 'tab-fleet' && typeof fetchFleetData === 'function') {
    fetchFleetData();
  }

  // Tải lại ma trận IP khi mở tab IP Matrix
  if (tabId === 'tab-ip-pool' && typeof fetchIpPoolMatrix === 'function') {
    fetchIpPoolMatrix();
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

// --------------------------------------------------------------------------
// KHỞI ĐỘNG CÁC MODULE DASHBOARD KHI ĐÃ ĐĂNG NHẬP THÀNH CÔNG (AUTHENTICATED)
// --------------------------------------------------------------------------
let dashboardRefreshInterval = null;
let isDashboardInitialized = false;

window.initDashboardApp = function() {
  console.log('🚀 [Mission Control] Người dùng đã xác thực. Khởi động Cockpit Dashboard...');

  // 1. Khởi tạo bản đồ tác chiến Leaflet (nếu chưa khởi tạo)
  if (!isDashboardInitialized) {
    initTacticalMap();
    isDashboardInitialized = true;
  } else if (map) {
    setTimeout(() => {
      map.invalidateSize();
    }, 200);
  }

  // 2. Thiết lập kết nối thời gian thực WebSocket Socket.IO (kèm JWT Token)
  initWebSocket();

  // 3. Tải dữ liệu ban đầu
  refreshAllData();

  // 4. Định kỳ đồng bộ lại dữ liệu nền mỗi 30 giây (WebSocket xử lý telemetry 10Hz thời gian thực)
  if (dashboardRefreshInterval) {
    clearInterval(dashboardRefreshInterval);
  }
  dashboardRefreshInterval = setInterval(refreshAllData, 30000);
};
