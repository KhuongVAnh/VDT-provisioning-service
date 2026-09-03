/**
 * ==============================================================================
 * MODULE FLEET 3: WEB SSH TERMINAL CLIENT (web-ssh.js)
 * ==============================================================================
 * Mục đích:
 *  - Khởi tạo và quản lý giao diện dòng lệnh Web SSH trực tiếp trên trình duyệt
 *    sử dụng thư viện Xterm.js và kết nối 2 chiều Socket.IO.
 *  - Cho phép quản trị viên / kỹ sư SSH an toàn vào Drone qua mạng nội bộ
 *    WireGuard VPN (10.13.37.X) mà không cần cấu hình mở cổng công khai.
 * ==============================================================================
 */

/**
 * Khởi tạo phiên Terminal Xterm.js và gán vào vùng chứa DOM.
 */
function initTerminal() {
  if (term) return;

  // Cấu hình giao diện Terminal Cyberpunk Dark
  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace",
    theme: {
      background: '#060911',
      foreground: '#f8fafc',
      cursor: '#00f0ff',
      selection: 'rgba(0, 240, 255, 0.3)'
    }
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-wrapper'));
  fitAddon.fit();

  // Bắt sự kiện người dùng gõ phím trên Terminal và gửi lên Gateway qua WebSocket
  term.onData(data => {
    if (socket) socket.emit('ssh:input', { data });
  });

  // Tự động căn chỉnh kích thước Terminal khi thay đổi kích thước cửa sổ trình duyệt
  window.addEventListener('resize', () => fitAddon?.fit());
}

/**
 * Mở nhanh giao diện SSH cho một Drone cụ thể từ bảng hoặc HUD.
 * 
 * @param {string} deviceId Mã Drone
 */
function openSshForDrone(deviceId) {
  if (DOM.sshSelect) DOM.sshSelect.value = deviceId;
  if (DOM.sshIp) {
    const d = fleetDevices.find(dev => dev.deviceId === deviceId);
    DOM.sshIp.value = d?.vpnIp || '';
  }
  switchTab('tab-terminal');
  connectWebSsh();
}

/**
 * Mở Web SSH cho Drone hiện đang được chọn trên giao diện Tác chiến.
 */
function openWebSshForSelectedDrone() {
  const targetId = activeDroneId && activeDroneId !== 'all' ? activeDroneId : (fleetDevices[0]?.deviceId || '');
  openSshForDrone(targetId);
}

/**
 * Xử lý khi người dùng chọn một Drone từ danh sách Dropdown trong Tab Terminal.
 * 
 * @param {string} val Mã Device ID
 */
function onSshSelectChange(val) {
  const d = fleetDevices.find(dev => dev.deviceId === val);
  if (DOM.sshIp && d) {
    DOM.sshIp.value = d.vpnIp || '';
  }
}

/**
 * Gửi lệnh yêu cầu kết nối SSH tới Companion SBC của Drone qua mạng VPN WireGuard.
 */
function connectWebSsh() {
  const target = DOM.sshIp?.value.trim() || DOM.sshSelect?.value;
  const user = DOM.sshUser?.value.trim() || 'root';
  const pass = DOM.sshPass?.value || '';

  if (!target) return alert('⚠️ Vui lòng chọn Drone hoặc nhập IP VPN!');

  initTerminal();
  term.clear();
  term.writeln(`\x1b[36m>>> Đang mở phiên SSH tới ${target} (User: ${user}) qua WireGuard VPN...\x1b[0m\r\n`);

  if (DOM.sshStatus) {
    DOM.sshStatus.innerText = `Trạng thái: Đang kết nối tới ${target}...`;
  }

  const token = typeof getAuthToken === 'function' ? getAuthToken() : '';
  if (socket) {
    socket.emit('ssh:connect', {
      deviceId: target,
      username: user,
      password: pass,
      token,
      cols: term.cols,
      rows: term.rows
    });
  }
}

/**
 * Ngắt phiên kết nối SSH hiện tại và thông báo trên màn hình Terminal.
 */
function disconnectWebSsh() {
  if (socket) socket.emit('ssh:disconnect');
  if (term) term.writeln('\r\n\x1b[31m>>> [SESSION CLOSED] Đã ngắt kết nối SSH.\x1b[0m\r\n');
  if (DOM.sshStatus) DOM.sshStatus.innerText = 'Trạng thái: Đã ngắt kết nối';
}
