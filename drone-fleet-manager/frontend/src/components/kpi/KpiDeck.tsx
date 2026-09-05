import React from 'react';
import {
  Plane,
  Activity,
  Network,
  BatteryCharging,
  ShieldCheck,
  Cpu,
  Signal,
  Navigation
} from 'lucide-react';
import { DashboardStats, DroneDevice, DroneTelemetry } from '../../types';
import { isDroneOnline } from '../../hooks/useTelemetry';

interface KpiDeckProps {
  stats: DashboardStats | null;
  devices: DroneDevice[];
  telemetrySnapshot: Record<string, DroneTelemetry>;
}

export const KpiDeck: React.FC<KpiDeckProps> = ({ stats, devices, telemetrySnapshot }) => {
  const totalDrones = devices.length || stats?.devices?.total || 0;

  // Đếm drone online
  const onlineDrones = devices.filter((d) => {
    const t = telemetrySnapshot[d.deviceId] || d.telemetry;
    return isDroneOnline(t);
  }).length;

  // Đếm drone đang vũ trang / bay (Armed)
  const armedDrones = devices.filter((d) => {
    const t = telemetrySnapshot[d.deviceId] || d.telemetry;
    return isDroneOnline(t) && t?.armed;
  }).length;

  // Tính trung bình pin các drone online
  const onlineWithBattery = devices
    .map((d) => telemetrySnapshot[d.deviceId]?.battery?.percentage ?? d.telemetry?.battery?.percentage)
    .filter((p): p is number => typeof p === 'number' && p >= 0);

  const avgBattery = onlineWithBattery.length
    ? Math.round(onlineWithBattery.reduce((a, b) => a + b, 0) / onlineWithBattery.length)
    : 100;

  // IP Pool
  const ipUsed = stats?.ipPool?.usedCount || devices.length;
  const ipCapacity = stats?.ipPool?.totalCapacity || 253;
  const ipPercent = stats?.ipPool?.utilizationPercentage || Math.round((ipUsed / ipCapacity) * 100);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

      {/* 1. Tổng phi đội */}
      <div className="relative overflow-hidden rounded-xl bg-[#F4F1EA]/85 dark:bg-obsidian-900/85 backdrop-blur-md p-3.5 border border-slate-300/70 dark:border-slate-800/80 shadow-sm transition-all hover:border-tactical-blue/40 dark:hover:border-tactical-cyan/40">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Tổng Phi Đội
          </span>
          <div className="p-1.5 rounded-lg bg-tactical-blue/10 dark:bg-tactical-cyan/10 text-tactical-blue dark:text-tactical-cyan">
            <Plane className="w-4 h-4" />
          </div>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
            {totalDrones}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            {stats?.devices?.active || totalDrones} Sẵn sàng
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[10px] font-mono text-slate-500 dark:text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-tactical-blue dark:bg-tactical-cyan" />
          <span>WireGuard Fleet Active</span>
        </div>
      </div>

      {/* 2. Đang bay & Trực tuyến */}
      <div className="relative overflow-hidden rounded-xl bg-[#F4F1EA]/85 dark:bg-obsidian-900/85 backdrop-blur-md p-3.5 border border-slate-300/70 dark:border-slate-800/80 shadow-sm transition-all hover:border-tactical-emerald/40">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Live Telemetry
          </span>
          <div className="p-1.5 rounded-lg bg-tactical-emerald/10 text-tactical-emerald">
            <Activity className="w-4 h-4" />
          </div>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono text-tactical-emerald tabular-nums">
            {onlineDrones}
          </span>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            / {totalDrones} Online
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] font-mono">
          <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <span className={`w-1.5 h-1.5 rounded-full ${armedDrones > 0 ? 'bg-tactical-emerald animate-pulse' : 'bg-slate-400'}`} />
            <span>{armedDrones} Đang vũ trang</span>
          </span>
          <span className="text-tactical-emerald font-semibold">10Hz Stream</span>
        </div>
      </div>

      {/* 3. Mức Pin Trung bình */}
      <div className="relative overflow-hidden rounded-xl bg-[#F4F1EA]/85 dark:bg-obsidian-900/85 backdrop-blur-md p-3.5 border border-slate-300/70 dark:border-slate-800/80 shadow-sm transition-all hover:border-tactical-amber/40">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Pin Phi Đội TB
          </span>
          <div className="p-1.5 rounded-lg bg-tactical-amber/10 text-tactical-amber">
            <BatteryCharging className="w-4 h-4" />
          </div>
        </div>

        <div className="flex items-baseline gap-2">
          <span className={`text-2xl font-bold font-mono tabular-nums ${avgBattery > 50 ? 'text-tactical-emerald' : avgBattery > 25 ? 'text-tactical-amber' : 'text-tactical-red'
            }`}>
            {avgBattery}%
          </span>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            LiPo Fleet Avg
          </span>
        </div>

        {/* Mini progress bar */}
        <div className="mt-2 w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${avgBattery > 50 ? 'bg-tactical-emerald' : avgBattery > 25 ? 'bg-tactical-amber' : 'bg-tactical-red'
              }`}
            style={{ width: `${avgBattery}%` }}
          />
        </div>
      </div>

      {/* 4. Hạ tầng WireGuard VPN IP Pool */}
      <div className="relative overflow-hidden rounded-xl bg-[#F4F1EA]/85 dark:bg-obsidian-900/85 backdrop-blur-md p-3.5 border border-slate-300/70 dark:border-slate-800/80 shadow-sm transition-all hover:border-tactical-blue/40 dark:hover:border-tactical-cyan/40">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            VPN IP Mesh (10.13.37.X)
          </span>
          <div className="p-1.5 rounded-lg bg-tactical-blue/10 dark:bg-tactical-cyan/10 text-tactical-blue dark:text-tactical-cyan">
            <Network className="w-4 h-4" />
          </div>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
            {ipPercent}%
          </span>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {ipUsed}/{ipCapacity} IP
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
          <span>WireGuard Subnet</span>
          <span className="text-tactical-blue dark:text-tactical-cyan font-semibold">256-bit ChaCha</span>
        </div>
      </div>

    </div>
  );
};

