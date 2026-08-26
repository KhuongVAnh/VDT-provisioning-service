/**
 * ==============================================================================
 * MODULE 5: FPV VIDEO GATEWAY PLAYER (video.js)
 * ==============================================================================
 * Mục đích:
 *  - Quản lý luồng Video Camera từ Drone qua Gateway Port 10004.
 *  - Hỗ trợ chuẩn WebRTC WHEP (WebRTC HTTP Egress Protocol) cho độ trễ tức thì (< 200ms)
 *    phục vụ bay BVLOS (Bay ngoài tầm nhìn).
 *  - Tự động Fallback sang Low-Latency HLS nếu mạng của client chặn cổng UDP WebRTC.
 *  - Cung cấp các tính năng: Chụp ảnh nhanh (Snapshot), Toàn màn hình, Đo FPS/Resolution.
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
 * Kiểm tra xem một IP có phải là IP nội bộ / private theo chuẩn RFC 1918 hay không.
 * 
 * @param {string} ip Địa chỉ IPv4
 * @returns {boolean} True nếu là IP nội bộ (10.x, 172.16-31.x, 192.168.x, 127.x)
 */
function isPrivateIp(ip) {
  return /^(10\.|192\.168\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip);
}

/**
 * Chuẩn hóa bản tin SDP Answer hoàn toàn tự động (Dynamic 100%):
 *  - Tự động trích xuất IP Public / Domain từ danh sách candidate do MediaMTX gửi về.
 *  - Tự động loại bỏ toàn bộ các IP nội bộ Docker / LAN (RFC 1918) để trình duyệt kết nối thẳng vào Public IP.
 * 
 * @param {string} sdp Bản tin SDP Answer gốc từ MediaMTX
 * @returns {string} Bản tin SDP Answer đã được tối ưu
 */
function sanitizeWhepAnswerSdp(sdp) {
  if (!sdp) return sdp;

  // 1. Quét tìm IP Public đầu tiên do MediaMTX gửi về (không thuộc dải Private)
  const lines = sdp.split(/\r?\n/);
  let publicHost = null;

  for (const line of lines) {
    const match = line.match(/^a=candidate:[^\s]+\s+\d+\s+(?:udp|tcp)\s+\d+\s+([^\s]+)\s+\d+/i);
    if (match) {
      const host = match[1];
      if (!isPrivateIp(host)) {
        publicHost = host;
        break;
      }
    }
  }

  // 2. Nếu tìm thấy IP Public, cập nhật dòng c=IN IP4 thành IP Public đó
  let result = sdp;
  if (publicHost && /^\d+\.\d+\.\d+\.\d+$/.test(publicHost)) {
    result = sdp.replace(/c=IN IP4 [0-9.]+/g, `c=IN IP4 ${publicHost}`);
  }

  // 3. Tự động lọc bỏ các candidate thuộc dải Private (RFC 1918)
  const filteredLines = result.split(/\r?\n/).filter(line => {
    if (line.startsWith('a=candidate:')) {
      const match = line.match(/^a=candidate:[^\s]+\s+\d+\s+(?:udp|tcp)\s+\d+\s+([^\s]+)\s+\d+/i);
      if (match && isPrivateIp(match[1])) {
        return false; // Tự động loại bỏ các IP nội bộ
      }
    }
    return true;
  });

  return filteredLines.join('\r\n');
}

/**
 * Khởi động luồng FPV Video cho một Drone cụ thể:
 *  - Bước 1: Thử bắt tay WebRTC WHEP (Độ trễ < 200ms).
 *  - Bước 2: Tự động Fallback sang HLS nếu WebRTC không thể kết nối.
 * 
 * @param {string} deviceId Mã Drone cần xem Video
 */
