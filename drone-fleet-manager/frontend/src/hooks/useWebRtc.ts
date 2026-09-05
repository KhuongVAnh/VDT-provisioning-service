import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { Socket } from 'socket.io-client';
import { getStoredToken } from '../services/api';

const isPrivateIp = (ip: string) => {
  return /^(10\.|192\.168\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip);
};

const sanitizeWhepAnswerSdp = (sdp: string) => {
  if (!sdp) return sdp;
  const lines = sdp.split(/\r?\n/);
  let publicHost: string | null = null;

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

  let result = sdp;
  if (publicHost && /^\d+\.\d+\.\d+\.\d+$/.test(publicHost)) {
    result = sdp.replace(/c=IN IP4 [0-9.]+/g, `c=IN IP4 ${publicHost}`);
  }

  const filteredLines = result.split(/\r?\n/).filter((line) => {
    if (line.startsWith('a=candidate:')) {
      const match = line.match(/^a=candidate:[^\s]+\s+\d+\s+(?:udp|tcp)\s+\d+\s+([^\s]+)\s+\d+/i);
      if (match && isPrivateIp(match[1])) {
        return false;
      }
    }
    return true;
  });

  return filteredLines.join('\r\n');
};

export interface VideoStats {
  latencyMs: number | null;
  bitrateMbps: string | null;
  transportProtocol: 'UDP' | 'TCP' | 'HLS' | '--';
  resolution: string;
  fps: number;
  rttMs?: number;
  jitterDelayMs?: number;
  decodeDelayMs?: number;
}

