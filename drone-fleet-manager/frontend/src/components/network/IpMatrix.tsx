import React, { useState, useEffect, useMemo } from 'react';
import {
  Network,
  Radio,
  Wifi,
  WifiOff,
  Server,
  Shield,
  ExternalLink,
  Terminal,
  RefreshCw,
  Info
} from 'lucide-react';
import { DroneDevice, DroneTelemetry } from '../../types';
import { isDroneOnline } from '../../hooks/useTelemetry';
import { fetchIpPoolMatrix } from '../../services/api';

interface IpCellData {
  hostNumber: number;
  ip: string;
  status: 'gateway' | 'active-online' | 'active-offline' | 'available';
  deviceId?: string;
  hardwareModel?: string;
  isOnline?: boolean;
}

interface IpMatrixProps {
  devices: DroneDevice[];
  telemetrySnapshot: Record<string, DroneTelemetry>;
  activeDroneId?: string;
  onSelectDrone?: (id: string) => void;
  onOpenSsh?: (deviceId: string) => void;
}

export const IpMatrix: React.FC<IpMatrixProps> = ({
  devices,
  telemetrySnapshot,
  activeDroneId,
  onSelectDrone,
  onOpenSsh,
}) => {
  const [serverCells, setServerCells] = useState<any[]>([]);
  const [hoveredCell, setHoveredCell] = useState<IpCellData | null>(null);
  const [selectedCell, setSelectedCell] = useState<IpCellData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadMatrix = async () => {
    setIsLoading(true);
    try {
      const data = await fetchIpPoolMatrix();
      if (Array.isArray(data) && data.length > 0) {
        setServerCells(data);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMatrix();
  }, []);

  // Compute 254 cells by merging server data with live local devices and telemetry
  const cells: IpCellData[] = useMemo(() => {
    return Array.from({ length: 254 }, (_, idx) => {
      const hostNumber = idx + 1;
      const ip = `10.13.37.${hostNumber}`;

      if (hostNumber === 1) {
        return {
          hostNumber,
          ip,
          status: 'gateway',
          isOnline: true,
        };
      }

      // Check against local devices list
      const dev = devices.find(
        (d) => d.vpnIp === ip || d.deviceId === `DRONE-SIM-000${hostNumber}` || d.deviceId.endsWith(`-${hostNumber}`)
      );

      // Check against server pool data if available
      const serverItem = serverCells.find((s) => s.hostNumber === hostNumber || s.ip === ip);

      const deviceId = dev?.deviceId || serverItem?.deviceId;
      const hardwareModel = dev?.hardwareModel || serverItem?.hardwareModel;

      if (deviceId || serverItem?.status === 'active') {
        const t = deviceId ? telemetrySnapshot[deviceId] || dev?.telemetry : undefined;
        const online = dev && t ? isDroneOnline(t) : !!serverItem?.isOnline;

        return {
          hostNumber,
          ip,
          status: online ? 'active-online' : 'active-offline',
          deviceId: deviceId || 'ALLOCATED-DEVICE',
          hardwareModel,
          isOnline: online,
        };
      }

      return {
        hostNumber,
        ip,
        status: 'available',
        isOnline: false,
      };
    });
  }, [devices, telemetrySnapshot, serverCells]);

  // Statistics
  const stats = useMemo(() => {
    let onlineCount = 0;
    let offlineCount = 0;
    let availableCount = 0;

    cells.forEach((c) => {
      if (c.status === 'active-online') onlineCount++;
      else if (c.status === 'active-offline') offlineCount++;
      else if (c.status === 'available') availableCount++;
    });

    return {
      total: 254,
      gateway: 1,
      online: onlineCount,
      offline: offlineCount,
      available: availableCount,
    };
  }, [cells]);

  const activeInfo = hoveredCell || selectedCell;

  return (
    <div className="w-full bg-[#F4F1EA]/90 dark:bg-obsidian-900/90 backdrop-blur-md rounded-2xl border border-slate-300/80 dark:border-slate-800 p-4 sm:p-5 shadow-sm select-none transition-colors">

      {/* Header & Description */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-300/80 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-tactical-blue/10 dark:bg-tactical-cyan/10 text-tactical-blue dark:text-tactical-cyan">
              <Network className="w-4 h-4" />
            </div>
            <h3 className="font-extrabold text-sm uppercase tracking-wider text-slate-900 dark:text-white font-sans">
              MA TRẬN CẤP PHÁT ĐỊA CHỈ IP SUBNET (10.13.37.0/24)
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-sans">
            Mỗi ô đại diện cho 1 IP trong dải VPN <code className="text-tactical-blue dark:text-tactical-cyan font-mono">10.13.37.1</code> – <code className="text-tactical-blue dark:text-tactical-cyan font-mono">10.13.37.254</code>. Di chuột vào ô để xem thông tin chi tiết.
          </p>
        </div>

        {/* Refresh Button */}
        <button
          type="button"
          onClick={loadMatrix}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-mono font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>LÀM MỚI POOL</span>
        </button>
      </div>

      {/* Legend & Stats Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 py-3 text-xs font-sans border-b border-slate-200/70 dark:border-slate-800/70">

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-slate-700 dark:text-slate-300 text-xs font-medium">
          {/* Gateway */}
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded bg-tactical-blue/25 border-2 border-tactical-blue dark:border-tactical-cyan dark:bg-tactical-cyan/25" />
            <span>Gateway (10.13.37.1)</span>
          </div>

          {/* Online */}
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded bg-tactical-emerald/25 border-2 border-tactical-emerald shadow-[0_0_6px_rgba(16,185,129,0.4)]" />
            <span className="font-semibold text-tactical-emerald">Đang Bay (Live GPS)</span>
          </div>

          {/* Offline */}
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded bg-amber-500/20 border-2 border-amber-500" />
            <span className="text-amber-600 dark:text-amber-400">Đã Cấp (Offline)</span>
          </div>

          {/* Available */}
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 opacity-60" />
            <span className="text-slate-400">Chưa Sử Dụng</span>
          </div>
        </div>

        {/* Stats Counts */}
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="px-2 py-0.5 rounded bg-tactical-emerald/10 text-tactical-emerald font-bold border border-tactical-emerald/30">
            {stats.online} LIVE
          </span>
          <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 font-bold border border-amber-500/30">
            {stats.offline} OFFLINE
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold border border-slate-200 dark:border-slate-700">
            {stats.available} TRỐNG
          </span>
        </div>

      </div>

      {/* 254 IP Cells Grid */}
      <div className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(46px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(54px,1fr))] gap-1.5 p-2 bg-slate-50/60 dark:bg-obsidian-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800/80 max-h-[380px] overflow-y-auto">
        {cells.map((c) => {
          let styleClasses = '';

          if (c.status === 'gateway') {
            styleClasses = 'bg-tactical-blue/20 border-2 border-tactical-blue text-tactical-blue dark:bg-tactical-cyan/20 dark:border-tactical-cyan dark:text-tactical-cyan font-bold shadow-sm';
          } else if (c.status === 'active-online') {
            styleClasses = 'bg-tactical-emerald/20 border-2 border-tactical-emerald text-tactical-emerald dark:text-emerald-300 font-bold shadow-[0_0_8px_rgba(16,185,129,0.3)] animate-pulse';
          } else if (c.status === 'active-offline') {
            styleClasses = 'bg-amber-500/15 border-2 border-amber-500/80 text-amber-600 dark:text-amber-400 font-bold';
          } else {
            styleClasses = 'bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 opacity-40 hover:opacity-100';
          }

          const isSelected = activeDroneId && c.deviceId === activeDroneId;

          return (
            <button
              key={c.hostNumber}
              type="button"
              onMouseEnter={() => setHoveredCell(c)}
              onMouseLeave={() => setHoveredCell(null)}
              onClick={() => {
                setSelectedCell(c);
                if (c.deviceId && onSelectDrone) {
                  onSelectDrone(c.deviceId);
                }
              }}
              title={`IP: ${c.ip}${c.deviceId ? ` (${c.deviceId})` : ''} - ${c.status}`}
              className={`h-9 flex items-center justify-center rounded-lg font-mono text-xs transition-all cursor-pointer ${styleClasses} ${isSelected ? 'ring-2 ring-tactical-cyan ring-offset-1 dark:ring-offset-obsidian-950 scale-105' : 'hover:scale-110 hover:z-10'
                }`}
            >
              .{c.hostNumber}
            </button>
          );
        })}
      </div>

      {/* Interactive Detail Popover Bar */}
      <div className="mt-3 p-3 rounded-xl bg-slate-200/60 dark:bg-obsidian-950/80 border border-slate-300 dark:border-slate-800 text-xs font-mono flex flex-wrap items-center justify-between gap-3">
        {activeInfo ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400 font-sans">Địa chỉ IP:</span>
              <span className="font-bold text-slate-900 dark:text-white bg-[#F4F1EA] dark:bg-obsidian-950 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700">
                {activeInfo.ip}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-sans">Trạng thái:</span>
              {activeInfo.status === 'gateway' && (
                <span className="px-2 py-0.5 rounded bg-tactical-blue/15 text-tactical-blue dark:text-tactical-cyan font-bold">
                  WIREGUARD GATEWAY HOST
                </span>
              )}
              {activeInfo.status === 'active-online' && (
                <span className="flex items-center gap-1 text-tactical-emerald font-bold">
                  <span className="w-2 h-2 rounded-full bg-tactical-emerald animate-ping" />
                  <span>ĐANG BAY (LIVE TELEMETRY)</span>
                </span>
              )}
              {activeInfo.status === 'active-offline' && (
                <span className="text-amber-500 font-bold">
                  ĐÃ CẤP IP (OFFLINE)
                </span>
              )}
              {activeInfo.status === 'available' && (
                <span className="text-slate-400">
                  CHƯA SỬ DỤNG (SẴN SÀNG CẤP PHÁT)
                </span>
              )}
            </div>

            {activeInfo.deviceId && (
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-sans">Mã Drone:</span>
                <span className="font-bold text-tactical-blue dark:text-tactical-cyan">
                  {activeInfo.deviceId}
                </span>
              </div>
            )}

            {activeInfo.hardwareModel && (
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-sans">SBC:</span>
                <span className="text-slate-600 dark:text-slate-300">
                  {activeInfo.hardwareModel}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-400 font-sans text-xs">
            <Info className="w-4 h-4 text-slate-400 shrink-0" />
            <span>Rê chuột hoặc nhấp vào bất kỳ ô số nào trên ma trận để xem trạng thái chi tiết của IP đó.</span>
          </div>
        )}

        {/* Quick Action when a Drone is selected */}
        {activeInfo?.deviceId && onOpenSsh && (
          <button
            type="button"
            onClick={() => onOpenSsh(activeInfo.deviceId!)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-tactical-blue hover:bg-tactical-blue/90 text-white font-sans font-semibold text-xs transition-colors cursor-pointer shadow-sm ml-auto"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Mở Web SSH ({activeInfo.deviceId})</span>
          </button>
        )}
      </div>

    </div>
  );
};

