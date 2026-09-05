import React, { useState, useMemo } from 'react';
import {
  Terminal,
  Video,
  ShieldCheck,
  ShieldAlert,
  Search,
  Battery,
  Navigation,
  Radio,
  Crosshair,
  Send,
  Wifi,
  WifiOff,
  Filter,
  Network,
  ArrowRightLeft
} from 'lucide-react';
import { DroneDevice, DroneTelemetry } from '../../types';
import { isDroneOnline } from '../../hooks/useTelemetry';
import { extractTelemetryMetrics } from '../../utils/telemetry';
import { IpMatrix } from '../network/IpMatrix';

interface FleetTableProps {
  devices: DroneDevice[];
  activeDroneId: string;
  onSelectDrone: (id: string) => void;
  telemetrySnapshot: Record<string, DroneTelemetry>;
  onOpenSsh: (deviceId: string) => void;
  onSendCommand: (deviceId: string, cmd: 'arm' | 'disarm' | 'rtl') => void;
  onUnclaimDrone?: (deviceId: string) => void;
}

export const FleetTable: React.FC<FleetTableProps> = ({
  devices,
  activeDroneId,
  onSelectDrone,
  telemetrySnapshot,
  onOpenSsh,
  onSendCommand,
  onUnclaimDrone,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'online' | 'armed' | 'offline'>('all');
  const [viewTab, setViewTab] = useState<'table' | 'ip-matrix'>('table');

  const filteredDevices = useMemo(() => {
    return devices.filter((d) => {
      const devId = d.deviceId.toLowerCase();
      const ip = (d.vpnIp || '').toLowerCase();
      const hw = (d.hardwareModel || '').toLowerCase();
      const query = searchTerm.toLowerCase();

      const matchesQuery = !searchTerm || devId.includes(query) || ip.includes(query) || hw.includes(query);
      if (!matchesQuery) return false;

      const t = telemetrySnapshot[d.deviceId] || d.telemetry;
      const online = isDroneOnline(t);
      const armed = !!t?.armed;

      if (filterMode === 'online') return online;
      if (filterMode === 'offline') return !online;
      if (filterMode === 'armed') return online && armed;

      return true;
    });
  }, [devices, searchTerm, filterMode, telemetrySnapshot]);

  return (
    <div className="w-full bg-[#F4F1EA]/85 dark:bg-obsidian-900/85 backdrop-blur-md rounded-xl border border-slate-300/70 dark:border-slate-800/80 overflow-hidden shadow-sm flex flex-col">

      {/* Table Header Controls */}
      <div className="p-3 border-b border-slate-300/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">

        {/* View Switcher Tabs: Danh Sách Phi Đội vs Ma Trận IP Subnet */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-obsidian-950 p-1 rounded-xl border border-slate-300/70 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setViewTab('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${viewTab === 'table'
              ? 'bg-[#F4F1EA] dark:bg-slate-800 text-tactical-blue dark:text-tactical-cyan shadow-sm font-bold'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>BẢNG PHI ĐỘI ({devices.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setViewTab('ip-matrix')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${viewTab === 'ip-matrix'
              ? 'bg-[#F4F1EA] dark:bg-slate-800 text-tactical-blue dark:text-tactical-cyan shadow-sm font-bold'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>MA TRẬN IP SUBNET (10.13.37.0/24)</span>
          </button>
        </div>

        {/* Search & Filters (Hiển thị khi ở tab Danh Sách) */}
        {viewTab === 'table' && (
          <div className="flex items-center gap-2">
            {/* Filter tabs */}
            <div className="flex items-center bg-slate-100 dark:bg-obsidian-950 p-0.5 rounded-lg border border-slate-300/70 dark:border-slate-800 text-xs">
              {(['all', 'online', 'armed', 'offline'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setFilterMode(mode)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${filterMode === mode
                    ? 'bg-[#F4F1EA] dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm font-semibold'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                >
                  {mode === 'all' && 'Tất cả'}
                  {mode === 'online' && 'Online'}
                  {mode === 'armed' && 'Armed'}
                  {mode === 'offline' && 'Offline'}
                </button>
              ))}
            </div>

            {/* Search Box */}
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 absolute left-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm mã Drone, IP VPN..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1 text-xs rounded-lg bg-slate-100 dark:bg-obsidian-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-tactical-blue dark:focus:border-tactical-cyan w-40 sm:w-56"
              />
            </div>
          </div>
        )}

      </div>

      {/* Content Area: Either Table or IP Matrix */}
      {viewTab === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-obsidian-950/70 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3">Trạng Thái</th>
                <th className="py-2.5 px-3">Mã Thiết Bị (ID)</th>
                <th className="py-2.5 px-3">VPN IP (WireGuard)</th>
                <th className="py-2.5 px-3">Chế Độ Bay</th>
                <th className="py-2.5 px-3">Mức Pin</th>
                <th className="py-2.5 px-3">Độ Cao / Tốc Độ</th>
                <th className="py-2.5 px-3">GPS Tọa Độ</th>
                <th className="py-2.5 px-3 text-right">Thao Tác Tác Chiến</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400 font-sans">
                    Không tìm thấy Drone nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredDevices.map((dev) => {
                  const devId = dev.deviceId;
                  const t = telemetrySnapshot[devId] || dev.telemetry;
                  const online = isDroneOnline(t);
                  const isSelected = activeDroneId === devId;

                  const {
                    altitude: alt,
                    groundSpeed: spd,
                    batteryPct: batPct,
                    flightMode: mode,
                    armed,
                    lat,
                    lon,
                  } = extractTelemetryMetrics(t, online);

                  return (
                    <tr
                      key={devId}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isSelected ? 'bg-tactical-blue/5 dark:bg-tactical-cyan/5' : ''
                        }`}
                    >
                      {/* Status */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full ${online ? 'bg-tactical-emerald animate-pulse' : 'bg-slate-400'
                              }`}
                          />
                          <span
                            className={`text-[11px] font-semibold ${online ? 'text-tactical-emerald' : 'text-slate-400'
                              }`}
                          >
                            {online ? 'ONLINE' : 'OFFLINE'}
                          </span>
                        </div>
                      </td>

                      {/* Device ID */}
                      <td className="py-2.5 px-3 font-bold whitespace-nowrap">
                        <button
                          onClick={() => onSelectDrone(devId)}
                          className="hover:text-tactical-blue dark:hover:text-tactical-cyan transition-colors text-left font-bold"
                        >
                          {devId}
                          {isSelected && (
                            <span className="ml-1.5 text-[9px] px-1 py-0.2 rounded bg-tactical-cyan text-black font-extrabold">
                              FOCUS
                            </span>
                          )}
                        </button>
                        {dev.hardwareModel && (
                          <div className="text-[10px] font-normal text-slate-400 font-sans truncate max-w-[140px]">
                            {dev.hardwareModel}
                          </div>
                        )}
                      </td>

                      {/* VPN IP & WireGuard Traffic */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-mono font-medium text-slate-700 dark:text-slate-200">
                          {dev.vpnIp || '10.13.37.X'}
                        </div>
                        {(dev.transferRx !== undefined || dev.transferTx !== undefined) && (
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5" title="Lưu lượng mạng WireGuard VPN">
                            ⬇️ {((dev.transferRx || 0) / (1024 * 1024)).toFixed(1)} MB / ⬆️ {((dev.transferTx || 0) / (1024 * 1024)).toFixed(1)} MB
                          </div>
                        )}
                      </td>

                      {/* Flight Mode */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${armed
                            ? 'bg-tactical-emerald/15 text-tactical-emerald border border-tactical-emerald/30'
                            : 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                            }`}
                        >
                          {mode}
                        </span>
                      </td>

                      {/* Battery */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-semibold ${online
                              ? batPct > 50
                                ? 'text-tactical-emerald'
                                : batPct > 20
                                  ? 'text-amber-500'
                                  : 'text-tactical-red'
                              : 'text-slate-400'
                              }`}
                          >
                            {online ? `${Math.round(batPct)}%` : '--%'}
                          </span>
                        </div>
                      </td>

                      {/* Alt / Speed */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                        {online ? (
                          <span>
                            {alt.toFixed(1)}m <span className="text-slate-400">/</span> {spd.toFixed(1)}m/s
                          </span>
                        ) : (
                          <span className="text-slate-400">-- / --</span>
                        )}
                      </td>

                      {/* GPS */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-500 dark:text-slate-400 text-[11px]">
                        {online && lat !== 0 ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : '--'}
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {/* Select Drone */}
                          <button
                            onClick={() => onSelectDrone(devId)}
                            title="Chọn làm Drone chính trên Buồng lái"
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                          >
                            <Crosshair className="w-3.5 h-3.5" />
                          </button>

                          {/* FPV Video */}
                          <button
                            onClick={() => onSelectDrone(devId)}
                            title="Xem Live Video FPV Camera"
                            className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors cursor-pointer"
                          >
                            <Video className="w-3.5 h-3.5" />
                          </button>

                          {/* SSH */}
                          <button
                            onClick={() => onOpenSsh(devId)}
                            title="Mở Terminal SSH qua WireGuard"
                            className="p-1.5 rounded-lg bg-tactical-blue/10 text-tactical-blue dark:bg-tactical-cyan/10 dark:text-tactical-cyan hover:bg-tactical-blue/20 dark:hover:bg-tactical-cyan/20 transition-colors cursor-pointer"
                          >
                            <Terminal className="w-3.5 h-3.5" />
                          </button>

                          {/* ARM / DISARM */}
                          <button
                            onClick={() => onSendCommand(devId, armed ? 'disarm' : 'arm')}
                            title={armed ? 'Hạ vũ trang khẩn cấp (DISARM)' : 'Kích hoạt vũ trang (ARM)'}
                            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${armed
                              ? 'bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20'
                              : 'bg-tactical-emerald/10 text-tactical-emerald border-tactical-emerald/30 hover:bg-tactical-emerald/20'
                              }`}
                          >
                            {armed ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                          </button>

                          {/* RTL */}
                          <button
                            onClick={() => onSendCommand(devId, 'rtl')}
                            title="Bay về điểm xuất phát (RTL - Return to Launch)"
                            className="p-1.5 rounded-lg bg-tactical-red/10 text-tactical-red border border-tactical-red/30 hover:bg-tactical-red/20 transition-colors cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>

                          {/* Bàn giao / Trả quyền Drone */}
                          {onUnclaimDrone && (
                            <button
                              onClick={() => onUnclaimDrone(devId)}
                              title="Bàn giao / Trả quyền Drone này"
                              className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-2 sm:p-3">
          <IpMatrix
            devices={devices}
            telemetrySnapshot={telemetrySnapshot}
            activeDroneId={activeDroneId}
            onSelectDrone={onSelectDrone}
            onOpenSsh={onOpenSsh}
          />
        </div>
      )}

    </div>
  );
};
