import React, { useMemo } from 'react';
import {
  Radio,
  Map as MapIcon,
  Columns2,
  Crosshair,
  Sun,
  Moon,
  LogOut,
  Plus,
  Wifi,
  WifiOff,
  ShieldCheck,
  Plane,
  Gauge,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  KeyRound,
  Server
} from 'lucide-react';
import { LayoutMode, DroneDevice, DroneTelemetry } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { isDroneOnline } from '../../hooks/useTelemetry';

interface HeaderProps {
  devices: DroneDevice[];
  activeDroneId: string;
  onSelectDrone: (id: string) => void;
  layoutMode: LayoutMode;
  onChangeLayoutMode: (mode: LayoutMode) => void;
  isSocketConnected: boolean;
  latencyMs: number;
  onOpenManualRegister: () => void;
  onOpenClaimDrone?: () => void;
  isTelemetryOpen?: boolean;
  onToggleTelemetry?: () => void;
  telemetrySnapshot?: Record<string, DroneTelemetry>;
  isCompactView?: boolean;
  onToggleCompactView?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  devices,
  activeDroneId,
  onSelectDrone,
  layoutMode,
  onChangeLayoutMode,
  isSocketConnected,
  latencyMs,
  onOpenManualRegister,
  onOpenClaimDrone,
  isTelemetryOpen,
  onToggleTelemetry,
  telemetrySnapshot,
  isCompactView,
  onToggleCompactView,
}) => {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { isSoundEnabled, toggleSound } = useToast();

  // Chỉ lọc và giữ lại những Drone đang Online
  const onlineDevices = useMemo(() => {
    return devices.filter((d) => {
      const t = telemetrySnapshot?.[d.deviceId] || d.telemetry;
      return isDroneOnline(t);
    });
  }, [devices, telemetrySnapshot]);

  return (
    <header className="sticky top-0 z-40 w-full bg-titanium-50/95 dark:bg-obsidian-950/95 backdrop-blur-md border-b border-titanium-300 dark:border-obsidian-800 transition-colors duration-200 shadow-sm">
      <div className="max-w-[1920px] mx-auto px-3 sm:px-4">

        {/* ================================================================ */}
        {/* HÀNG 1: GLOBAL BRAND & SYSTEM ACTIONS BAR                        */}
        {/* ================================================================ */}
        <div className="flex items-center justify-between gap-3 py-2 border-b border-titanium-200/80 dark:border-obsidian-800/80">
          
          {/* Brand Logo & Gateway Connectivity Status */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-tactical-blue to-cyan-500 text-white shadow-glow-cyan shadow-tactical-cyan/20 shrink-0">
              <Plane className="w-4 h-4 sm:w-5 sm:h-5 -rotate-45" />
              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-tactical-cyan animate-ping motion-reduce:animate-none" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm sm:text-base tracking-wider uppercase bg-gradient-to-r from-slate-900 via-slate-800 to-tactical-blue dark:from-white dark:via-slate-200 dark:to-tactical-cyan bg-clip-text text-transparent font-sans">
                  MISSION CONTROL
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold border border-slate-300/80 dark:border-slate-700">
                  v2.0 PRO
                </span>
              </div>

              <div className="flex items-center gap-2 text-[10px] sm:text-[11px] font-mono text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isSocketConnected ? 'bg-tactical-emerald animate-pulse motion-reduce:animate-none' : 'bg-tactical-red'
                    }`}
                  />
                  <span className="font-semibold">{isSocketConnected ? 'HỆ THỐNG TRỰC TUYẾN' : 'MẤT KẾT NỐI'}</span>
                </span>
                <span>•</span>
                <span>PING: <strong className="text-tactical-blue dark:text-tactical-cyan">{latencyMs}ms</strong></span>
              </div>
            </div>
          </div>

          {/* Right Action Tools: Audio SFX, Theme, Claim Drone, VPN Provisioning, User Profile */}
          <div className="flex items-center gap-2">
            {/* Tactical Audio SFX Mute/Unmute Toggle */}
            <button
              type="button"
              onClick={toggleSound}
              title={isSoundEnabled ? 'Tắt âm thanh tác chiến (Mute SFX)' : 'Bật âm thanh tác chiến (Web Audio SFX)'}
              className={`p-2 rounded-lg border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none ${
                isSoundEnabled
                  ? 'bg-tactical-cyan/10 text-tactical-blue dark:text-tactical-cyan border-tactical-cyan/30'
                  : 'bg-slate-100 dark:bg-obsidian-900 text-slate-400 border-slate-300 dark:border-slate-800'
              }`}
            >
              {isSoundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Quick Claim Drone (for Pilots & Admins) */}
            {onOpenClaimDrone && (
              <button
                type="button"
                onClick={onOpenClaimDrone}
                title="Nhận quyền quản lý Drone tác chiến (Claim Drone)"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-tactical-blue/15 to-tactical-cyan/15 hover:from-tactical-blue/25 hover:to-tactical-cyan/25 text-tactical-blue dark:text-tactical-cyan border border-tactical-blue/30 dark:border-tactical-cyan/40 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none shadow-sm"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Nhận quyền Drone</span>
              </button>
            )}

            {/* Hardware VPN Provisioning (Admin Only) */}
            {user?.role === 'ADMIN' && (
              <button
                type="button"
                onClick={onOpenManualRegister}
                title="Cấp phát mạng WireGuard & IP cho phần cứng Drone mới (Chỉ dành cho Quản trị viên)"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-obsidian-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-800 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none"
              >
                <Server className="w-3.5 h-3.5" />
                <span>Cấp phát VPN</span>
              </button>
            )}

            {/* Theme Toggle (Light / Dark) */}
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Chuyển sang Chế độ Sáng (Field Ops)' : 'Chuyển sang Chế độ Tối (Night Ops)'}
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-obsidian-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-800 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-600" />
              )}
            </button>

            {/* Pilot Info & Logout */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-300 dark:border-slate-800">
              <div className="hidden sm:block text-right">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                  {user?.fullName || user?.email?.split('@')[0] || 'Phi công tác chiến'}
                </div>
                <div className="text-[10px] font-mono text-tactical-blue dark:text-tactical-cyan uppercase tracking-wider">
                  {user?.role || 'PILOT'}
                </div>
              </div>

              <button
                type="button"
                onClick={logout}
                title="Đăng xuất khỏi hệ thống"
                className="p-2 rounded-lg text-slate-500 hover:text-tactical-red hover:bg-tactical-red/10 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ================================================================ */}
        {/* HÀNG 2: TACTICAL MISSION CONTROL RIBBON                          */}
        {/* ================================================================ */}
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 py-1.5">

          {/* Trái: Bộ chọn Drone mục tiêu (Rộng rãi, thoải mái, không bao giờ bị đè chữ) */}
          <div className="flex items-center gap-2 min-w-0 flex-1 max-w-xl">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-200/70 dark:bg-obsidian-900/90 border border-titanium-300 dark:border-obsidian-800 text-xs w-full sm:w-auto min-w-[280px] max-w-md shadow-inner">
              <Crosshair className="w-4 h-4 text-tactical-blue dark:text-tactical-cyan shrink-0" />
              <span className="text-slate-500 dark:text-slate-400 text-[11px] font-mono font-bold shrink-0">MỤC TIÊU:</span>
              <select
                value={activeDroneId}
                onChange={(e) => onSelectDrone(e.target.value)}
                className="bg-transparent text-xs font-mono font-semibold focus:outline-none text-slate-900 dark:text-slate-100 cursor-pointer py-0.5 w-full focus-visible:ring-1 focus-visible:ring-tactical-cyan rounded"
              >
                <option value="all" className="bg-titanium-50 dark:bg-obsidian-900 text-slate-800 dark:text-slate-200 font-sans">
                  [ALL] Toàn Phi Đội ({onlineDevices.length} drone trực tuyến)
                </option>
                {onlineDevices.map((d) => (
                  <option
                    key={d.deviceId}
                    value={d.deviceId}
                    className="bg-titanium-50 dark:bg-obsidian-900 text-slate-800 dark:text-slate-200 font-mono"
                  >
                    [ON] {d.deviceId} {d.vpnIp ? `(${d.vpnIp})` : ''} - {d.hardwareModel || 'Drone'}
                  </option>
                ))}
              </select>
            </div>

            {/* Quick Online Stats Badge */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-titanium-100 dark:bg-obsidian-900 text-[11px] font-mono text-slate-600 dark:text-slate-400 border border-titanium-300/80 dark:border-obsidian-800 shrink-0">
              <Plane className="w-3.5 h-3.5 text-tactical-cyan" />
              <span>{onlineDevices.length}/{devices.length} Online</span>
            </div>
          </div>

          {/* Phải: Chế độ hiển thị & Công cụ tác chiến */}
          <div className="flex items-center gap-1.5 shrink-0 bg-slate-200/60 dark:bg-obsidian-900/90 p-1 rounded-xl border border-titanium-300 dark:border-obsidian-800">
            {/* Mode 1: Bản đồ */}
            <button
              type="button"
              onClick={() => onChangeLayoutMode('mode-map')}
              title="Chế độ Bản đồ Chiến thuật (Phím 1)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none cursor-pointer ${
                layoutMode === 'mode-map'
                  ? 'bg-titanium-50 dark:bg-slate-800 text-tactical-blue dark:text-tactical-cyan shadow-sm font-semibold border border-tactical-blue/20 dark:border-tactical-cyan/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Bản đồ</span>
              <span className="text-[10px] opacity-60 font-mono">1</span>
            </button>

            {/* Mode 2: Chia đôi */}
            <button
              type="button"
              onClick={() => onChangeLayoutMode('mode-split')}
              title="Chế độ Chia đôi Màn hình (Phím 2)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none cursor-pointer ${
                layoutMode === 'mode-split'
                  ? 'bg-titanium-50 dark:bg-slate-800 text-tactical-blue dark:text-tactical-cyan shadow-sm font-semibold border border-tactical-blue/20 dark:border-tactical-cyan/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>Chia đôi</span>
              <span className="text-[10px] opacity-60 font-mono">2</span>
            </button>

            {/* Mode 3: Cockpit */}
            <button
              type="button"
              onClick={() => onChangeLayoutMode('mode-cockpit')}
              title="Chế độ Buồng lái FPV (Phím 3)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none cursor-pointer ${
                layoutMode === 'mode-cockpit'
                  ? 'bg-titanium-50 dark:bg-slate-800 text-tactical-blue dark:text-tactical-cyan shadow-sm font-semibold border border-tactical-blue/20 dark:border-tactical-cyan/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Cockpit</span>
              <span className="text-[10px] opacity-60 font-mono">3</span>
            </button>

            <div className="w-px h-4 bg-slate-300 dark:bg-slate-800 my-auto mx-0.5" />

            {/* Overlay: Giám sát PFD */}
            {onToggleTelemetry && (
              <button
                type="button"
                onClick={onToggleTelemetry}
                title="Bật / Tắt Khung Giám Sát Bay Tức Thời (PFD)"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none ${
                  isTelemetryOpen
                    ? 'bg-tactical-blue/15 text-tactical-blue dark:text-tactical-cyan font-bold border border-tactical-blue/30 dark:border-tactical-cyan/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Gauge className="w-3.5 h-3.5" />
                <span>Giám sát PFD</span>
              </button>
            )}

            {/* Overlay: C2 Fit-Screen */}
            {onToggleCompactView && (
              <button
                type="button"
                onClick={onToggleCompactView}
                title="Chế độ C2 Fit-to-screen: Thu gọn bảng KPI để mở rộng không gian tác chiến (Phím 4)"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none ${
                  isCompactView
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold border border-amber-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {isCompactView ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                <span>{isCompactView ? 'C2 Fit-Screen' : 'KPI Mở'}</span>
                <span className="text-[10px] opacity-60 font-mono">4</span>
              </button>
            )}
          </div>

        </div>

      </div>
    </header>
  );
};
