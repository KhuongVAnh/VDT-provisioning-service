/**
 * ==============================================================================
 * MODULE VIDEO 2: WEBRTC WHEP ENGINE (video-webrtc.js)
 * ==============================================================================
 * Khởi tạo kết nối WebRTC WHEP (WebRTC HTTP Egress Protocol) cho độ trễ < 100ms.
 * Áp dụng kỹ thuật Client-First UDP Hole Punching để đục lỗ qua Router Cloud NAT.
 * ==============================================================================
 */

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
    // Ngăn không cho MediaMTX trên VPS bắn bất kỳ gói UDP nào ra ngoài trước.
    // Trình duyệt sẽ là bên BẮN GÓI TIN ĐẦU TIÊN để đục lỗ NAT (Reverse DNAT)!
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
    
    // Đặt Remote Description: Trình duyệt bắn gói tin UDP đầu tiên mở cổng
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
