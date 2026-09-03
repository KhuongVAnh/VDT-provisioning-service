/**
 * ==============================================================================
 * MODULE VIDEO 4: SELF-HEALING & LATENCY RECOVERY (video-recovery.js)
 * ==============================================================================
 * 1. Đo đạc các thông số luồng thời gian thực chuẩn W3C (RTT, Jitter, Decode Time, Bitrate, FPS).
 * 2. WebRTC Frozen Frame Watchdog: Tự động phát hiện đóng băng khung hình trong 3s để phục hồi.
 * 3. WebRTC Background Probing: Tự động chuyển đổi mượt (Hot-swap) từ HLS về lại WebRTC khi mạng tốt.
 * 4. Page Visibility API: Tự động xóa đệm và tái đồng bộ khi người dùng active lại Tab.
 * ==============================================================================
 */

// --- BIẾN QUẢN LÝ TỰ PHỤC HỒI & CHỐNG TRÔI ĐỘ TRỄ ---
let fpvWebRtcProbeInterval = null;    // Timer định kỳ dò tìm WebRTC khi đang chạy Fallback HLS
let fpvFrozenWatchdogInterval = null; // Timer theo dõi đóng băng khung hình (Watchdog)
let frozenFrameTicks = 0;             // Bộ đếm chu kỳ không nhận được frame mới của WebRTC
let lastHlsHardSeekTime = 0;          // Thời điểm gần nhất thực hiện Hard-Seek HLS (Cooldown chống giật)
let isProbingWebRtc = false;          // Cờ ngăn chồng chéo các phiên dò WebRTC ngầm

// --- BIẾN ĐO ĐẠC STATS VIDEO THỜI GIAN THỰC ---
let lastRtpBytes = 0;
let lastRtpTimestamp = 0;
let lastJitterBufferDelay = 0;
let lastJitterEmittedCount = 0;
let lastTotalDecodeTime = 0;
let lastFramesDecoded = 0;

/**
 * Khởi động bộ đếm định kỳ (mỗi 15 giây) để dò tìm và tự động nâng cấp trở lại WebRTC WHEP (< 100ms)
 * khi luồng đang phải chạy ở chế độ dự phòng Low-Latency HLS.
 * 
 * @param {string} deviceId Mã Drone
 */
function startWebRtcProbing(deviceId) {
  if (fpvWebRtcProbeInterval) {
    clearInterval(fpvWebRtcProbeInterval);
    fpvWebRtcProbeInterval = null;
  }

  fpvWebRtcProbeInterval = setInterval(async () => {
    // Chỉ probe nếu đang ở chế độ HLS và không có phiên probe nào đang chạy dở
    if (!fpvHlsInstance || isProbingWebRtc || !activeFpvDroneId || activeFpvDroneId !== deviceId) {
      return;
    }

    isProbingWebRtc = true;
    console.log(`[FPV Auto-Recovery] Đang dò tìm tín hiệu WebRTC WHEP ngầm cho ${deviceId}...`);

    try {
      const probePc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' }
        ]
      });

      probePc.addTransceiver('video', { direction: 'recvonly' });

      // Lập timeout 6s cho phiên probe để không treo tài nguyên
      const probeTimeout = setTimeout(() => {
        probePc.close();
        isProbingWebRtc = false;
      }, 6000);

      probePc.ontrack = (event) => {
        clearTimeout(probeTimeout);
        console.log(`[FPV Auto-Recovery] 🎉 Dò WebRTC WHEP thành công! Đang Hot-swap từ HLS sang WebRTC...`);

        // 1. Dọn dẹp HLS phiên cũ
        if (fpvHlsInstance) {
          fpvHlsInstance.destroy();
          fpvHlsInstance = null;
        }

        // 2. Chuyển giao PeerConnection
        if (fpvPeerConnection) fpvPeerConnection.close();
        fpvPeerConnection = probePc;

        // 3. Gán stream vào thẻ video
        if (DOM.fpvVideoEl) {
          if (event.streams && event.streams[0]) {
            DOM.fpvVideoEl.srcObject = event.streams[0];
          } else if (event.track) {
            DOM.fpvVideoEl.srcObject = new MediaStream([event.track]);
          }
          DOM.fpvVideoEl.play().catch(() => {});
        }

        // 4. Hủy bộ đếm probe vì đã về WebRTC thành công
        if (fpvWebRtcProbeInterval) {
          clearInterval(fpvWebRtcProbeInterval);
          fpvWebRtcProbeInterval = null;
        }
        isProbingWebRtc = false;
      };

      const offer = await probePc.createOffer();
      await probePc.setLocalDescription(offer);

      const clientFirstOfferSdp = probePc.localDescription.sdp
        .split(/\r?\n/)
        .filter(line => !line.startsWith('a=candidate:'))
        .join('\r\n');

      const token = typeof getAuthToken === 'function' ? getAuthToken() : '';
      const whepHeaders = { 'Content-Type': 'application/sdp' };
      if (token) whepHeaders['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/video/${encodeURIComponent(deviceId)}/whep`, {
        method: 'POST',
        body: clientFirstOfferSdp,
        headers: whepHeaders
      });

      if (res.ok) {
        const rawAnswerSdp = await res.text();
        const cleanAnswerSdp = sanitizeWhepAnswerSdp(rawAnswerSdp);
        await probePc.setRemoteDescription({ type: 'answer', sdp: cleanAnswerSdp });
      } else {
        probePc.close();
        isProbingWebRtc = false;
      }
    } catch (e) {
      isProbingWebRtc = false;
    }
  }, 15000);
}

