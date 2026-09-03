/**
 * ==============================================================================
 * MODULE VIDEO 1: CONTROLS & UI ACTIONS (video-controls.js)
 * ==============================================================================
 * Quản lý trạng thái mở/đóng luồng FPV, chụp ảnh màn hình (Snapshot),
 * chế độ toàn màn hình (Fullscreen) và dọn dẹp tài nguyên khi ngắt kết nối.
 * ==============================================================================
 */

/**
 * Kiểm tra xem luồng Live Video FPV có đang hoạt động (hoặc đang kết nối) hay không.
 * 
 * @returns {boolean} True nếu đang mở video
 */
function isFpvVideoActive() {
  return !!(
    activeFpvDroneId ||
    fpvPeerConnection ||
    fpvHlsInstance ||
    (DOM.fpvVideoEl && DOM.fpvVideoEl.srcObject)
  );
}

/**
 * Bật hoặc tắt luồng Video FPV từ nút bấm trên thanh công cụ HUD.
 */
function toggleFpvVideoFromHud() {
  const selectedDropdownDrone = DOM.mapSelect?.value;

  // Nếu đang mở video thì bấm vào sẽ đóng lại
  if (isFpvVideoActive()) {
    closeFpvVideoStream();
    return;
  }

  // Nếu đang chọn "Theo dõi tất cả" ('all') hoặc chưa chọn Drone -> Không cho bật xem video
  if (!selectedDropdownDrone || selectedDropdownDrone === 'all') {
    alert('⚠️ Vui lòng chọn 1 Drone cụ thể trong danh sách "Mục tiêu" để xem Camera Live!');
    return;
  }

  const currentUser = typeof getAuthUser === 'function' ? getAuthUser() : null;
  const drone = fleetDevices.find(d => d.deviceId === selectedDropdownDrone);
  const isMine = currentUser?.role === 'ADMIN' || (drone && drone.isOwner !== false && (drone.userId === currentUser?.id || drone.isOwner === true));

  if (!isMine) {
    alert('⚠️ Bạn không có quyền truy cập luồng Live Camera của Drone này!');
    return;
  }

  startFpvVideoStream(selectedDropdownDrone);
}

/**
 * Đóng luồng Video và dọn dẹp các tài nguyên mạng / bộ nhớ.
 * 
 * @param {boolean} updateUiState Có cập nhật lại nhãn nút bấm hay không
 */
function closeFpvVideoStream(updateUiState = true) {
  if (updateUiState && DOM.btnVideoLabel) {
    DOM.btnVideoLabel.innerText = 'Bật Live FPV';
  }

  // Dọn dẹp bộ đếm FPS/Stats và các Timer tự phục hồi
  if (fpvStatsInterval) {
    clearInterval(fpvStatsInterval);
    fpvStatsInterval = null;
  }
  if (fpvWebRtcProbeInterval) {
    clearInterval(fpvWebRtcProbeInterval);
    fpvWebRtcProbeInterval = null;
  }
  if (fpvFrozenWatchdogInterval) {
    clearInterval(fpvFrozenWatchdogInterval);
    fpvFrozenWatchdogInterval = null;
  }
  frozenFrameTicks = 0;
  isProbingWebRtc = false;
  lastHlsHardSeekTime = 0;

  // Reset biến đo đạc
  lastRtpBytes = 0;
  lastRtpTimestamp = 0;
  lastJitterBufferDelay = 0;
  lastJitterEmittedCount = 0;
  lastTotalDecodeTime = 0;
  lastFramesDecoded = 0;

  // Đưa các chỉ số OSD về mặc định
  if (DOM.osd.protocol) {
    DOM.osd.protocol.style.color = '#64748b';
    DOM.osd.protocol.innerHTML = '<i class="fa-solid fa-video-slash"></i> --';
  }
  if (DOM.osd.latency) {
    DOM.osd.latency.style.color = '#64748b';
    DOM.osd.latency.innerHTML = '<i class="fa-solid fa-clock"></i> -- ms';
  }
  if (DOM.osd.bitrate) {
    DOM.osd.bitrate.innerHTML = '<i class="fa-solid fa-gauge-high"></i> -- Mbps';
  }
  if (DOM.osd.res) {
    DOM.osd.res.innerHTML = '<i class="fa-solid fa-video"></i> --x-- @ -- FPS';
  }

  // Hủy đăng ký trên Socket.IO
  if (socket && activeFpvDroneId) {
    socket.emit('video:unsubscribe', { deviceId: activeFpvDroneId });
  }

  // Đóng kết nối WebRTC Peer Connection
  if (fpvPeerConnection) {
    fpvPeerConnection.close();
    fpvPeerConnection = null;
  }

  // Hủy phiên Hls.js
  if (fpvHlsInstance) {
    fpvHlsInstance.destroy();
    fpvHlsInstance = null;
  }

  // Dọn dẹp thẻ Video HTML
  if (DOM.fpvVideoEl) {
    DOM.fpvVideoEl.pause();
    DOM.fpvVideoEl.srcObject = null;
    DOM.fpvVideoEl.removeAttribute('src');
    DOM.fpvVideoEl.load();
  }

  activeFpvDroneId = null;
}

/**
 * Chụp ảnh màn hình từ luồng FPV Video thời gian thực và tải xuống máy người dùng (.png).
 */
function captureFpvSnapshot() {
  if (!DOM.fpvVideoEl || DOM.fpvVideoEl.videoWidth === 0) {
    return alert('⚠️ Video chưa tải xong để chụp ảnh!');
  }

  const canvas = document.createElement('canvas');
  canvas.width = DOM.fpvVideoEl.videoWidth;
  canvas.height = DOM.fpvVideoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(DOM.fpvVideoEl, 0, 0, canvas.width, canvas.height);

  const link = document.createElement('a');
  link.download = `FPV_SNAPSHOT_${activeFpvDroneId || 'DRONE'}_${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/**
 * Bật / tắt chế độ toàn màn hình cho khung Video FPV.
 */
function toggleFpvFullscreen() {
  const box = document.getElementById('fpv-frame-box');
  if (!box) return;

  if (!document.fullscreenElement) {
    box.requestFullscreen?.() || box.webkitRequestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

/**
 * Xem nhanh FPV Live Video cho một Drone từ bảng danh sách đội Drone.
 * 
 * @param {string} deviceId Mã Drone
 */
function watchLiveVideoForDrone(deviceId) {
  switchTab('tab-tactical');
  selectDroneForHud(deviceId);
  startFpvVideoStream(deviceId);
}

// Cho phép bấm trực tiếp vào khung hình Video để kích hoạt Play nếu trình duyệt tạm dừng
document.addEventListener('DOMContentLoaded', () => {
  const videoWrapper = document.querySelector('.fpv-video-wrapper');
  if (videoWrapper) {
    videoWrapper.addEventListener('click', () => {
      if (DOM.fpvVideoEl && DOM.fpvVideoEl.paused) {
        DOM.fpvVideoEl.play().catch(() => {});
      }
    });
  }
});
