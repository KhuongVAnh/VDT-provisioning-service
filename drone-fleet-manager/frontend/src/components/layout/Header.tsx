import React from 'react';
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
  Gauge
} from 'lucide-react';
import { LayoutMode, DroneDevice } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';

interface HeaderProps {
  devices: DroneDevice[];
  activeDroneId: string;
  onSelectDrone: (id: string) => void;
  layoutMode: LayoutMode;
  onChangeLayoutMode: (mode: LayoutMode) => void;
  isSocketConnected: boolean;
  latencyMs: number;
  onOpenManualRegister: () => void;
  isTelemetryOpen?: boolean;
  onToggleTelemetry?: () => void;
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
  isTelemetryOpen,
  onToggleTelemetry,
}) => {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 w-full bg-white/80 dark:bg-obsidian-950/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800/80 px-4 py-2.5 transition-colors duration-200">
      <div className="max-w-[1920px] mx-auto flex flex-wrap items-center justify-between gap-3">

        {/* Logo & Gateway Status */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-tactical-blue to-cyan-500 text-white shadow-glow-cyan shadow-tactical-cyan/20">
            <Plane className="w-5 h-5 -rotate-45" />
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-tactical-cyan animate-ping" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm tracking-wider uppercase bg-gradient-to-r from-slate-900 via-slate-800 to-tactical-blue dark:from-white dark:via-slate-200 dark:to-tactical-cyan bg-clip-text text-transparent">
                MISSION CONTROL
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700">
                v2.0
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1 font-mono text-[11px]">
                {isSocketConnected ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-tactical-emerald animate-pulse" />
                    <span className="text-tactical-emerald font-medium">LIVE</span>
                    <span className="text-slate-400 dark:text-slate-500">({latencyMs}ms)</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-tactical-red" />
                    <span className="text-tactical-red font-medium">DISCONNECTED</span>
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Tactical View Switcher & Drone Selector */}
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-obsidian-900/90 p-1 rounded-xl border border-slate-200 dark:border-slate-800/80">

          {/* Drone Selector Dropdown */}
          <div className="flex items-center gap-1 px-2 border-r border-slate-200 dark:border-slate-800">
            <Crosshair className="w-4 h-4 text-tactical-blue dark:text-tactical-cyan" />
            <select
              value={activeDroneId}
              onChange={(e) => onSelectDrone(e.target.value)}
              className="bg-transparent text-xs font-mono font-medium focus:outline-none text-slate-800 dark:text-slate-200 cursor-pointer py-1"
            >
              <option value="all" className="bg-white dark:bg-obsidian-900 text-slate-800 dark:text-slate-200">
                🌐 Toàn Phi Đội ({devices.length})
              </option>
              {devices.map((d) => (
                <option
                  key={d.deviceId}
                  value={d.deviceId}
                  className="bg-white dark:bg-obsidian-900 text-slate-800 dark:text-slate-200 font-mono"
                >
                  {d.deviceId} {d.vpnIp ? `(${d.vpnIp})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Layout Mode Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onChangeLayoutMode('mode-map')}
              title="Chế độ Bản đồ (Phím 1)"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${layoutMode === 'mode-map'
                ? 'bg-white dark:bg-slate-800 text-tactical-blue dark:text-tactical-cyan shadow-sm font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Bản đồ</span>
              <span className="text-[10px] opacity-60 font-mono">1</span>
            </button>

            <button
              onClick={() => onChangeLayoutMode('mode-split')}
              title="Chế độ Chia đôi (Phím 2)"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${layoutMode === 'mode-split'
                ? 'bg-white dark:bg-slate-800 text-tactical-blue dark:text-tactical-cyan shadow-sm font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Chia đôi</span>
              <span className="text-[10px] opacity-60 font-mono">2</span>
            </button>

            <button
              onClick={() => onChangeLayoutMode('mode-cockpit')}
              title="Chế độ Cockpit FPV (Phím 3)"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${layoutMode === 'mode-cockpit'
                ? 'bg-white dark:bg-slate-800 text-tactical-blue dark:text-tactical-cyan shadow-sm font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cockpit</span>
              <span className="text-[10px] opacity-60 font-mono">3</span>
            </button>

            {onToggleTelemetry && (
              <button
                onClick={onToggleTelemetry}
                title="Bật / Tắt Khung Giám Sát Bay Tức Thời (PFD)"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${isTelemetryOpen
                    ? 'bg-tactical-blue/15 text-tactical-blue dark:text-tactical-cyan font-bold border border-tactical-blue/30 dark:border-tactical-cyan/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                <Gauge className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Giám sát PFD</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Action Tools: Add Drone, Theme Toggle, User Profile */}
        <div className="flex items-center gap-2.5">
          {/* Quick Add Drone */}
          <button
            onClick={onOpenManualRegister}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-tactical-blue/10 hover:bg-tactical-blue/20 text-tactical-blue dark:bg-tactical-cyan/10 dark:hover:bg-tactical-cyan/20 dark:text-tactical-cyan border border-tactical-blue/30 dark:border-tactical-cyan/30 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Ghi danh Drone</span>
          </button>

          {/* Theme Toggle (Light / Dark) */}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Chuyển sang Chế độ Sáng (Field Ops)' : 'Chuyển sang Chế độ Tối (Night Ops)'}
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-obsidian-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600" />
            )}
          </button>

          {/* Pilot Info & Logout */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
            <div className="hidden lg:block text-right">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                {user?.fullName || user?.email?.split('@')[0] || 'Phi công tác chiến'}
              </div>
              <div className="text-[10px] font-mono text-tactical-blue dark:text-tactical-cyan uppercase tracking-wider">
                {user?.role || 'PILOT'}
              </div>
            </div>

            <button
              onClick={logout}
              title="Đăng xuất khỏi hệ thống"
              className="p-2 rounded-lg text-slate-500 hover:text-tactical-red hover:bg-tactical-red/10 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

        </div>

      </div>
    </header>
  );
};

