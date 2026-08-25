/**
 * ==============================================================================
 * MODULE 8: APPLICATION INITIALIZER & DOM RENDERER (app.js)
 * ==============================================================================
 * Mục đích:
 *  - Render bảng quản trị đội Drone (Fleet Table) và Ma trận IP Subnet (IP Matrix).
 *  - Xử lý mở hộp thoại ghi danh Drone thủ công (Manual Provisioning Modal).
 *  - Điểm khởi động chính của ứng dụng Dashboard khi tải xong trang web.
 * ==============================================================================
 */

/**
 * Render danh sách toàn bộ các Drone trong hệ thống vào bảng HTML.
 * 
 * @param {Array<any>} devices Danh sách thiết bị
 */
function renderFleetTable(devices) {
  if (!DOM.fleetTable) return;

  if (!devices || devices.length === 0) {
    DOM.fleetTable.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-dim); padding: 2rem;">
          Chưa có Drone nào trong hệ thống.
        </td>
      </tr>
    `;
    return;
  }

  DOM.fleetTable.innerHTML = devices.map(d => {
    const t = d.telemetry || {};
    const isOnline = isDroneOnline(t);

    // Huy hiệu trạng thái cấp quyền (Status Badge)
    const statusBadge = d.status === 'ACTIVE' 
      ? '<span class="badge badge-active">ACTIVE</span>'
      : (d.status === 'REVOKED' ? '<span class="badge badge-revoked">REVOKED</span>' : '<span class="badge badge-pending">PENDING</span>');

    // Huy hiệu trạng thái bay trực tuyến
    const modeText = (t.flightMode && t.flightMode !== 'UNKNOWN') ? t.flightMode : (isOnline ? 'ONLINE' : 'OFFLINE');
    const liveBadge = isOnline
      ? `<span style="color: #34d399; font-weight: 700;"><i class="fa-solid fa-circle-dot"></i> ${modeText}</span>`
      : '<span style="color: #64748b;"><i class="fa-regular fa-circle"></i> OFFLINE</span>';

    // Lưu lượng dữ liệu mạng WireGuard (Rx/Tx)
    const rxMb = (d.transferRx ? (d.transferRx / (1024 * 1024)).toFixed(1) : '0.0') + ' MB';
    const txMb = (d.transferTx ? (d.transferTx / (1024 * 1024)).toFixed(1) : '0.0') + ' MB';

    return `
      <tr>
        <td>
          <strong style="color: var(--accent);">${d.deviceId}</strong><br>
          <span style="font-size:0.72rem; color:var(--text-dim);">${d.hardwareModel || 'Raspberry Pi 4'}</span>
        </td>
        <td>
          <code style="background:#1e293b; padding:2px 6px; border-radius:4px; color:#38bdf8;">${d.vpnIp || 'Chưa cấp'}</code>
        </td>
        <td>${statusBadge}</td>
        <td>${liveBadge}</td>
        <td>${(t.gps?.groundSpeedMs || 0).toFixed(1)} m/s • ${(t.gps?.altRelativeM || 0).toFixed(1)} m</td>
        <td>
          <span style="font-weight:700; color:${(t.battery?.percentage || 0) < 25 ? '#ef4444' : '#34d399'};">
            ${t.battery?.percentage ?? '--'}%
          </span>
        </td>
        <td style="font-family:'JetBrains Mono'; font-size:0.75rem;">⬇️ ${rxMb} / ⬆️ ${txMb}</td>
        <td>
          <div style="display: flex; gap: 0.35rem;">
            <button class="btn btn-primary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="watchLiveVideoForDrone('${d.deviceId}')" title="Xem FPV Video">
              <i class="fa-solid fa-video"></i> FPV
            </button>
            <button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="openSshForDrone('${d.deviceId}')" title="Mở SSH Terminal">
              <i class="fa-solid fa-terminal"></i> SSH
            </button>
            ${d.status === 'ACTIVE' 
              ? `<button class="btn btn-danger" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="apiAction('/api/v1/dashboard/devices/${d.id}/revoke', 'POST', null, 'Bạn có chắc chắn muốn KHÓA Drone này?')" title="Khóa thiết bị"><i class="fa-solid fa-ban"></i></button>`
              : `<button class="btn btn-success" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="apiAction('/api/v1/dashboard/devices/${d.id}/reactivate', 'POST', null, 'MỞ KHÓA lại Drone này?')" title="Mở khóa thiết bị"><i class="fa-solid fa-rotate-left"></i></button>`
            }
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Render ma trận dải IP 254 ô đại diện cho Subnet VPN 10.13.37.0/24.
 * 
 * @param {Array<any>} cells Danh sách thông tin từng IP host
 */
function renderIpMatrix(cells) {
  if (!DOM.ipMatrix) return;

  DOM.ipMatrix.innerHTML = cells.map(c => {
    let cls = 'available';
    let tooltip = `IP: ${c.ip} (Chưa Sử Dụng)`;

    if (c.status === 'gateway') {
      cls = 'gateway';
      tooltip = `IP: ${c.ip} (WireGuard Gateway 10.13.37.1)`;
    } else if (c.status === 'active' || c.deviceId) {
      // Đối chiếu với bộ nhớ telemetry thời gian thực của fleetDevices
      const dev = fleetDevices.find(d => d.deviceId === c.deviceId || d.vpnIp === c.ip);
      const isOnline = dev && dev.telemetry ? isDroneOnline(dev.telemetry) : !!c.isOnline;

      cls = isOnline ? 'active-online' : 'active-offline';
      tooltip = `IP: ${c.ip} (${c.deviceId || dev?.deviceId || 'Active'}) - ${isOnline ? '🟢 Đang Bay (Live GPS)' : '⚪ Đã Cấp (Offline)'}`;
    }

    return `<div class="ip-cell ${cls}" id="ip-cell-${c.hostNumber}" data-ip="${c.ip}" data-device="${c.deviceId || ''}" title="${tooltip}">.${c.hostNumber}</div>`;
  }).join('');
}

/**
 * Cập nhật tức thời trạng thái màu sắc ô IP trên ma trận khi có gói tin Telemetry thời gian thực
 */
function updateIpMatrixRealtime(deviceId, vpnIp, isOnline) {
  if (!DOM.ipMatrix || !vpnIp) return;
  const host = parseInt(vpnIp.split('.').pop(), 10);
  if (!host) return;

  const cell = document.getElementById(`ip-cell-${host}`) || DOM.ipMatrix.children[host - 1];
  if (cell && !cell.classList.contains('gateway') && !cell.classList.contains('available')) {
    if (isOnline) {
      cell.classList.remove('active-offline');
      cell.classList.add('active-online');
      cell.title = `IP: ${vpnIp} (${deviceId || 'Active'}) - 🟢 Đang Bay (Live GPS)`;
    } else {
      cell.classList.remove('active-online');
      cell.classList.add('active-offline');
      cell.title = `IP: ${vpnIp} (${deviceId || 'Active'}) - ⚪ Đã Cấp (Offline)`;
    }
  }
}

/**
 * Đổ danh sách Drone vào các menu Dropdown:
 *  - Dropdown Bản đồ Tác chiến: Chỉ lọc và hiển thị các Drone đang BAY (Online).
 *  - Dropdown Web SSH: Hiển thị đầy đủ kèm biểu tượng trạng thái 🟢/⚪.
 * 
 * @param {Array<any>} devices Danh sách thiết bị
 */
function populateDroneDropdowns(devices) {
  if (!devices) return;
  const currentMapVal = DOM.mapSelect ? DOM.mapSelect.value : 'all';

  // Lọc chỉ lấy những Drone đang Online thời gian thực
  const onlineDevices = devices.filter(d => isDroneOnline(d.telemetry));

  let mapOptions = '';
  if (onlineDevices.length === 0) {
    mapOptions = '<option value="">-- Không có Drone nào đang bay --</option>';
  } else {
    mapOptions = `<option value="all">-- Theo dõi tất cả (${onlineDevices.length} Drone Đang Bay) --</option>` + 
      onlineDevices.map(d => {
        return `<option value="${d.deviceId}">🟢 ${d.deviceId} (${d.vpnIp || '10.13.37.X'})</option>`;
      }).join('');
  }

  if (DOM.mapSelect) {
    DOM.mapSelect.innerHTML = mapOptions;
    if (currentMapVal && (currentMapVal === 'all' || onlineDevices.some(d => d.deviceId === currentMapVal))) {
      DOM.mapSelect.value = currentMapVal;
    } else if (onlineDevices.length > 0) {
      DOM.mapSelect.value = onlineDevices[0].deviceId;
    }
  }

  if (DOM.sshSelect) {
    DOM.sshSelect.innerHTML = '<option value="">-- Chọn Drone để SSH --</option>' + 
      devices.map(d => {
        const isOnline = isDroneOnline(d.telemetry);
        return `<option value="${d.deviceId}">${isOnline ? '🟢' : '⚪'} ${d.deviceId} (${d.vpnIp || '10.13.37.X'})</option>`;
      }).join('');
  }
}

/**
 * Chọn Drone để hiển thị thông số chi tiết lên Cockpit HUD.
 * Đồng thời tự động chuyển đổi luồng Camera FPV nếu đang mở xem.
 * 
 * @param {string} deviceId Mã Drone
 */
function selectDroneForHud(deviceId) {
  if (!deviceId) return;
  const prevDroneId = activeDroneId;
  activeDroneId = deviceId;
  if (DOM.mapSelect && DOM.mapSelect.value !== deviceId) {
    DOM.mapSelect.value = deviceId;
  }

  const drone = fleetDevices.find(d => d.deviceId === deviceId);
  if (drone && drone.telemetry) {
    updateHudDisplay(drone.telemetry);
  }

  // Nếu đang mở xem camera, tự động ngắt kết nối drone cũ và bật xem drone mới
  const isVideoOpen = typeof isFpvVideoActive === 'function' ? isFpvVideoActive() : !!activeFpvDroneId;
  if (isVideoOpen && deviceId !== 'all') {
    if (activeFpvDroneId !== deviceId) {
      console.log(`[FPV] Chuyển đổi camera: Ngắt luồng ${activeFpvDroneId || prevDroneId} -> Tự động bật xem ${deviceId}...`);
      startFpvVideoStream(deviceId);
    }
  }
}

/**
 * Mở hoặc đóng Modal ghi danh Drone thủ công.
 */
function toggleManualRegisterModal() {
  const modal = document.getElementById('modal-manual-register');
  if (modal) {
    modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
  }
}

/**
 * Gửi thông tin ghi danh Drone mới lên Server qua API.
 */
async function submitManualRegister() {
  const devId = document.getElementById('manual-dev-id')?.value.trim();
  const vpnIp = document.getElementById('manual-vpn-ip')?.value.trim();
  const hw = document.getElementById('manual-hardware')?.value.trim() || 'Manual Drone';

  if (!devId || !vpnIp) {
    return alert('⚠️ Vui lòng nhập đầy đủ Mã Drone và IP VPN (10.13.37.X)!');
  }

  const res = await apiAction(
    '/api/v1/dashboard/devices/manual',
    'POST',
    { deviceId: devId, vpnIp, hardwareModel: hw },
    null,
    `✅ ĐÃ GHI DANH THÀNH CÔNG: ${devId} (${vpnIp})`
  );

  if (res) {
    toggleManualRegisterModal();
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