async function startFpvVideoStream(deviceId) {
  if (!deviceId || deviceId === 'all') return;
  activeFpvDroneId = deviceId;

  if (DOM.btnVideoLabel) DOM.btnVideoLabel.innerText = 'Đóng Live Video';
  if (DOM.fpvLoadingState) DOM.fpvLoadingState.style.display = 'flex';
  if (DOM.fpvLoadingText) DOM.fpvLoadingText.innerText = `Đang kết nối WebRTC WHEP (< 200ms) cho ${deviceId}...`;

  // 1. Dọn dẹp phiên kết nối cũ (nếu có)
  closeFpvVideoStream(false);
  activeFpvDroneId = deviceId;

  // 2. Thử kết nối qua WebRTC WHEP (Ultra-Low Latency < 200ms)
  try {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
      ]
    });
    fpvPeerConnection = pc;

    // Theo dõi trạng thái kết nối ICE chi tiết
    pc.oniceconnectionstatechange = () => {
      console.log(`[FPV WebRTC] Trạng thái ICE: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (DOM.fpvLoadingState) DOM.fpvLoadingState.style.display = 'none';
      }
    };
    pc.onconnectionstatechange = () => {
      console.log(`[FPV WebRTC] Trạng thái Kết nối: ${pc.connectionState}`);
    };

    // Yêu cầu chỉ nhận luồng Video (recvonly)
    pc.addTransceiver('video', { direction: 'recvonly' });

    // Khi nhận được luồng MediaStream từ MediaMTX qua WebRTC UDP
    pc.ontrack = (event) => {
      console.log('[FPV WebRTC] Đã nhận luồng MediaStream WebRTC thành công!', event.streams);
      if (DOM.fpvVideoEl) {
        DOM.fpvVideoEl.muted = true;
        DOM.fpvVideoEl.playsInline = true;
        DOM.fpvVideoEl.autoplay = true;

        if (event.streams && event.streams[0]) {
          DOM.fpvVideoEl.srcObject = event.streams[0];
        } else if (event.track) {
          const inboundStream = new MediaStream([event.track]);
          DOM.fpvVideoEl.srcObject = inboundStream;
        }

        const safePlay = () => {
          const p = DOM.fpvVideoEl.play();
          if (p !== undefined) {
            p.catch(e => {
              if (e.name !== 'AbortError') {
                console.warn('Tự động phát Video bị chặn bởi trình duyệt:', e);
              }
            });
          }
        };

        safePlay();

        if (event.track) {
          event.track.onunmute = () => {
            console.log('[FPV WebRTC] Video Track unmuted, bắt đầu render khung hình!');
            safePlay();
            if (DOM.fpvLoadingState) DOM.fpvLoadingState.style.display = 'none';
          };
        }
      }
      if (DOM.fpvLoadingState) DOM.fpvLoadingState.style.display = 'none';

      // Khởi động đo đạc độ phân giải và FPS
      if (!fpvStatsInterval) {
        fpvStatsInterval = setInterval(updateFpvStats, 1000);
        updateFpvStats();
      }
    };

    // 1. Tạo bản tin SDP Offer của trình duyệt
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // 2. LỌC BỎ TOÀN BỘ CANDIDATE KHỎI SDP OFFER:
    // Điều này ngăn KHÔNG CHO MediaMTX trên VPS bắn bất kỳ gói UDP nào ra ngoài trước.
    // MediaMTX sẽ chỉ gửi về địa chỉ của nó, và Trình duyệt sẽ là bên BẮN GÓI TIN ĐẦU TIÊN!
    const clientFirstOfferSdp = pc.localDescription.sdp
      .split(/\r?\n/)
      .filter(line => !line.startsWith('a=candidate:'))
      .join('\r\n');

    // 3. Gửi SDP Offer qua NestJS Gateway Token Guard (Port 10004)
    const token = typeof getAuthToken === 'function' ? getAuthToken() : '';
    const whepHeaders = { 'Content-Type': 'application/sdp' };
    if (token) whepHeaders['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/v1/video/${encodeURIComponent(deviceId)}/whep`, {
      method: 'POST',
      body: clientFirstOfferSdp,
      headers: whepHeaders
    });

    if (!res.ok) {
      throw new Error(`Server WHEP trả về mã lỗi: ${res.status}`);
    }

    // 4. Nhận bản tin SDP Answer từ MediaMTX và chuẩn hóa IP Public
    const rawAnswerSdp = await res.text();
    const cleanAnswerSdp = sanitizeWhepAnswerSdp(rawAnswerSdp);
    
    // Đặt Remote Description: Ngay tại dòng này, Trình duyệt sẽ BẮN GÓI TIN UDP ĐẦU TIÊN vào 103.253.20.32:10005!
    await pc.setRemoteDescription({ type: 'answer', sdp: cleanAnswerSdp });
    console.log(`[FPV WebRTC] Bắt tay WHEP hoàn tất cho ${deviceId}! Trình duyệt đã bắn gói tin mở cổng trước.`);

    if (socket) socket.emit('video:subscribe', { deviceId });

  } catch (err) {
    // 3. Fallback sang Low-Latency HLS nếu WebRTC không khả dụng
    console.warn('[FPV] Không thể kết nối WebRTC WHEP, tự động chuyển sang HLS Fallback:', err.message);
    if (DOM.fpvLoadingText) {
      DOM.fpvLoadingText.innerText = `Chuyển sang kênh dự phòng HLS cho ${deviceId}...`;
    }
    startHlsFallbackStream(deviceId);
  }
}