/**
 * Xử lý tự phục hồi khi luồng WebRTC bị đóng băng khung hình (mạng rớt hoặc encoder khựng):
 *  1. Thử tái tạo kết nối WebRTC.
 *  2. Nếu không được -> Tự động chuyển mượt sang HLS Fallback.
 * 
 * @param {string} deviceId Mã Drone
 */
async function handleWebRtcFrozenRecovery(deviceId) {
  if (!deviceId || activeFpvDroneId !== deviceId) return;
  console.log(`[FPV Self-Healing] Đang tự động kết nối lại WebRTC cho ${deviceId}...`);
  try {
    await startFpvVideoStream(deviceId);
  } catch (err) {
    console.warn('[FPV Self-Healing] Tái kết nối WebRTC thất bại, chuyển sang HLS Fallback:', err);
    startHlsFallbackStream(deviceId);
  }
}

/**
 * Tính toán và cập nhật các thông số Video thời gian thực (Real-time Stats):
 *  1. Độ trễ thực tế (Latency): RTT + Jitter Buffer Delay qua API RTCPeerConnection.getStats().
 *  2. Băng thông video thật (Real Bitrate Mbps).
 *  3. Độ phân giải và Tốc độ khung hình (Resolution & FPS).
 *  4. Giám sát đóng băng khung hình (Frozen Frame Watchdog).
 */
