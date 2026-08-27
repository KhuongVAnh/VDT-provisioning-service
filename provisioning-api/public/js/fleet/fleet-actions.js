/**
 * ==============================================================================
 * MODULE FLEET 2: FLEET ACTIONS & PROVISIONING (fleet-actions.js)
 * ==============================================================================
 * Mục đích:
 *  - Xử lý mở/đóng Modal ghi danh Drone thủ công (Manual Provisioning).
 *  - Gửi dữ liệu đăng ký thiết bị mới lên Server qua API REST.
 * ==============================================================================
 */

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