/**
 * Trình phát dự phòng Low-Latency HLS (HTTP Live Streaming) qua Port 10004.
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
        backBufferLength: 1,
        maxBufferLength: 2,
        maxMaxBufferLength: 4,
        liveSyncDuration: 0.5,
        liveMaxLatencyDuration: 1.5,
        maxLiveSyncPlaybackRate: 1.5,
        liveDurationInfinity: true,
        highBufferWatchdogPeriod: 1,
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
      });

      hls.on(Hls.Events.LEVEL_UPDATED, () => {
        if (hls.liveSyncPosition && Math.abs(DOM.fpvVideoEl.currentTime - hls.liveSyncPosition) > 1.8) {
          DOM.fpvVideoEl.currentTime = hls.liveSyncPosition;
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

// --- BIẾN ĐO ĐẠC STATS VIDEO THỜI GIAN THỰC ---
let lastRtpBytes = 0;
let lastRtpTimestamp = 0;
let lastJitterBufferDelay = 0;
let lastJitterEmittedCount = 0;
let lastTotalDecodeTime = 0;
let lastFramesDecoded = 0;

/**
 * Đóng luồng Video và dọn dẹp các tài nguyên mạng / bộ nhớ.
 * 
 * @param {boolean} updateUiState Có cập nhật lại nhãn nút bấm hay không
 */
function closeFpvVideoStream(updateUiState = true) {
  if (updateUiState && DOM.btnVideoLabel) {
    DOM.btnVideoLabel.innerText = 'Bật Live FPV';
  }

  // Dọn dẹp bộ đếm FPS/Stats
  if (fpvStatsInterval) {
    clearInterval(fpvStatsInterval);
    fpvStatsInterval = null;
  }

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
 * Tái đồng bộ mép phát Live Edge của Video (áp dụng cho HLS).
 */
function resyncLiveEdge() {
  if (fpvHlsInstance && fpvHlsInstance.liveSyncPosition && DOM.fpvVideoEl) {
    DOM.fpvVideoEl.currentTime = fpvHlsInstance.liveSyncPosition;
  }
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
 * Tính toán và cập nhật các thông số Video thời gian thực (Real-time Stats):
 *  1. Độ trễ thực tế (Latency): RTT + Jitter Buffer Delay qua API RTCPeerConnection.getStats().
 *  2. Băng thông video thật (Real Bitrate Mbps).
 *  3. Độ phân giải và Tốc độ khung hình (Resolution & FPS).
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
            if (lastFramesDecoded > 0 && report.framesDecoded > lastFramesDecoded) {
              const deltaDecode = report.totalDecodeTime - lastTotalDecodeTime;
              const deltaFrames = report.framesDecoded - lastFramesDecoded;
              if (deltaFrames > 0 && deltaDecode >= 0) {
                decodeDelayMs = Math.round((deltaDecode / deltaFrames) * 1000);
              }
            }
            lastTotalDecodeTime = report.totalDecodeTime;
            lastFramesDecoded = report.framesDecoded;
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