export const useWebRtc = (deviceId: string | null, socket?: Socket | null) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Recovery & Probe refs
  const frozenTicksRef = useRef<number>(0);
  const lastFramesDecodedRef = useRef<number>(0);
  const lastRtpBytesRef = useRef<number>(0);
  const lastRtpTimestampRef = useRef<number>(0);
  const lastJitterBufferDelayRef = useRef<number>(0);
  const lastJitterEmittedCountRef = useRef<number>(0);
  const lastTotalDecodeTimeRef = useRef<number>(0);
  const lastHlsHardSeekTimeRef = useRef<number>(0);
  const isProbingWebRtcRef = useRef<boolean>(false);
  const probePcRef = useRef<RTCPeerConnection | null>(null);
  const probeTimeoutRef = useRef<any>(null);

  const statsIntervalRef = useRef<any>(null);
  const probingIntervalRef = useRef<any>(null);

  // States
  const [streamType, setStreamType] = useState<'webrtc' | 'hls' | 'none'>('none');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'recovering' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [resolution, setResolution] = useState('0x0');
  const [fps, setFps] = useState(0);
  const [isProbing, setIsProbing] = useState(false);
  const [stats, setStats] = useState<VideoStats>({
    latencyMs: null,
    bitrateMbps: null,
    transportProtocol: '--',
    resolution: '--x--',
    fps: 0,
  });

  // Resync Live Edge (for HLS and WebRTC)
  const resyncLiveEdge = useCallback(() => {
    if (hlsRef.current && hlsRef.current.liveSyncPosition && videoRef.current) {
      videoRef.current.currentTime = hlsRef.current.liveSyncPosition;
      console.log('[FPV Self-Healing] Đã nhảy cóc về mép phát Live Edge HLS.');
    } else if (videoRef.current && videoRef.current.paused) {
      videoRef.current.play().catch(() => { });
    }
  }, []);

  // Cleanup all connections and timers
  const cleanup = useCallback(() => {
    if (probingIntervalRef.current) {
      clearInterval(probingIntervalRef.current);
      probingIntervalRef.current = null;
    }
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    if (probeTimeoutRef.current) {
      clearTimeout(probeTimeoutRef.current);
      probeTimeoutRef.current = null;
    }
    if (probePcRef.current) {
      probePcRef.current.close();
      probePcRef.current = null;
    }
    isProbingWebRtcRef.current = false;
    setIsProbing(false);

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.src = '';
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }

    if (socket && deviceId && deviceId !== 'all') {
      socket.emit('video:unsubscribe', { deviceId });
    }

    frozenTicksRef.current = 0;
    lastFramesDecodedRef.current = 0;
    lastRtpBytesRef.current = 0;
    lastRtpTimestampRef.current = 0;
    lastJitterBufferDelayRef.current = 0;
    lastJitterEmittedCountRef.current = 0;
    lastTotalDecodeTimeRef.current = 0;
    lastHlsHardSeekTimeRef.current = 0;

    setStreamType('none');
    setStatus('idle');
    setStatusMessage('');
    setStats({
      latencyMs: null,
      bitrateMbps: null,
      transportProtocol: '--',
      resolution: '--x--',
      fps: 0,
    });
  }, [deviceId, socket]);

  // Forward declarations for mutual recursion
  const startStreamRef = useRef<(devId: string) => Promise<void>>(async () => { });
  const startHlsFallbackRef = useRef<(devId: string) => Promise<void>>(async () => { });

  // 1. Start WebRTC Background Probing (Runs every 15s when on HLS Fallback)
  const startWebRtcProbing = useCallback((devId: string) => {
    if (probingIntervalRef.current) {
      clearInterval(probingIntervalRef.current);
      probingIntervalRef.current = null;
    }

    probingIntervalRef.current = setInterval(async () => {
      // Only probe if currently running HLS, not already probing, and valid drone
      if (!hlsRef.current || isProbingWebRtcRef.current) return;

      isProbingWebRtcRef.current = true;
      setIsProbing(true);
      console.log(`[FPV Self-Healing] Đang dò tìm tín hiệu WebRTC WHEP ngầm cho ${devId}...`);

      try {
        const probePc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
          ],
        });
        probePcRef.current = probePc;

        probePc.addTransceiver('video', { direction: 'recvonly' });

        // 6 second timeout to avoid leaking resources
        probeTimeoutRef.current = setTimeout(() => {
          probePc.close();
          probePcRef.current = null;
          isProbingWebRtcRef.current = false;
          setIsProbing(false);
        }, 6000);

        probePc.ontrack = (event) => {
          clearTimeout(probeTimeoutRef.current);
          console.log(`[FPV Self-Healing] 🎉 Dò WebRTC WHEP thành công! Đang Hot-swap từ HLS sang WebRTC...`);

          // 1. Clean up HLS
          if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
          }

          // 2. Transfer peer connection
          if (pcRef.current) pcRef.current.close();
          pcRef.current = probePc;
          probePcRef.current = null;

          // 3. Assign stream to video element
          if (videoRef.current) {
            if (event.streams && event.streams[0]) {
              videoRef.current.srcObject = event.streams[0];
            } else if (event.track) {
              videoRef.current.srcObject = new MediaStream([event.track]);
            }
            videoRef.current.play().catch(() => { });
          }

          // 4. Update status
          setStreamType('webrtc');
          setStatus('connected');
          setStatusMessage('WebRTC Ultra-Low Latency (Đã Hot-swap từ HLS)');

          // 5. Clear probing timer
          if (probingIntervalRef.current) {
            clearInterval(probingIntervalRef.current);
            probingIntervalRef.current = null;
          }
          isProbingWebRtcRef.current = false;
          setIsProbing(false);
        };

        const offer = await probePc.createOffer();
        await probePc.setLocalDescription(offer);

        const clientFirstOfferSdp = probePc.localDescription?.sdp
          ?.split(/\r?\n/)
          ?.filter((line) => !line.startsWith('a=candidate:'))
          ?.join('\r\n') || '';

        const token = getStoredToken() || '';
        const whepHeaders: HeadersInit = { 'Content-Type': 'application/sdp' };
        if (token) whepHeaders['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api/v1/video/${encodeURIComponent(devId)}/whep`, {
          method: 'POST',
          body: clientFirstOfferSdp,
          headers: whepHeaders,
        });

        if (res.ok) {
          const rawAnswer = await res.text();
          const cleanAnswer = sanitizeWhepAnswerSdp(rawAnswer);
          await probePc.setRemoteDescription({ type: 'answer', sdp: cleanAnswer });
        } else {
          probePc.close();
          probePcRef.current = null;
          isProbingWebRtcRef.current = false;
          setIsProbing(false);
        }
      } catch (e) {
        isProbingWebRtcRef.current = false;
        setIsProbing(false);
      }
    }, 15000);
  }, []);

  // 2. Start HLS Fallback
  const startHlsFallback = useCallback(async (devId: string) => {
    try {
      setStatus('connecting');
      setStatusMessage(`Chuyển sang kênh HLS dự phòng cho ${devId}...`);

      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }

      const token = getStoredToken() || '';
      const headers: HeadersInit = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/video/${encodeURIComponent(devId)}/stream-info`, { headers });
      const json = await res.json();
      if (json.status !== 'success' || !json.data?.hlsUrl) {
        throw new Error('Không lấy được luồng HLS');
      }

      const hlsUrl = json.data.hlsUrl;

      if (socket) {
        socket.emit('video:subscribe', { deviceId: devId });
      }

      if (Hls.isSupported()) {
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
          xhrSetup: (xhr) => {
            if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          },
        });

        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        if (videoRef.current) {
          hls.attachMedia(videoRef.current);
        }

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStreamType('hls');
          setStatus('connected');
          setStatusMessage('HLS Live');
          setStatusMessage('HLS Live (Dự phòng)');
          videoRef.current?.play().catch(() => { });

          // Start background probing to hot-swap back to WebRTC
          startWebRtcProbing(devId);
        });

        // Hard-Seek with Cooldown to eliminate accumulated buffer drift
        hls.on(Hls.Events.LEVEL_UPDATED, () => {
          const now = Date.now();
          if (
            hls.liveSyncPosition &&
            videoRef.current &&
            Math.abs(videoRef.current.currentTime - hls.liveSyncPosition) > 1.8
          ) {
            if (now - lastHlsHardSeekTimeRef.current > 3000) {
              lastHlsHardSeekTimeRef.current = now;
              videoRef.current.currentTime = hls.liveSyncPosition;
              console.log('[FPV HLS] Đã kích hoạt Hard-Seek Live Edge (> 1.8s drift)');
            }
          }
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            console.warn('[FPV HLS] Lỗi fatal HLS:', data.details);
            setStatus('error');
            setStatusMessage('Lỗi kênh phát HLS');
            setStatusMessage('Mất tín hiệu luồng HLS. Đang đợi máy bay truyền RTSP...');
          }
        });
      } else if (videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Safari HLS
        // Native Apple Safari HLS
        videoRef.current.src = hlsUrl;
        videoRef.current.play().catch(() => { });
        setStreamType('hls');
        setStatus('connected');
        setStatusMessage('HLS Live (Safari Native)');
        startWebRtcProbing(devId);
      }
    } catch (e: any) {
      setStatus('error');
      setStatusMessage(e.message || 'Mất kết nối video');
    }
  }, [socket, startWebRtcProbing]);

  startHlsFallbackRef.current = startHlsFallback;

  // 3. WebRTC Frozen Frame Watchdog Recovery Handler
  const handleWebRtcFrozenRecovery = useCallback(async (devId: string) => {
    console.warn(`[FPV Watchdog] Đang tự động kết nối lại WebRTC cho ${devId}...`);
    setStatus('recovering');
    setStatusMessage('Phát hiện đóng băng khung hình (3s). Đang tự phục hồi...');

    try {
      await startStreamRef.current(devId);
    } catch (err) {
      console.warn('[FPV Watchdog] Tự kết nối lại WebRTC thất bại, chuyển sang HLS Fallback:', err);
      startHlsFallbackRef.current(devId);
    }
  }, []);

  // 4. Primary WebRTC WHEP Connection
  const startStream = useCallback(async (devId: string) => {
    cleanup();
    if (!devId || devId === 'all') return;

    setStatus('connecting');
    setStatusMessage(`Đang kết nối WebRTC WHEP (< 200ms) cho ${devId}...`);

    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
        ],
      });
      pcRef.current = pc;

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setStatus('connected');
          setStatusMessage('WebRTC Ultra-Low Latency');
        } else if (pc.iceConnectionState === 'failed') {
          console.warn('[FPV WebRTC] ICE Connection Failed, Fallback sang HLS...');
          startHlsFallbackRef.current(devId);
        }
      };

      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (videoRef.current) {
          videoRef.current.muted = true;
          videoRef.current.playsInline = true;
          videoRef.current.autoplay = true;

          if (event.streams && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
          } else if (event.track) {
            videoRef.current.srcObject = new MediaStream([event.track]);
          }

          videoRef.current.play().catch(() => { });
          videoRef.current.play().catch((e) => {
            if (e.name !== 'AbortError') {
              console.warn('[FPV Video] Tự động phát bị chặn bởi trình duyệt:', e);
            }
          });

          setStreamType('webrtc');
          setStatus('connected');
          setStatusMessage('WebRTC Ultra-Low Latency');
        }
      };

      // Client-First Offer SDP
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const clientFirstOfferSdp = pc.localDescription?.sdp
        ?.split(/\r?\n/)
        ?.filter((line) => !line.startsWith('a=candidate:'))
        ?.join('\r\n') || '';

      const token = getStoredToken() || '';
      const whepHeaders: HeadersInit = { 'Content-Type': 'application/sdp' };
      if (token) whepHeaders['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/video/${encodeURIComponent(devId)}/whep`, {
        method: 'POST',
        body: clientFirstOfferSdp,
        headers: whepHeaders,
      });

      if (!res.ok) {
        throw new Error(`WHEP HTTP error code: ${res.status}`);
      }

      const rawAnswer = await res.text();
      const cleanAnswer = sanitizeWhepAnswerSdp(rawAnswer);
      await pc.setRemoteDescription({ type: 'answer', sdp: cleanAnswer });

      if (socket) {
        socket.emit('video:subscribe', { deviceId: devId });
      }
    } catch (e: any) {
      console.warn('[WebRTC] Kết nối WebRTC không thành công, tự động chuyển HLS:', e);
      startHlsFallbackRef.current(devId);
    }
  }, [cleanup, socket]);

  startStreamRef.current = startStream;

  // 5. Lifecycle hook on deviceId change
  useEffect(() => {
    if (deviceId && deviceId !== 'all') {
      startStream(deviceId);
    } else {
      cleanup();
    }
    return () => cleanup();
  }, [deviceId, startStream, cleanup]);

  // 6. Resolution & FPS Monitor
  useEffect(() => {
    const timer = setInterval(() => {
      if (videoRef.current && status === 'connected') {
        const w = videoRef.current.videoWidth;
        const h = videoRef.current.videoHeight;
        if (w > 0 && h > 0) {
          setResolution(`${w}x${h}`);
          setFps(w >= 1280 ? 60 : 30);
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [status]);

  // 7. Page Visibility API: Auto-resync when returning to dashboard tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('[FPV Lifecycle] Dashboard tab active trở lại -> Kiểm tra và tái đồng bộ...');
        if (hlsRef.current) {
          resyncLiveEdge();
        }
        if (videoRef.current && videoRef.current.paused) {
          videoRef.current.play().catch(() => { });
        }
        frozenTicksRef.current = 0;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [resyncLiveEdge]);

  // 7. W3C Real-time Stats & Watchdog Loop (Runs every 1s)
  useEffect(() => {
    const updateStats = async () => {
      if (!videoRef.current || status === 'idle' || status === 'error') return;

      // CASE A: WebRTC WHEP Connection
      if (
        pcRef.current &&
        (pcRef.current.connectionState === 'connected' ||
          pcRef.current.iceConnectionState === 'connected' ||
          pcRef.current.iceConnectionState === 'completed')
      ) {
        try {
          const reportStats = await pcRef.current.getStats();
          let rttMs = 0;
          let jitterDelayMs = 0;
          let decodeDelayMs = 0;
          let currentBytes = 0;
          let currentTimestamp = 0;
          let rtpFps = 0;
          let rtpWidth = videoRef.current.videoWidth || 0;
          let rtpHeight = videoRef.current.videoHeight || 0;
          let transportProtocol: 'UDP' | 'TCP' = 'UDP';
          let currentFramesDecoded = 0;

          reportStats.forEach((report) => {
            // Read RTT & Protocol from active candidate pair
            if (
              report.type === 'candidate-pair' &&
              (report.state === 'succeeded' || report.nominated || report.selected)
            ) {
              if (report.currentRoundTripTime !== undefined) {
                rttMs = Math.round(report.currentRoundTripTime * 1000);
              }
              if (report.remoteCandidateId) {
                const remoteCand = reportStats.get(report.remoteCandidateId);
                if (remoteCand?.protocol) {
                  transportProtocol = remoteCand.protocol.toUpperCase() === 'TCP' ? 'TCP' : 'UDP';
                }
              }
            }

            // Read Inbound RTP metrics
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
              // Jitter Buffer Delay
              if (report.jitterBufferDelay !== undefined && report.jitterBufferEmittedCount !== undefined) {
                if (
                  lastJitterEmittedCountRef.current > 0 &&
                  report.jitterBufferEmittedCount > lastJitterEmittedCountRef.current
                ) {
                  const deltaDelay = report.jitterBufferDelay - lastJitterBufferDelayRef.current;
                  const deltaCount = report.jitterBufferEmittedCount - lastJitterEmittedCountRef.current;
                  if (deltaCount > 0 && deltaDelay >= 0) {
                    jitterDelayMs = Math.round((deltaDelay / deltaCount) * 1000);
                  }
                }
                lastJitterBufferDelayRef.current = report.jitterBufferDelay;
                lastJitterEmittedCountRef.current = report.jitterBufferEmittedCount;
              }

              // Hardware Decode Delay
              if (report.totalDecodeTime !== undefined && report.framesDecoded !== undefined) {
                currentFramesDecoded = report.framesDecoded;
                if (
                  lastFramesDecodedRef.current > 0 &&
                  report.framesDecoded > lastFramesDecodedRef.current
                ) {
                  const deltaDecode = report.totalDecodeTime - lastTotalDecodeTimeRef.current;
                  const deltaFrames = report.framesDecoded - lastFramesDecodedRef.current;
                  if (deltaFrames > 0 && deltaDecode >= 0) {
                    decodeDelayMs = Math.round((deltaDecode / deltaFrames) * 1000);
                  }
                }
                lastTotalDecodeTimeRef.current = report.totalDecodeTime;
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

          // 🟢 FROZEN FRAME WATCHDOG CHECK:
          // If framesDecoded does not increase and bytesReceived unchanged for 3 consecutive seconds:
          if (lastFramesDecodedRef.current > 0 && currentFramesDecoded > 0) {
            if (
              currentFramesDecoded === lastFramesDecodedRef.current &&
              currentBytes === lastRtpBytesRef.current
            ) {
              frozenTicksRef.current++;
            } else {
              frozenTicksRef.current = 0;
            }

            if (frozenTicksRef.current >= 3) {
              console.warn(
                `[FPV Watchdog] ⚠️ Luồng WebRTC của ${deviceId} bị đóng băng khung hình trong 3s! Đang kích hoạt tự phục hồi...`
              );
              frozenTicksRef.current = 0;
              if (deviceId) {
                handleWebRtcFrozenRecovery(deviceId);
              }
            }
          }
          lastFramesDecodedRef.current = currentFramesDecoded;

          // Latency Calculation: (RTT / 2) + Jitter Buffer Delay + Hardware Decode Delay
          const netLatencyMs = rttMs > 0 ? Math.round(rttMs / 2) : 0;
          const totalLatency = netLatencyMs + jitterDelayMs + decodeDelayMs;
          const measuredLatency = totalLatency > 0 ? totalLatency : (netLatencyMs > 0 ? netLatencyMs : 25);

          // Bitrate Calculation
          let measuredBitrate: string | null = null;
          if (
            lastRtpBytesRef.current > 0 &&
            lastRtpTimestampRef.current > 0 &&
            currentBytes > lastRtpBytesRef.current
          ) {
            const timeDiffSec = (currentTimestamp - lastRtpTimestampRef.current) / 1000;
            if (timeDiffSec > 0) {
              const bitRateBps = ((currentBytes - lastRtpBytesRef.current) * 8) / timeDiffSec;
              measuredBitrate = (bitRateBps / (1024 * 1024)).toFixed(2);
            }
          }
          lastRtpBytesRef.current = currentBytes;
          lastRtpTimestampRef.current = currentTimestamp;

          setStats({
            latencyMs: measuredLatency,
            bitrateMbps: measuredBitrate,
            transportProtocol,
            resolution: rtpWidth && rtpHeight ? `${rtpWidth}x${rtpHeight}` : '--x--',
            fps: rtpFps || (videoRef.current.paused ? 0 : 30),
            rttMs,
            jitterDelayMs,
            decodeDelayMs,
          });
        } catch (err) {
          console.warn('[FPV Stats] Lỗi đọc getStats WebRTC:', err);
        }
      }

      // CASE B: HLS Fallback Connection
      else if (hlsRef.current) {
        const hlsLatencySec =
          hlsRef.current.latency ||
          (hlsRef.current.liveSyncPosition && videoRef.current
            ? Math.max(0.5, Math.abs(videoRef.current.currentTime - hlsRef.current.liveSyncPosition))
            : 1.5);

        let hlsBitrate: string | null = null;
        if (hlsRef.current.bandwidthEstimate) {
          hlsBitrate = (hlsRef.current.bandwidthEstimate / (1024 * 1024)).toFixed(2);
        }

        const w = videoRef.current.videoWidth || 0;
        const h = videoRef.current.videoHeight || 0;

        setStats({
          latencyMs: Math.round(hlsLatencySec * 1000),
          bitrateMbps: hlsBitrate,
          transportProtocol: 'HLS',
          resolution: w && h ? `${w}x${h}` : '--x--',
          fps: videoRef.current.paused ? 0 : 30,
        });
      }
    };

    statsIntervalRef.current = setInterval(updateStats, 1000);
    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
    };
  }, [status, deviceId, handleWebRtcFrozenRecovery]);

  // 8. Capture FPV Snapshot
  const captureSnapshot = useCallback(() => {
    if (!videoRef.current || videoRef.current.videoWidth === 0) {
      return false;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;

      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      const link = document.createElement('a');
      link.download = `FPV_SNAPSHOT_${deviceId || 'DRONE'}_${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      return true;
    } catch (e) {
      console.error('[FPV Snapshot] Lỗi chụp ảnh:', e);
      return false;
    }
  }, [deviceId]);

  return {
    videoRef,
    status,
    statusMessage,
    streamType,
    resolution,
    fps,
    stats,
    isProbing,
    reconnect: () => deviceId && startStream(deviceId),
    resyncLiveEdge,
    captureSnapshot,
  };
};

