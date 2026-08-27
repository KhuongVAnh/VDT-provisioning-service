/**
 * ==============================================================================
 * MODULE TELEMETRY 4: WEBSOCKET SOCKET.IO CLIENT (socket-client.js)
 * ==============================================================================
 * Mục đích:
 *  - Thiết lập kết nối thời gian thực 2 chiều Socket.IO tới Gateway (Port 10004).
 *  - Tự động đăng ký nhận luồng Telemetry nhị phân / JSON từ Ingestion Engine.
 *  - Xử lý các sự kiện mạng kết nối, ngắt kết nối và chuyển tiếp dòng lệnh Web SSH.
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
