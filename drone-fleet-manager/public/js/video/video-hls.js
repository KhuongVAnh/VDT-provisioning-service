/**
 * ==============================================================================
 * MODULE VIDEO 3: LOW-LATENCY HLS FALLBACK PLAYER (video-hls.js)
 * ==============================================================================
 * Trình phát video dự phòng chuẩn Low-Latency HLS (HTTP Live Streaming)
 * kết hợp thuật toán tăng tốc đuổi kịp mép phát (Catch-up Playback Rate: 1.5x)
 * và nhảy cóc cưỡng bức có Cooldown (Hard-Seek Live Edge).
 * ==============================================================================
 */

/**
 * Trình phát dự phòng Low-Latency HLS qua Port 10004.
 * 
 * @param {string} deviceId Mã Drone
 */
async function startHlsFallbackStream(deviceId) {
  try {
    const token = typeof getAuthToken === 'function' ? getAuthToken() : '';
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/v1/video/${encodeURIComponent(deviceId)}/stream-info`, { headers });
    const json = await res.json();
    if (json.status !== 'success' || !json.data) {
      throw new Error('Không lấy được thông tin luồng stream từ server');
    }

    const { hlsUrl } = json.data;
    console.log(`[FPV HLS] Bắt đầu kết nối Video HLS Gateway: ${hlsUrl}`);

    if (socket) socket.emit('video:subscribe', { deviceId });

    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 1,           // Giải phóng bộ đệm đã xem sau 1s
        maxBufferLength: 2,            // Giữ đệm phía trước tối đa 2s
        maxMaxBufferLength: 4,         // Trần tối đa không quá 4s
        liveSyncDuration: 0.5,         // Bám sát mép phát ở cự ly 0.5s
        liveMaxLatencyDuration: 1.5,   // Ngưỡng trễ tối đa cho phép là 1.5s
        maxLiveSyncPlaybackRate: 1.5,  // Tăng tốc tối đa 1.5x để đuổi kịp Live Edge
        liveDurationInfinity: true,
        highBufferWatchdogPeriod: 1,   // Quét dọn bộ đệm mỗi 1 giây
        xhrSetup: function (xhr) {
          if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        },
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(DOM.fpvVideoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('[FPV HLS] Manifest parsed thành công!');
        DOM.fpvVideoEl.play().catch(e => console.warn('Tự động phát video bị chặn:', e));
        if (DOM.fpvLoadingState) DOM.fpvLoadingState.style.display = 'none';

        if (!fpvStatsInterval) {
          fpvStatsInterval = setInterval(updateFpvStats, 1000);
          updateFpvStats();
        }

        // Kích hoạt cơ chế dò WebRTC ngầm để tự động nâng cấp lại khi mạng ổn định
        startWebRtcProbing(deviceId);
      });

      // 🟢 CƠ CHẾ HARD-SEEK CÓ COOLDOWN (Chống giật cục liên tục):
      hls.on(Hls.Events.LEVEL_UPDATED, () => {
        const now = Date.now();
        // Nếu độ trễ vượt quá 1.8s và lần hard-seek gần nhất cách đây > 3 giây
        if (hls.liveSyncPosition && Math.abs(DOM.fpvVideoEl.currentTime - hls.liveSyncPosition) > 1.8) {
          if (now - lastHlsHardSeekTime > 3000) {
            lastHlsHardSeekTime = now;
            DOM.fpvVideoEl.currentTime = hls.liveSyncPosition;
            console.log('[FPV HLS] Đã kích hoạt Hard-Seek Live Edge để triệt tiêu độ trễ tích lũy (> 1.8s)');
          }
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('[FPV HLS] Lỗi HLS fatal:', data.type, data.details);
          if (DOM.fpvLoadingState) {
            DOM.fpvLoadingState.style.display = 'flex';
            if (DOM.fpvLoadingText) {
              DOM.fpvLoadingText.innerHTML = `<span style="color:#f87171">⚠️ Mất tín hiệu luồng FPV</span><br><span style="font-size:0.75rem; color:#94a3b8">Đảm bảo Drone đang phát RTSP vào 10.13.37.1:8554.</span>`;
            }
          }
        }
      });

      fpvHlsInstance = hls;
    } else if (DOM.fpvVideoEl.canPlayType('application/vnd.apple.mpegurl')) {
      DOM.fpvVideoEl.src = hlsUrl;
      DOM.fpvVideoEl.addEventListener('loadedmetadata', () => {
        DOM.fpvVideoEl.play().catch(e => console.warn(e));
        if (DOM.fpvLoadingState) DOM.fpvLoadingState.style.display = 'none';
      });
    }

  } catch (err) {
    console.error('[FPV] Lỗi kết nối Video Gateway:', err);
    if (DOM.fpvLoadingState) {
      DOM.fpvLoadingState.style.display = 'flex';
      if (DOM.fpvLoadingText) {
        DOM.fpvLoadingText.innerHTML = `<span style="color:#f87171">⚠️ ${err.message}</span><br><span style="font-size:0.75rem; color:#94a3b8">Đảm bảo Drone đang phát RTSP vào 10.13.37.1:8554.</span>`;
      }
    }
  }
}

/**
 * Tái đồng bộ mép phát Live Edge của Video (áp dụng cho HLS).
 */
function resyncLiveEdge() {
  if (fpvHlsInstance && fpvHlsInstance.liveSyncPosition && DOM.fpvVideoEl) {
    DOM.fpvVideoEl.currentTime = fpvHlsInstance.liveSyncPosition;
    console.log('[FPV HLS] Đã tái đồng bộ mép phát Live Edge thành công!');
  }
}
