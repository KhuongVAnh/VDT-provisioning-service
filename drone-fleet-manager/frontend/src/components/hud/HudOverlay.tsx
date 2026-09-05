import React, { useMemo } from 'react';
import {
  Compass,
  ShieldAlert,
  ShieldCheck,
  Battery,
  Navigation,
  Wifi,
  Radio,
  Gauge,
  AlertTriangle
} from 'lucide-react';
import { DroneTelemetry } from '../../types';
import { extractTelemetryMetrics, formatTimeAgo } from '../../utils/telemetry';

interface HudOverlayProps {
  telemetry?: DroneTelemetry;
  activeDroneId: string;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({ telemetry, activeDroneId }) => {
  const isOnline = telemetry?.connected !== false;
  const online = isOnline;

  // Stale detection
  const lastTs = telemetry?.lastReceivedAt || telemetry?.timestamp;
  const now = Date.now();
  const isStale = !isOnline || (lastTs ? (now - lastTs > 2500) : false);
  const timeSinceLastPacket = lastTs ? Math.max(0, Math.round((now - lastTs) / 1000)) : null;

  const {
    pitch,
    roll,
    yaw,
    altitude,
    groundSpeed: speed,
    climbRate,
    batteryPct,
    batteryVoltage,
    flightMode,
    armed,
    sats,
  } = extractTelemetryMetrics(telemetry, isOnline && !isStale);
  const voltage = batteryVoltage ?? 16.8;

  // Heading cardinal string
  const cardinalDirection = useMemo(() => {
    const directions = ['BẮC', 'ĐÔNG BẮC', 'ĐÔNG', 'ĐÔNG NAM', 'NAM', 'TÂY NAM', 'TÂY', 'TÂY BẮC'];
    const idx = Math.round(((yaw % 360) + 360) % 360 / 45) % 8;
    return directions[idx];
  }, [yaw]);

  // Pitch ladder offset: 1 degree pitch = ~3 pixels
  const pitchOffset = Math.max(-100, Math.min(100, pitch * 3));

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden font-mono z-10 flex flex-col justify-between p-3 sm:p-5 text-tactical-cyan">

      {/* 1. TOP BAR: Compass Ribbon & Flight Mode */}
      <div className="flex items-start justify-between">

        {/* Left Flight Mode & Armed Badge */}
        <div className="flex items-center gap-2 bg-slate-950/75 dark:bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg border border-tactical-cyan/40 shadow-md">
          <span className={`flex items-center gap-1 text-xs font-bold ${armed ? 'text-tactical-emerald' : 'text-amber-400'}`}>
            {armed ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            <span>{armed ? 'ARMED' : 'DISARMED'}</span>
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-xs font-bold text-white tracking-wider">
            {flightMode}
          </span>
        </div>

        {/* Center Compass Tape */}
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5 bg-slate-950/75 dark:bg-black/75 backdrop-blur-md px-4 py-1 rounded-lg border border-tactical-cyan/40 shadow-md">
            <Compass className="w-4 h-4 text-tactical-cyan" />
            <span className="text-sm font-bold tabular-nums text-tactical-cyan">
              {Math.round((yaw + 360) % 360).toString().padStart(3, '0')}°
            </span>
            <span className="text-xs font-semibold text-slate-200">
              {cardinalDirection}
            </span>
          </div>

          {/* Compass Ribbon ticks */}
          <div className="relative w-48 h-3 mt-1 overflow-hidden">
            <div
              className="absolute top-0 flex items-center gap-4 transition-transform duration-100 ease-out"
              style={{ transform: `translateX(${-((yaw % 360) / 360) * 120}px)` }}
            >
              {['N', '45', 'E', '135', 'S', '225', 'W', '315', 'N', '45', 'E'].map((deg, i) => (
                <span key={i} className="text-[9px] font-bold text-slate-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                  {deg}
                </span>
              ))}
            </div>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 border-t-2 border-x-2 border-tactical-cyan" />
          </div>
        </div>

        {/* Right GPS & Battery Telemetry */}
        <div className="flex items-center gap-3 bg-slate-950/75 dark:bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg border border-tactical-cyan/40 shadow-md text-xs">
          <div className="flex items-center gap-1 text-slate-200">
            <Navigation className="w-3.5 h-3.5 text-tactical-cyan" />
            <span className="tabular-nums font-bold">{sats} SATS</span>
          </div>
          <span className="text-slate-500">|</span>
          <div className="flex items-center gap-1.5">
            <Battery className="w-4 h-4 text-tactical-emerald" />
            <span className="font-bold tabular-nums text-white">{batteryPct}%</span>
            <span className="text-[10px] text-slate-300">({voltage.toFixed(1)}V)</span>
          </div>
        </div>

      </div>

      {/* 2. STALE / NO TELEMETRY WARNING WATERMARK */}
      {isStale && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-red-950/85 border border-red-500/70 text-red-300 text-xs font-mono backdrop-blur-md shadow-lg animate-pulse motion-reduce:animate-none">
          <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
          <span className="font-bold tracking-wider">MẤT TÍN HIỆU VIỄN TRẮC</span>
          {timeSinceLastPacket !== null && (
            <span className="text-[10px] text-red-200 bg-black/40 px-1.5 py-0.5 rounded border border-red-400/20">
              [{formatTimeAgo(timeSinceLastPacket)}]
            </span>
          )}
        </div>
      )}

      {/* 3. CENTER: Pitch & Roll Horizon Ladder + Reticle */}
      <div className={`relative flex-1 flex items-center justify-center my-4 ${isStale ? 'opacity-40' : ''}`}>

        {/* Pitch / Roll Horizon Ladder (Rotates by Roll & translates by Pitch) */}
        <div
          className="absolute w-64 h-64 flex items-center justify-center transition-transform duration-75 ease-out"
          style={{ transform: `rotate(${-roll}deg)` }}
        >
          {/* Pitch lines */}
          <div
            className="w-full flex flex-col items-center gap-5 transition-transform duration-75 ease-out"
            style={{ transform: `translateY(${pitchOffset}px)` }}
          >
            {/* +20 deg */}
            <div className="w-24 h-0.5 border-t-2 border-dashed border-tactical-cyan/60 flex justify-between text-[9px] -mt-3 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              <span>+20</span><span>+20</span>
            </div>
            {/* +10 deg */}
            <div className="w-32 h-0.5 border-t-2 border-tactical-cyan/80 flex justify-between text-[10px] -mt-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              <span>+10</span><span>+10</span>
            </div>
            {/* 0 deg Horizon line */}
            <div className="w-44 h-0.5 bg-tactical-cyan shadow-glow-cyan shadow-tactical-cyan/50" />
            {/* -10 deg */}
            <div className="w-32 h-0.5 border-b-2 border-tactical-cyan/80 flex justify-between text-[10px] -mt-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              <span>-10</span><span>-10</span>
            </div>
            {/* -20 deg */}
            <div className="w-24 h-0.5 border-b-2 border-dashed border-tactical-cyan/60 flex justify-between text-[9px] -mt-3 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              <span>-20</span><span>-20</span>
            </div>
          </div>
        </div>

        {/* Fixed Aircraft Reticle in Center */}
        <div className="relative z-20 flex items-center justify-center pointer-events-none">
          {/* Center Dot */}
          <div className="w-2 h-2 rounded-full bg-tactical-cyan shadow-glow-cyan shadow-tactical-cyan/80" />
          {/* Left Wing */}
          <div className="w-8 h-0.5 bg-tactical-cyan -ml-10" />
          {/* Right Wing */}
          <div className="w-8 h-0.5 bg-tactical-cyan ml-2" />
        </div>

        {/* Speed Tape (Left vertical ribbon) */}
        <div className="absolute left-2 sm:left-6 flex items-center gap-1 bg-slate-950/75 dark:bg-black/75 backdrop-blur-md p-2 rounded-lg border border-tactical-cyan/40 shadow-md">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-400 uppercase">TỐC ĐỘ</span>
            <span className="text-lg font-bold text-white tabular-nums">
              {online && !isStale ? speed.toFixed(1) : '--'}
            </span>
            <span className="text-[9px] text-tactical-cyan">m/s</span>
          </div>
        </div>

        {/* Altitude Tape (Right vertical ribbon) */}
        <div className="absolute right-2 sm:right-6 flex items-center gap-1 bg-slate-950/75 dark:bg-black/75 backdrop-blur-md p-2 rounded-lg border border-tactical-cyan/40 shadow-md">
          <div className="flex flex-col items-start">
            <span className="text-[10px] text-slate-400 uppercase">ĐỘ CAO</span>
            <span className="text-lg font-bold text-white tabular-nums">
              {online && !isStale ? altitude.toFixed(1) : '--'}
            </span>
            <div className="flex items-center gap-1 text-[9px] text-tactical-cyan">
              <span>m ASL</span>
              <span className="text-slate-400">({climbRate >= 0 ? `+${climbRate.toFixed(1)}` : climbRate.toFixed(1)}m/s)</span>
            </div>
          </div>
        </div>

      </div>

      {/* 4. BOTTOM BAR: Target Info & Attitude Values */}
      <div className="flex items-center justify-between text-xs bg-slate-950/75 dark:bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg border border-tactical-cyan/40 shadow-md">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isStale ? 'bg-amber-400' : 'bg-tactical-cyan animate-pulse'}`} />
          <span className="font-bold text-white tracking-wider">
            {activeDroneId === 'all' ? 'DRONE-001 (DEFAULT)' : activeDroneId}
          </span>
        </div>

        <div className="flex items-center gap-4 font-mono text-[11px]">
          <div>
            <span className="text-slate-400">ROLL: </span>
            <span className="font-bold text-tactical-cyan tabular-nums">{online && !isStale ? `${roll.toFixed(1)}°` : '--°'}</span>
          </div>
          <div>
            <span className="text-slate-400">PITCH: </span>
            <span className="font-bold text-tactical-cyan tabular-nums">{online && !isStale ? `${pitch.toFixed(1)}°` : '--°'}</span>
          </div>
          <div>
            <span className="text-slate-400">YAW: </span>
            <span className="font-bold text-tactical-cyan tabular-nums">{online && !isStale ? `${yaw.toFixed(1)}°` : '--°'}</span>
          </div>
        </div>
      </div>

    </div>
  );
};
