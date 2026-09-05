import React, { useState } from 'react';
import {
  Video,
  VideoOff,
  RefreshCw,
  Maximize2,
  Layers,
  Camera,
  Zap,
  Activity,
  Radio,
} from 'lucide-react';
import { Socket } from 'socket.io-client';
import { useWebRtc } from '../../hooks/useWebRtc';
import { DroneTelemetry } from '../../types';
import { HudOverlay } from '../hud/HudOverlay';
import { useToast } from '../../context/ToastContext';

interface FpvPlayerProps {
  activeDroneId: string | null;
  telemetry?: DroneTelemetry;
  socket?: Socket | null;
}

export const FpvPlayer: React.FC<FpvPlayerProps> = ({ activeDroneId, telemetry, socket }) => {
  const { toast } = useToast();
  const [showHud, setShowHud] = useState(true);

  const {
    videoRef,
    status,
    statusMessage,
    streamType,
    stats,
    isProbing,
    reconnect,
    resyncLiveEdge,
    captureSnapshot,
  } = useWebRtc(
    activeDroneId && activeDroneId !== 'all' ? activeDroneId : null,
    socket
  );

  const toggleFullscreen = () => {
    const el = document.getElementById('fpv-container');
    if (el) {
      if (!document.fullscreenElement) {
        el.requestFullscreen().catch(() => { });
      } else {
        document.exitFullscreen().catch(() => { });
      }
    }
  };

  const handleSnapshot = () => {
    const ok = captureSnapshot();
    if (ok) {
      toast.success(`Đã chụp ảnh màn hình FPV (${stats.resolution})`);
    } else {
      toast.warning('Không thể chụp ảnh: Luồng video chưa sẵn sàng.');
    }
  };

  const handleLiveSync = () => {
    resyncLiveEdge();
    toast.info('Đã tái đồng bộ về mép phát thời gian thực (Live Edge)');
  };

  // Color-coded latency badge
  const latencyColor =
    stats.latencyMs === null
      ? 'text-slate-400'
      : stats.latencyMs < 150
        ? 'text-tactical-emerald'
        : stats.latencyMs < 280
          ? 'text-amber-400'
          : 'text-tactical-red';

  return (
    <div
      id="fpv-container"
      className="relative w-full h-full min-h-[350px] bg-black rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-inner flex flex-col justify-center items-center group"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="w-full h-full object-cover"
      />

      {/* HUD Overlay Layer */}
      {showHud && activeDroneId && activeDroneId !== 'all' && (
        <HudOverlay telemetry={telemetry} activeDroneId={activeDroneId} />
      )}

      {/* Watchdog Auto-Recovery Notification Banner */}
      {status === 'recovering' && (
        <div className="absolute top-3 left-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-950/85 border border-amber-500/60 text-amber-300 text-xs font-mono shadow-lg backdrop-blur-md animate-pulse">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
          <span>Watchdog: Đóng băng khung hình 3s, đang tự động phục hồi luồng...</span>
        </div>
      )}

      {/* Background Probing Badge (When on HLS and probing for WebRTC) */}
      {streamType === 'hls' && isProbing && status !== 'recovering' && (
        <div className="absolute top-3 left-3 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 text-[11px] font-mono shadow-md backdrop-blur-md">
          <Radio className="w-3 h-3 text-tactical-cyan animate-pulse" />
          <span>Đang dò tín hiệu WebRTC WHEP ngầm để nâng cấp...</span>
        </div>
      )}

      {/* Overlay when NOT connected or no drone selected */}
      {(!activeDroneId || activeDroneId === 'all' || (status !== 'connected' && status !== 'recovering')) && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-20">
          {!activeDroneId || activeDroneId === 'all' ? (
            <div className="flex flex-col items-center gap-3">
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-tactical-blue dark:text-tactical-cyan shadow-glow-cyan shadow-tactical-cyan/10">
                <Video className="w-8 h-8 opacity-60" />
              </div>
              <div className="text-sm font-semibold text-slate-300">
                CHƯA CHỌN DRONE PHÁT LIVE
              </div>
              <p className="text-xs text-slate-500 max-w-xs">
                Vui lòng chọn 1 Drone từ danh sách trên Header hoặc click vào hàng Drone ở bảng bên dưới để mở FPV stream.
              </p>
            </div>
          ) : status === 'connecting' ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-tactical-cyan border-t-transparent animate-spin" />
              <div className="text-sm font-semibold text-tactical-cyan font-mono">
                {statusMessage}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 rounded-xl bg-tactical-red/10 text-tactical-red border border-tactical-red/30">
                <VideoOff className="w-6 h-6" />
              </div>
              <div className="text-sm font-semibold text-slate-200">
                LUỒNG VIDEO CHƯA KHẢ DỤNG
              </div>
              <p className="text-xs text-slate-400 max-w-xs font-mono">
                {statusMessage || 'Drone chưa truyền RTSP tới MediaMTX Gateway'}
              </p>
              <button
                onClick={reconnect}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-all cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Thử kết nối lại
              </button>
            </div>
          )}
        </div>
      )}

      {/* Video Control Bar & W3C Metrics (Top Right) */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 bg-slate-950/80 dark:bg-black/80 backdrop-blur-md p-1.5 rounded-xl border border-slate-800 shadow-xl">
        {/* Real-time W3C stats badge */}
        {(status === 'connected' || status === 'recovering') && (
          <div className="flex items-center gap-2.5 px-2 text-[10px] font-mono text-slate-300 border-r border-slate-800 pr-2.5">
            {/* Protocol */}
            <span
              className={`flex items-center gap-1 font-bold ${streamType === 'webrtc' ? 'text-tactical-emerald' : 'text-amber-400'
                }`}
              title={`Giao thức truyền tải: ${streamType.toUpperCase()} (${stats.transportProtocol})`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${streamType === 'webrtc' ? 'bg-tactical-emerald animate-pulse' : 'bg-amber-400'}`} />
              {streamType.toUpperCase()} ({stats.transportProtocol})
            </span>
            <span>{stats.resolution}</span>
            <span>{stats.fps} FPS</span>

            {/* Measured Latency */}
            {stats.latencyMs !== null && (
              <span
                className={`flex items-center gap-0.5 font-bold ${latencyColor}`}
                title={`Độ trễ thực tế chuẩn W3C: ${stats.latencyMs}ms (RTT/2: ${stats.rttMs ? Math.round(stats.rttMs / 2) : 0}ms + Jitter: ${stats.jitterDelayMs || 0}ms + Decode: ${stats.decodeDelayMs || 0}ms)`}
              >
                <Zap className="w-3 h-3" />
                {stats.latencyMs}ms
              </span>
            )}

            {/* Measured Bitrate */}
            {stats.bitrateMbps && (
              <span className="hidden sm:flex items-center gap-0.5 text-slate-300" title="Băng thông video thực tế">
                <Activity className="w-3 h-3 text-tactical-cyan" />
                {stats.bitrateMbps} Mbps
              </span>
            )}

            {/* Resolution & FPS */}
            <span className="hidden md:inline text-slate-400">
              {stats.resolution} @ {stats.fps} FPS
            </span>
          </div>
        )}

        {/* Action: Snapshot */}
        <button
          onClick={handleSnapshot}
          title="Chụp ảnh màn hình FPV (Snapshot PNG)"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <Camera className="w-4 h-4" />
        </button>

        {/* Action: Live Sync (Hard seek to live edge) */}
        <button
          onClick={handleLiveSync}
          title="Tái đồng bộ mép phát Live Edge (Triệt tiêu đệm trễ)"
          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <Zap className="w-4 h-4" />
        </button>

        {/* Action: Toggle HUD Button */}
        <button
          onClick={() => setShowHud(!showHud)}
          title={showHud ? 'Ẩn lớp phủ HUD Cockpit' : 'Hiện lớp phủ HUD Cockpit'}
          className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${showHud ? 'bg-tactical-cyan/20 text-tactical-cyan' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
        >
          <Layers className="w-4 h-4" />
        </button>

        {/* Action: Reconnect button */}
        {activeDroneId && activeDroneId !== 'all' && (
          <button
            onClick={reconnect}
            title="Khởi động lại luồng FPV"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}

        {/* Action: Fullscreen button */}
        <button
          onClick={toggleFullscreen}
          title="Toàn màn hình FPV"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
