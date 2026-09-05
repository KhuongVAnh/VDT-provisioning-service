import React from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  ArrowUpCircle,
  ArrowDownCircle,
  Send,
  Terminal,
  Copy,
  Crosshair,
  AlertTriangle,
  Lock
} from 'lucide-react';
import { DroneDevice, DroneTelemetry } from '../../types';
import { useToast } from '../../context/ToastContext';
import { extractTelemetryMetrics } from '../../utils/telemetry';

interface CommandDeckProps {
  activeDroneId: string;
  devices: DroneDevice[];
  telemetry?: DroneTelemetry;
  onSendCommand: (cmd: 'arm' | 'disarm' | 'takeoff' | 'land' | 'rtl') => void;
  onOpenSsh: () => void;
}

export const CommandDeck: React.FC<CommandDeckProps> = ({
  activeDroneId,
  devices,
  telemetry,
  onSendCommand,
  onOpenSsh,
}) => {
  const { toast } = useToast();
  const { armed, lat, lon, hasGps } = extractTelemetryMetrics(telemetry);
  const isAllSelected = activeDroneId === 'all';

  const copyCoords = () => {
    if (hasGps) {
      navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lon.toFixed(6)}`)
        .then(() => toast.success(`Đã sao chép tọa độ GPS: ${lat.toFixed(6)}, ${lon.toFixed(6)}`, 'GPS Copied'))
        .catch(() => { });
    }
  };

  return (
    <div className="w-full bg-titanium-50/90 dark:bg-obsidian-900/90 backdrop-blur-md rounded-xl border border-titanium-300 dark:border-obsidian-800 p-3 shadow-sm flex flex-wrap items-center justify-between gap-3 transition-colors">

      {/* Target Device Status Tag */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-tactical-blue/10 dark:bg-tactical-cyan/10 text-tactical-blue dark:text-tactical-cyan">
          <Crosshair className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span
              title={isAllSelected ? 'TOÀN BỘ PHI ĐỘI' : activeDroneId}
              className="font-mono font-bold text-xs text-slate-900 dark:text-white max-w-[150px] sm:max-w-[220px] md:max-w-[300px] truncate"
            >
              {isAllSelected ? 'TOÀN BỘ PHI ĐỘI' : activeDroneId}
            </span>
            {isAllSelected ? (
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" />
                <span>CHẾ ĐỘ GIÁM SÁT</span>
              </span>
            ) : (
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                armed
                  ? 'bg-tactical-emerald/20 text-emerald-700 dark:text-tactical-emerald border border-tactical-emerald/30'
                  : 'bg-tactical-amber/20 text-amber-700 dark:text-tactical-amber border border-tactical-amber/30'
              }`}>
                {armed ? 'ARMED' : 'DISARMED'}
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono text-slate-600 dark:text-slate-400 mt-0.5">
            {isAllSelected ? (
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                Chọn 1 drone cụ thể trên thanh mục tiêu để mở khóa lệnh bay
              </span>
            ) : hasGps ? (
              <button
                type="button"
                className="hover:underline flex items-center gap-1 cursor-pointer focus-visible:ring-1 focus-visible:ring-tactical-cyan focus-visible:outline-none rounded"
                onClick={copyCoords}
                title="Click để sao chép tọa độ"
              >
                <span>GPS: {lat.toFixed(5)}, {lon.toFixed(5)}</span>
                <Copy className="w-2.5 h-2.5 opacity-60" />
              </button>
            ) : (
              'Chưa có tọa độ GPS Lock'
            )}
          </div>
        </div>
      </div>

      {/* Quick Action Trigger Buttons */}
      <div className="flex flex-wrap items-center gap-2">

        {/* Arm / Disarm */}
        <button
          type="button"
          disabled={isAllSelected}
          onClick={() => onSendCommand(armed ? 'disarm' : 'arm')}
          title={isAllSelected ? 'Vui lòng chọn 1 Drone cụ thể để phát lệnh ARM/DISARM' : (armed ? 'Hạ vũ trang (Yêu cầu xác nhận an toàn)' : 'Kích hoạt động cơ (Yêu cầu xác nhận an toàn)')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none ${
            isAllSelected
              ? 'opacity-40 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-500 border border-slate-300 dark:border-slate-700'
              : armed
              ? 'bg-tactical-amber/10 hover:bg-tactical-amber/20 text-amber-700 dark:text-tactical-amber border border-tactical-amber/40 cursor-pointer shadow-sm'
              : 'bg-tactical-emerald/10 hover:bg-tactical-emerald/20 text-emerald-700 dark:text-tactical-emerald border border-tactical-emerald/40 cursor-pointer shadow-sm'
          }`}
        >
          {armed ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
          <span>{armed ? 'HẠ VŨ TRANG' : 'VŨ TRANG (ARM)'}</span>
        </button>

        {/* Takeoff */}
        <button
          type="button"
          disabled={isAllSelected}
          onClick={() => onSendCommand('takeoff')}
          title={isAllSelected ? 'Vui lòng chọn 1 Drone cụ thể để phát lệnh Cất cánh' : 'Phát lệnh cất cánh tự động lên 10m'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none ${
            isAllSelected
              ? 'opacity-40 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-500 border border-slate-300 dark:border-slate-700'
              : 'bg-tactical-blue/10 hover:bg-tactical-blue/20 text-tactical-blue dark:bg-tactical-cyan/10 dark:hover:bg-tactical-cyan/20 dark:text-tactical-cyan border border-tactical-blue/40 dark:border-tactical-cyan/40 cursor-pointer shadow-sm'
          }`}
        >
          <ArrowUpCircle className="w-4 h-4" />
          <span>CẤT CÁNH (10M)</span>
        </button>

        {/* Land */}
        <button
          type="button"
          disabled={isAllSelected}
          onClick={() => onSendCommand('land')}
          title={isAllSelected ? 'Vui lòng chọn 1 Drone cụ thể để phát lệnh Hạ cánh' : 'Hạ cánh khẩn cấp tại vị trí hiện tại'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none ${
            isAllSelected
              ? 'opacity-40 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-500 border border-slate-300 dark:border-slate-700'
              : 'bg-slate-200/80 hover:bg-slate-300/80 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 cursor-pointer shadow-sm'
          }`}
        >
          <ArrowDownCircle className="w-4 h-4" />
          <span>HẠ CÁNH (LAND)</span>
        </button>

        {/* RTL (Return to Launch) */}
        <button
          type="button"
          disabled={isAllSelected}
          onClick={() => onSendCommand('rtl')}
          title={isAllSelected ? 'Vui lòng chọn 1 Drone cụ thể để phát lệnh Bay về Home' : 'Quay về điểm xuất phát (Return-to-Launch)'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none ${
            isAllSelected
              ? 'opacity-40 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-500 border border-slate-300 dark:border-slate-700'
              : 'bg-tactical-red/10 hover:bg-tactical-red/20 text-tactical-red border border-tactical-red/40 cursor-pointer shadow-sm'
          }`}
        >
          <Send className="w-4 h-4" />
          <span>QUAY VỀ (RTL)</span>
        </button>

        {/* Web SSH Console - Always accessible */}
        <button
          type="button"
          onClick={onOpenSsh}
          title="Mở bảng điều khiển Web SSH Terminal trực tiếp tới Drone qua WireGuard"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-800 text-tactical-cyan border border-slate-700 transition-all cursor-pointer shadow-sm focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none"
        >
          <Terminal className="w-4 h-4" />
          <span>WEB SSH</span>
        </button>

      </div>

    </div>
  );
};
