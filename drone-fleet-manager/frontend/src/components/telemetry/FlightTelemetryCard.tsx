import React, { useState } from 'react';
import {
  Gauge,
  Compass,
  Battery,
  BatteryCharging,
  Navigation,
  Crosshair,
  Activity,
  MapPin,
  Copy,
  Check,
  Radio,
  Satellite,
  ShieldCheck,
  ShieldAlert,
  Plane,
  X,
  Zap
} from 'lucide-react';
import { DroneDevice, DroneTelemetry } from '../../types';
import { isDroneOnline } from '../../hooks/useTelemetry';
import { extractTelemetryMetrics } from '../../utils/telemetry';

interface FlightTelemetryCardProps {
  activeDroneId: string;
  devices: DroneDevice[];
  onSelectDrone: (id: string) => void;
  telemetry?: DroneTelemetry;
  onClose?: () => void;
}

// Convert degrees to Vietnamese Cardinal Direction
const getCompassDirection = (deg: number): string => {
  const normalized = ((deg % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return 'BẮC';
  if (normalized >= 22.5 && normalized < 67.5) return 'ĐÔNG BẮC';
  if (normalized >= 67.5 && normalized < 112.5) return 'ĐÔNG';
  if (normalized >= 112.5 && normalized < 157.5) return 'ĐÔNG NAM';
  if (normalized >= 157.5 && normalized < 202.5) return 'NAM';
  if (normalized >= 202.5 && normalized < 247.5) return 'TÂY NAM';
  if (normalized >= 247.5 && normalized < 292.5) return 'TÂY';
  return 'TÂY BẮC';
};

export const FlightTelemetryCard: React.FC<FlightTelemetryCardProps> = ({
  activeDroneId,
  devices,
  onSelectDrone,
  telemetry,
  onClose,
}) => {
  const [copiedGps, setCopiedGps] = useState(false);

  const targetDevice = devices.find((d) => d.deviceId === activeDroneId) || devices[0];
  const devId = activeDroneId !== 'all' ? activeDroneId : targetDevice?.deviceId || 'CHƯA CHỌN';
  const online = isDroneOnline(telemetry);

  // Flight values extraction using centralized normalizer
  const {
    pitch,
    roll,
    heading,
    altitude: relAlt,
    groundSpeed,
    batteryPct: batPct,
    batteryVoltageStr: batVolt,
    flightMode,
    armed: isArmed,
    lat,
    lon,
    sats,
  } = extractTelemetryMetrics(telemetry, online);

  const altRel = relAlt;
  const speed = groundSpeed;
  const batteryPct = batPct;
  const voltage = batVolt ? parseFloat(batVolt) || 0 : 0;
  const deviceId = devId;
  const armed = isArmed;
  const altMsl = relAlt > 0 ? relAlt + 12.5 : 0;

  const handleCopyGps = () => {
    const coordStr = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    navigator.clipboard.writeText(coordStr);
    setCopiedGps(true);
    setTimeout(() => setCopiedGps(false), 2000);
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#F4F1EA]/90 dark:bg-obsidian-900/90 backdrop-blur-md border border-slate-300/80 dark:border-slate-800 rounded-2xl shadow-lg overflow-hidden transition-colors">

      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-300/80 dark:border-slate-800/80 bg-slate-100/70 dark:bg-obsidian-950/60">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-tactical-blue/10 dark:bg-tactical-cyan/10 text-tactical-blue dark:text-tactical-cyan">
            <Gauge className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-900 dark:text-white font-sans flex items-center gap-1.5">
              <span>GIÁM SÁT BAY TỨC THỜI</span>
              {online ? (
                <span className="w-2 h-2 rounded-full bg-tactical-emerald animate-pulse" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-slate-400" />
              )}
            </h3>
            <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
              Real-time PFD & Attitude Director
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onClose && (
            <button
              onClick={onClose}
              title="Thu gọn khung giám sát"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Content Deck */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-mono">

        {/* 1. ARTIFICIAL HORIZON 3D SPHERE (Attitude Director Indicator) */}
        <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-100/80 dark:bg-obsidian-950/80 border border-slate-200/80 dark:border-slate-800 shadow-inner">
          <div className="relative w-32 h-32 rounded-full overflow-hidden border-2 border-tactical-blue/40 dark:border-tactical-cyan/40 shadow-[0_0_15px_rgba(0,229,255,0.15)] bg-slate-950 select-none">

            {/* Dynamic Sky / Earth Sphere */}
            <div
              className="absolute w-[220%] h-[220%] -left-[60%] -top-[60%] transition-transform duration-100 ease-linear"
              style={{
                background: 'linear-gradient(to bottom, #0284c7 0%, #0284c7 50%, #92400e 50%, #78350f 100%)',
                transform: `rotate(${-roll}deg) translateY(${pitch * 1.4}px)`,
              }}
            >
              {/* Center White Horizon Level Line */}
              <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-white -translate-y-1/2 shadow-sm" />

              {/* Pitch Ladder Marks */}
              <div className="absolute top-[35%] left-1/2 -translate-x-1/2 w-14 h-[1px] bg-white/60 flex justify-between text-[8px] text-white/90 px-1 font-mono">
                <span>+10</span>
                <span>+10</span>
              </div>
              <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-8 h-[1px] bg-white/40 flex justify-between text-[7px] text-white/70 px-0.5 font-mono">
                <span>+20</span>
                <span>+20</span>
              </div>
              <div className="absolute top-[65%] left-1/2 -translate-x-1/2 w-14 h-[1px] bg-white/60 flex justify-between text-[8px] text-white/90 px-1 font-mono">
                <span>-10</span>
                <span>-10</span>
              </div>
              <div className="absolute top-[80%] left-1/2 -translate-x-1/2 w-8 h-[1px] bg-white/40 flex justify-between text-[7px] text-white/70 px-0.5 font-mono">
                <span>-20</span>
                <span>-20</span>
              </div>
            </div>

            {/* Static Aircraft Reticle Crosshair (Yellow Wings & Center Dot) */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="absolute left-3.5 w-6 h-[2.5px] bg-amber-400 rounded-sm shadow-[0_0_6px_#fbbf24]" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-500 shadow-[0_0_8px_#fbbf24]" />
              <div className="absolute right-3.5 w-6 h-[2.5px] bg-amber-400 rounded-sm shadow-[0_0_6px_#fbbf24]" />
            </div>

            {/* Top Zero Roll Notch Pointer */}
            <div className="absolute top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-amber-400 pointer-events-none" />
          </div>

          {/* Roll & Pitch Digital Badges */}
          <div className="flex items-center gap-3 mt-2 text-[11px] font-mono">
            <span className="text-slate-500 dark:text-slate-400">
              ROLL: <b className="text-slate-800 dark:text-white">{roll >= 0 ? `+${roll.toFixed(1)}` : roll.toFixed(1)}°</b>
            </span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span className="text-slate-500 dark:text-slate-400">
              PITCH: <b className="text-slate-800 dark:text-white">{pitch >= 0 ? `+${pitch.toFixed(1)}` : pitch.toFixed(1)}°</b>
            </span>
          </div>
        </div>

        {/* 2. Key Metrics Grid (Altitude, Speed, Battery, Mode) */}
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">

          {/* Altitude */}
          <div className="p-2.5 rounded-xl bg-slate-100/80 dark:bg-obsidian-950/80 border border-slate-300/70 dark:border-slate-800/80 flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-500/10 text-sky-500">
              <Navigation className="w-4 h-4" />
            </div>
            <div>
              <span className="block text-[10px] text-slate-400 font-sans">Độ cao tương đối</span>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {online ? `${altRel.toFixed(1)} m` : '-- m'}
              </span>
            </div>
          </div>

          {/* Ground Speed */}
          <div className="p-2.5 rounded-xl bg-slate-100/80 dark:bg-obsidian-950/80 border border-slate-300/70 dark:border-slate-800/80 flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <span className="block text-[10px] text-slate-400 font-sans">Tốc độ mặt đất</span>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {online ? `${speed.toFixed(1)} m/s` : '-- m/s'}
              </span>
            </div>
          </div>

          {/* Battery */}
          <div className="p-2.5 rounded-xl bg-slate-100/80 dark:bg-obsidian-950/80 border border-slate-300/70 dark:border-slate-800/80 flex items-center gap-2.5">
            <div className={`p-2 rounded-lg ${batteryPct > 50 ? 'bg-emerald-500/10 text-emerald-500' : batteryPct > 20 ? 'bg-amber-500/10 text-amber-500' : 'bg-rose-500/10 text-rose-500'}`}>
              <Battery className="w-4 h-4" />
            </div>
            <div>
              <span className="block text-[10px] text-slate-400 font-sans">Dung lượng Pin</span>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {online ? `${batteryPct}%` : '--%'}
                {voltage > 0 && <span className="text-[10px] text-slate-400 font-normal ml-1">({voltage.toFixed(1)}V)</span>}
              </span>
            </div>
          </div>

          {/* Flight Mode */}
          <div className="p-2.5 rounded-xl bg-slate-100/80 dark:bg-obsidian-950/80 border border-slate-300/70 dark:border-slate-800/80 flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <span className="block text-[10px] text-slate-400 font-sans">Chế độ bay</span>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase">
                {online ? flightMode : 'UNKNOWN'}
              </span>
            </div>
          </div>

        </div>

        {/* 3. Detailed Telemetry Table */}
        <div className="rounded-xl border border-slate-300/70 dark:border-slate-800/80 overflow-hidden text-xs font-mono">
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            <div className="flex justify-between items-center px-3 py-2 bg-slate-50/50 dark:bg-obsidian-950/40">
              <span className="text-slate-400 font-sans">Drone ID</span>
              <span className="font-bold text-tactical-blue dark:text-tactical-cyan">{deviceId || 'CHƯA CHỌN'}</span>
            </div>
            <div className="flex justify-between items-center px-3 py-2">
              <span className="text-slate-400 font-sans">Chế độ bay (Flight Mode)</span>
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {online ? flightMode : '--'}
              </span>
            </div>
            <div className="flex justify-between items-center px-3 py-2 bg-slate-50/50 dark:bg-obsidian-950/40">
              <span className="text-slate-400 font-sans">Trạng thái Arm</span>
              <span className={`flex items-center gap-1 font-bold ${online && armed ? 'text-tactical-emerald' : 'text-slate-400'}`}>
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>{online ? (armed ? 'ARMED (SẴN SÀNG BAY)' : 'DISARMED') : 'OFFLINE'}</span>
              </span>
            </div>
            <div className="flex justify-between items-center px-3 py-2">
              <span className="text-slate-400 font-sans">Dung lượng Pin</span>
              <span className={`font-bold ${batteryPct > 50 ? 'text-tactical-emerald' : batteryPct > 20 ? 'text-amber-500' : 'text-rose-500'}`}>
                {online ? `${batteryPct}% (${voltage.toFixed(1)}V)` : '--%'}
              </span>
            </div>
            <div className="flex justify-between items-center px-3 py-2 bg-slate-50/50 dark:bg-obsidian-950/40">
              <span className="text-slate-400 font-sans">Độ cao tương đối</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {online ? `${altRel.toFixed(1)} m` : '-- m'}
              </span>
            </div>
            <div className="flex justify-between items-center px-3 py-2">
              <span className="text-slate-400 font-sans">Độ cao tuyệt đối (MSL)</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {online ? `${altMsl.toFixed(1)} m` : '-- m'}
              </span>
            </div>
            <div className="flex justify-between items-center px-3 py-2 bg-slate-50/50 dark:bg-obsidian-950/40">
              <span className="text-slate-400 font-sans">Vận tốc mặt đất</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {online ? `${speed.toFixed(1)} m/s (${(speed * 3.6).toFixed(1)} km/h)` : '-- m/s'}
              </span>
            </div>
            <div className="flex justify-between items-center px-3 py-2">
              <span className="text-slate-400 font-sans">Góc la bàn (Heading)</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {online ? `${heading.toFixed(0)}°` : '--°'}
              </span>
            </div>
          </div>
        </div>

        {/* 4. GPS Coordinates Box */}
        <div className="p-3 rounded-xl bg-slate-100/80 dark:bg-obsidian-950/80 border border-slate-300/70 dark:border-slate-800/80 flex flex-col gap-2 font-mono">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-tactical-blue dark:text-tactical-cyan" />
              Tọa độ GPS Lock
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-tactical-blue/10 dark:bg-tactical-cyan/10 text-tactical-blue dark:text-tactical-cyan font-bold">
              {online ? `${sats} SAT` : '-- SAT'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded-lg bg-[#F4F1EA] dark:bg-obsidian-950 border border-slate-300/80 dark:border-slate-800">
              <span className="block text-[10px] text-slate-400 font-sans">Vĩ độ (Lat)</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {online && lat !== 0 ? lat.toFixed(6) : '21.028500'}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-[#F4F1EA] dark:bg-obsidian-950 border border-slate-300/80 dark:border-slate-800">
              <span className="block text-[10px] text-slate-400 font-sans">Kinh độ (Lon)</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {online && lon !== 0 ? lon.toFixed(6) : '105.854200'}
              </span>
            </div>
          </div>

          {/* 1-Click Copy GPS Button */}
          <button
            type="button"
            onClick={handleCopyGps}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-slate-200/80 hover:bg-slate-300/80 dark:bg-slate-800/80 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 text-[11px] font-sans font-medium transition-colors cursor-pointer"
          >
            {copiedGps ? (
              <>
                <Check className="w-3.5 h-3.5 text-tactical-emerald" />
                <span className="text-tactical-emerald font-bold">Đã sao chép tọa độ!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Sao chép tọa độ GPS</span>
              </>
            )}
          </button>
        </div>

      </div>

    </div>
  );
};