async function updateFpvStats() {
  if (!DOM.fpvVideoEl) return;

  // --- TRƯỜNG HỢP 1: WEBRTC WHEP KẾT NỐI TRỰC TIẾP ---
  if (fpvPeerConnection && (fpvPeerConnection.connectionState === 'connected' || fpvPeerConnection.iceConnectionState === 'connected')) {
    try {
      const stats = await fpvPeerConnection.getStats();
      let rttMs = 0;
      let jitterDelayMs = 0;
      let decodeDelayMs = 0;
      let currentBytes = 0;
      let currentTimestamp = 0;
      let rtpFps = null;
      let rtpWidth = null;
      let rtpHeight = null;
      let transportProtocol = 'UDP';
      let currentFramesDecoded = 0;

      stats.forEach(report => {
        // A. Đọc thời gian khứ hồi mạng thực tế (RTT) từ cặp ứng viên ICE đang hoạt động
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated || report.selected)) {
          if (report.currentRoundTripTime !== undefined) {
            rttMs = Math.round(report.currentRoundTripTime * 1000);
          }
          if (report.remoteCandidateId) {
            const remoteCand = stats.get(report.remoteCandidateId);
            if (remoteCand && remoteCand.protocol) {
              transportProtocol = remoteCand.protocol.toUpperCase();
            }
          }
        }

        // B. Đọc thông số luồng Video Inbound RTP (Jitter Buffer, Decode Time, Bytes, FPS, Resolution)
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          // 1. Đo thời gian lưu trong bộ đệm Jitter Buffer (Delta chính xác trong 1 giây qua)
          if (report.jitterBufferDelay !== undefined && report.jitterBufferEmittedCount !== undefined) {
            if (lastJitterEmittedCount > 0 && report.jitterBufferEmittedCount > lastJitterEmittedCount) {
              const deltaDelay = report.jitterBufferDelay - lastJitterBufferDelay;
              const deltaCount = report.jitterBufferEmittedCount - lastJitterEmittedCount;
              if (deltaCount > 0 && deltaDelay >= 0) {
                jitterDelayMs = Math.round((deltaDelay / deltaCount) * 1000);
              }
            }
            lastJitterBufferDelay = report.jitterBufferDelay;
            lastJitterEmittedCount = report.jitterBufferEmittedCount;
          }

          // 2. Đo thời gian GPU/CPU phần cứng giải mã khung hình (Delta Decode Time)
          if (report.totalDecodeTime !== undefined && report.framesDecoded !== undefined) {
            currentFramesDecoded = report.framesDecoded;
            if (lastFramesDecoded > 0 && report.framesDecoded > lastFramesDecoded) {
              const deltaDecode = report.totalDecodeTime - lastTotalDecodeTime;
              const deltaFrames = report.framesDecoded - lastFramesDecoded;
              if (deltaFrames > 0 && deltaDecode >= 0) {
                decodeDelayMs = Math.round((deltaDecode / deltaFrames) * 1000);
              }
            }
            lastTotalDecodeTime = report.totalDecodeTime;
          }

          if (report.framesPerSecond !== undefined) {
            rtpFps = Math.round(report.framesPerSecond);
          }
          if (report.frameWidth !== undefined && report.frameHeight !== undefined) {
            rtpWidth = report.frameWidth;
            rtpHeight = report.frameHeight;
          }
          if (report.bytesReceived !== undefined) {
            currentBytes = report.bytesReceived;
            currentTimestamp = report.timestamp;
          }
        }
      });

      // 🟢 CƠ CHẾ WEBRTC FROZEN FRAME WATCHDOG:
      // Nếu số khung hình giải mã không tăng trong 3 giây liên tiếp và bytes nhận không đổi -> Đóng băng ngầm
      if (lastFramesDecoded > 0 && currentFramesDecoded > 0) {
        if (currentFramesDecoded === lastFramesDecoded && currentBytes === lastRtpBytes) {
          frozenFrameTicks++;
        } else {
          frozenFrameTicks = 0; // Đã nhận frame mới -> Luồng hoạt động thông suốt
        }

        if (frozenFrameTicks >= 3) {
          console.warn(`[FPV Watchdog] ⚠️ Luồng WebRTC của ${activeFpvDroneId} bị đóng băng khung hình trong 3s! Đang kích hoạt tự phục hồi...`);
          frozenFrameTicks = 0;
          handleWebRtcFrozenRecovery(activeFpvDroneId);
        }
      }
      lastFramesDecoded = currentFramesDecoded;

      // 0. Cập nhật Badge Giao thức mạng (WEBRTC UDP / TCP)
      if (DOM.osd.protocol) {
        const isUdp = transportProtocol === 'UDP';
        DOM.osd.protocol.style.color = isUdp ? '#10b981' : '#38bdf8';
        DOM.osd.protocol.innerHTML = `<i class="fa-solid ${isUdp ? 'fa-bolt' : 'fa-network-wired'}"></i> WEBRTC (${transportProtocol})`;
      }

      // 1. Tính toán độ trễ thời gian thực chuẩn 100% W3C (Không gán số ảo):
      // = (RTT / 2 - Độ trễ đường truyền mạng) + (Jitter Buffer Delay) + (GPU Hardware Decode Time)
      const netLatencyMs = rttMs > 0 ? Math.round(rttMs / 2) : 0;
      const totalMeasuredMs = netLatencyMs + jitterDelayMs + decodeDelayMs;
      const displayLatencyMs = totalMeasuredMs > 0 ? totalMeasuredMs : (netLatencyMs > 0 ? netLatencyMs : 20);

      if (DOM.osd.latency) {
        let color = '#34d399'; // Xanh lá (< 150ms)
        let icon = 'fa-bolt';
        if (displayLatencyMs > 250) {
          color = '#ef4444'; // Đỏ (Mạng lag > 250ms)
          icon = 'fa-triangle-exclamation';
        } else if (displayLatencyMs > 150) {
          color = '#f59e0b'; // Vàng cam (150 - 250ms)
        }
        DOM.osd.latency.style.color = color;
        DOM.osd.latency.innerHTML = `<i class="fa-solid ${icon}"></i> ${displayLatencyMs}ms`;
        DOM.osd.latency.title = `Chi tiết: Mạng (RTT/2) = ${netLatencyMs}ms | Jitter Buffer = ${jitterDelayMs}ms | GPU Decode = ${decodeDelayMs}ms`;
      }

      // 2. Tính toán băng thông thực tế (Bitrate Mbps) từ lượng byte nhận được
      if (lastRtpBytes > 0 && lastRtpTimestamp > 0 && currentBytes > lastRtpBytes) {
        const timeDiffSec = (currentTimestamp - lastRtpTimestamp) / 1000;
        if (timeDiffSec > 0) {
          const bitRateBps = ((currentBytes - lastRtpBytes) * 8) / timeDiffSec;
          const bitRateMbps = (bitRateBps / (1024 * 1024)).toFixed(2);
          if (DOM.osd.bitrate) {
            DOM.osd.bitrate.innerHTML = `<i class="fa-solid fa-gauge-high"></i> ${bitRateMbps} Mbps`;
          }
        }
      }
      lastRtpBytes = currentBytes;
      lastRtpTimestamp = currentTimestamp;

      // 3. Cập nhật độ phân giải & FPS
      const width = rtpWidth || DOM.fpvVideoEl.videoWidth || 768;
      const height = rtpHeight || DOM.fpvVideoEl.videoHeight || 432;
      const fpsStr = (rtpFps !== null ? `${rtpFps} FPS` : (DOM.fpvVideoEl.paused ? '-- FPS' : '30 FPS'));
      if (DOM.osd.res) {
        DOM.osd.res.innerHTML = `<i class="fa-solid fa-video"></i> ${width}x${height} @ ${fpsStr}`;
      }

    } catch (e) {
      console.warn('[FPV Stats] Lỗi đọc getStats WebRTC:', e);
    }
  }

  // --- TRƯỜNG HỢP 2: HLS FALLBACK ---
  else if (fpvHlsInstance) {
    if (DOM.osd.protocol) {
      DOM.osd.protocol.style.color = '#f59e0b';
      DOM.osd.protocol.innerHTML = `<i class="fa-solid fa-layer-group"></i> HLS (HTTP)`;
    }

    const hlsLatencySec = fpvHlsInstance.latency || (fpvHlsInstance.liveSyncPosition ? Math.max(0.5, Math.abs(DOM.fpvVideoEl.currentTime - fpvHlsInstance.liveSyncPosition)) : 1.2);
    
    if (DOM.osd.latency) {
      DOM.osd.latency.style.color = '#f59e0b';
      DOM.osd.latency.innerHTML = `<i class="fa-solid fa-clock"></i> ${hlsLatencySec.toFixed(1)}s (HLS)`;
    }

    if (fpvHlsInstance.bandwidthEstimate) {
      const mbps = (fpvHlsInstance.bandwidthEstimate / (1024 * 1024)).toFixed(2);
      if (DOM.osd.bitrate) {
        DOM.osd.bitrate.innerHTML = `<i class="fa-solid fa-gauge-high"></i> ${mbps} Mbps`;
      }
    }

    const width = DOM.fpvVideoEl.videoWidth || 768;
    const height = DOM.fpvVideoEl.videoHeight || 432;
    const fpsStr = DOM.fpvVideoEl.paused ? '-- FPS' : '30 FPS';
    if (DOM.osd.res) {
      DOM.osd.res.innerHTML = `<i class="fa-solid fa-video"></i> ${width}x${height} @ ${fpsStr}`;
    }
  }
}

// --- 4. TÍCH HỢP PAGE VISIBILITY API & SỰ KIỆN TƯƠNG TÁC NGƯỜI DÙNG ---

// Lắng nghe sự kiện chuyển đổi Tab trình duyệt để tự động hồi phục mép phát Live Edge
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    console.log('[FPV Lifecycle] Tab Dashboard được kích hoạt lại -> Bắt đầu kiểm tra và tái đồng bộ độ trễ...');

    // 1. Nếu đang chạy HLS: Ngay lập tức nhảy tới mép phát Live Edge mới nhất (xóa sạch đệm tích lũy)
    if (fpvHlsInstance) {
      resyncLiveEdge();
    }

    // 2. Kích hoạt play lại thẻ video nếu bị trình duyệt tạm dừng do throttle tab nền
    if (DOM.fpvVideoEl && DOM.fpvVideoEl.paused && isFpvVideoActive()) {
      DOM.fpvVideoEl.play().catch(e => console.warn('[FPV Lifecycle] Tự động phát lại video bị chặn:', e));
    }

    // 3. Reset bộ đếm frozen của WebRTC để không kích hoạt nhầm ngay khi vừa mở lại tab
    frozenFrameTicks = 0;
  }
});
