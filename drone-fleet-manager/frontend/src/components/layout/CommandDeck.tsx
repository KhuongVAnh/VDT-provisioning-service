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
  AlertTriangle
} from 'lucide-react';
import { DroneDevice, DroneTelemetry } from '../../types';
import { useToast } from '../../context/ToastContext';

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
  const armed = !!telemetry?.armed;
  const lat = telemetry?.gps?.lat;
  const lon = telemetry?.gps?.lon;

  const copyCoords = () => {
    if (lat && lon) {
      navigator.clipboard.writeText(`${lat}, ${lon}`)
        .then(() => toast.success(`Đã sao chép tọa độ GPS: ${lat.toFixed(6)}, ${lon.toFixed(6)}`, 'GPS Copied'))
        .catch(() => { });
    }
  };

  return (
    <div className="w-full bg-white/80 dark:bg-obsidian-900/80 backdrop-blur-md rounded-xl border border-slate-200/80 dark:border-slate-800/80 p-3 shadow-sm flex flex-wrap items-center justify-between gap-3">

      {/* Target Device Status Tag */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-tactical-blue/10 dark:bg-tactical-cyan/10 text-tactical-blue dark:text-tactical-cyan">
          <Crosshair className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">
              {activeDroneId === 'all' ? 'TOÀN BỘ PHI ĐỘI' : activeDroneId}
            </span>
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${armed
                ? 'bg-tactical-emerald/20 text-tactical-emerald'
                : 'bg-tactical-amber/20 text-tactical-amber'
              }`}>
              {armed ? 'ARMED' : 'DISARMED'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            {lat && lon ? (
              <span className="cursor-pointer hover:underline" onClick={copyCoords} title="Click để sao chép">
                GPS: {lat.toFixed(5)}, {lon.toFixed(5)} <Copy className="w-2.5 h-2.5 inline opacity-60" />
              </span>
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
          onClick={() => onSendCommand(armed ? 'disarm' : 'arm')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${armed
              ? 'bg-tactical-amber/10 hover:bg-tactical-amber/20 text-tactical-amber border border-tactical-amber/40'
              : 'bg-tactical-emerald/10 hover:bg-tactical-emerald/20 text-tactical-emerald border border-tactical-emerald/40'
            }`}
        >
          {armed ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
          <span>{armed ? 'HẠ VŨ TRANG' : 'VŨ TRANG (ARM)'}</span>
        </button>

        {/* Takeoff */}
        <button
          onClick={() => onSendCommand('takeoff')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-tactical-blue/10 hover:bg-tactical-blue/20 text-tactical-blue dark:bg-tactical-cyan/10 dark:hover:bg-tactical-cyan/20 dark:text-tactical-cyan border border-tactical-blue/40 dark:border-tactical-cyan/40 transition-all cursor-pointer"
        >
          <ArrowUpCircle className="w-4 h-4" />
          <span>CẤT CÁNH (10M)</span>
        </button>

        {/* Land */}
        <button
          onClick={() => onSendCommand('land')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 transition-all cursor-pointer"
        >
          <ArrowDownCircle className="w-4 h-4" />
          <span>HẠ CÁNH (LAND)</span>
        </button>

        {/* RTL (Return to Launch) */}
        <button
          onClick={() => onSendCommand('rtl')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-tactical-red/10 hover:bg-tactical-red/20 text-tactical-red border border-tactical-red/40 transition-all cursor-pointer"
        >
          <Send className="w-4 h-4" />
          <span>QUAY VỀ (RTL)</span>
        </button>

        {/* Web SSH */}
        <button
          onClick={onOpenSsh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-800 text-tactical-cyan border border-slate-700 transition-all cursor-pointer"
        >
          <Terminal className="w-4 h-4" />
          <span>WEB SSH</span>
        </button>

      </div>

    </div>
  );
};

