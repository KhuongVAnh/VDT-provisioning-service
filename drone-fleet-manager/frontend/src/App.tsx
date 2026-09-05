import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LayoutMode, DroneDevice, DashboardStats, DroneTelemetry } from './types';
import { useAuth } from './context/AuthContext';
import { useToast } from './context/ToastContext';
import { useSocket } from './hooks/useSocket';
import { useTelemetry, isDroneOnline } from './hooks/useTelemetry';
import { fetchFleetStates, fetchDashboardStats, sendDroneCommand } from './services/api';
import { Header } from './components/layout/Header';
import { KpiDeck } from './components/kpi/KpiDeck';
import { CommandDeck } from './components/layout/CommandDeck';
import { TacticalMap } from './components/map/TacticalMap';
import { FpvPlayer } from './components/video/FpvPlayer';
import { FleetTable } from './components/fleet/FleetTable';
import { WebSshModal } from './components/terminal/WebSshModal';
import { ManualRegisterModal } from './components/fleet/ManualRegisterModal';
import { AuthModal } from './components/auth/AuthModal';
import { FlightTelemetryCard } from './components/telemetry/FlightTelemetryCard';

export const App: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { toast, confirm } = useToast();

  const [devices, setDevices] = useState<DroneDevice[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activeDroneId, setActiveDroneId] = useState<string>('all');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('mode-split');
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(true);

  // Modals state
  const [isSshOpen, setIsSshOpen] = useState(false);
  const [sshTargetDrone, setSshTargetDrone] = useState('');
  const [sshOutput, setSshOutput] = useState<string | null>(null);
  const [sshStatus, setSshStatus] = useState('');
  const [isManualRegisterOpen, setIsManualRegisterOpen] = useState(false);

  // Telemetry Hook
  const {
    handleIncomingTelemetry,
    telemetrySnapshot,
    getLatestTelemetry,
    getFlightTrail
  } = useTelemetry(devices);

  // Socket Hook
  const {
    socket,
    isConnected: isSocketConnected,
    latencyMs,
    emitSshConnect,
    emitSshDisconnect,
    emitSshInput,
    emitSshResize
  } = useSocket(
    (telemetry) => handleIncomingTelemetry(telemetry),
    (data) => setSshOutput(data),
    (status) => setSshStatus(status)
  );

  // Load Initial Data
  const refreshData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const [fleet, kpis] = await Promise.all([
        fetchFleetStates(),
        fetchDashboardStats(),
      ]);
      setDevices(fleet);
      setStats(kpis);
    } catch (e) {
      console.warn('[Dashboard] Data sync error:', e);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 8000);
    return () => clearInterval(interval);
  }, [refreshData]);

  // Keyboard Shortcuts (1: Map, 2: Split, 3: Cockpit, Esc: Close modals)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when user is typing in inputs or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === '1') setLayoutMode('mode-map');
      if (e.key === '2') setLayoutMode('mode-split');
      if (e.key === '3') setLayoutMode('mode-cockpit');
      if (e.key === 'Escape') {
        setIsSshOpen(false);
        setIsManualRegisterOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Drone Command Trigger Handler
  const handleSendCommand = async (cmd: 'arm' | 'disarm' | 'takeoff' | 'land' | 'rtl', targetId?: string) => {
    const target = targetId || (activeDroneId !== 'all' ? activeDroneId : devices[0]?.deviceId);
    if (!target) {
      toast.warning('Vui lòng chọn 1 Drone cụ thể trong phi đội để phát lệnh!', 'Chưa Chọn Mục Tiêu');
      return;
    }

    const confirmConfigs = {
      arm: {
        title: 'KÍCH HOẠT VŨ TRANG (ARM)',
        message: `Xác nhận KÍCH HOẠT VŨ TRANG (ARM) cho drone "${target}"? Động cơ sẽ bắt đầu quay và sẵn sàng bay. Hãy đảm bảo khu vực xung quanh an toàn.`,
        confirmText: 'KÍCH HOẠT ARM',
        variant: 'danger' as const,
      },
      disarm: {
        title: 'HẠ VŨ TRANG (DISARM)',
        message: `Xác nhận HẠ VŨ TRANG (DISARM) cho drone "${target}"? Nguồn điện động cơ sẽ bị ngắt ngay lập tức.`,
        confirmText: 'HẠ VŨ TRANG NGAY',
        variant: 'danger' as const,
      },
      takeoff: {
        title: 'LỆNH CẤT CÁNH (TAKEOFF)',
        message: `Xác nhận phát lệnh CẤT CÁNH tự động (Takeoff 10m) cho drone "${target}"?`,
        confirmText: 'CẤT CÁNH (10M)',
        variant: 'warning' as const,
      },
      land: {
        title: 'HẠ CÁNH KHẨN CẤP (LAND)',
        message: `Xác nhận HẠ CÁNH KHẨN CẤP (LAND) cho drone "${target}"? Máy bay sẽ tự động hạ độ cao và đáp ngay tại vị trí hiện tại.`,
        confirmText: 'HẠ CÁNH NGAY',
        variant: 'danger' as const,
      },
      rtl: {
        title: 'QUAY VỀ ĐIỂM XUẤT PHÁT (RTL)',
        message: `Xác nhận phát lệnh RETURN-TO-LAUNCH (RTL) cho drone "${target}"? Máy bay sẽ bay về điểm xuất phát (Home position).`,
        confirmText: 'BAY VỀ HOME (RTL)',
        variant: 'warning' as const,
      },
    }[cmd];

    const isConfirmed = await confirm(confirmConfigs);
    if (!isConfirmed) return;

    try {
      await sendDroneCommand(target, cmd as any);
      toast.success(`Đã gửi lệnh "${cmd.toUpperCase()}" thành công tới ${target}!`, 'Lệnh Đã Gửi');
      refreshData();
    } catch (err: any) {
      toast.error(`Lỗi khi gửi lệnh: ${err.message}`, 'Lỗi Phát Lệnh');
    }
  };

  // Open SSH Modal for a specific drone
  const handleOpenSsh = (deviceId?: string) => {
    const target = deviceId || (activeDroneId !== 'all' ? activeDroneId : devices[0]?.deviceId || '');
    setSshTargetDrone(target);
    setIsSshOpen(true);
  };

  // Danh sách Drone đang Online dựa theo telemetry thời gian thực
  const onlineDevices = useMemo(() => {
    return devices.filter((d) => {
      const t = telemetrySnapshot[d.deviceId] || d.telemetry;
      return isDroneOnline(t);
    });
  }, [devices, telemetrySnapshot]);

  // Tự động chuyển về 'all' nếu Drone đang xem bỗng nhiên mất kết nối (Offline)
  useEffect(() => {
    if (activeDroneId !== 'all') {
      const isStillOnline = onlineDevices.some((d) => d.deviceId === activeDroneId);
      if (!isStillOnline && onlineDevices.length > 0) {
        setActiveDroneId('all');
      }
    }
  }, [activeDroneId, onlineDevices]);

  // Kích hoạt Focus Mode 20Hz qua WebSocket Rooms khi chọn Drone mục tiêu
  // Hoặc quay về chế độ Toàn Phi Đội 1Hz khi chọn 'all'
  useEffect(() => {
    if (!socket || !isSocketConnected) return;

    if (activeDroneId && activeDroneId !== 'all') {
      socket.emit('subscribe:drone', { deviceId: activeDroneId });
    } else {
      socket.emit('subscribe:all');
    }

    return () => {
      if (activeDroneId && activeDroneId !== 'all') {
        socket.emit('unsubscribe:drone', { deviceId: activeDroneId });
      }
    };
  }, [socket, isSocketConnected, activeDroneId]);

  // Selected Drone Telemetry (for HUD / CommandDeck)
  const targetDevice = activeDroneId !== 'all'
    ? devices.find((d) => d.deviceId === activeDroneId)
    : devices[0];
  const targetDevId = targetDevice?.deviceId;

  const currentTelemetry = activeDroneId !== 'all'
    ? (telemetrySnapshot[activeDroneId] || getLatestTelemetry(activeDroneId) || targetDevice?.telemetry)
    : (targetDevId ? (telemetrySnapshot[targetDevId] || getLatestTelemetry(targetDevId) || targetDevice?.telemetry) : undefined);

  // Route Guard: Nếu chưa đăng nhập, chỉ hiển thị màn hình Đăng nhập / Đăng ký
  if (!isAuthenticated) {
    return <AuthModal />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#EAE6DF] dark:bg-obsidian-950 text-[#24221E] dark:text-[#E2E8F0] transition-colors duration-200">

      {/* Main Mission Control Header */}
      <Header
        devices={devices}
        activeDroneId={activeDroneId}
        onSelectDrone={(id) => setActiveDroneId(id)}
        layoutMode={layoutMode}
        onChangeLayoutMode={(mode) => setLayoutMode(mode)}
        isSocketConnected={isSocketConnected}
        latencyMs={latencyMs}
        onOpenManualRegister={() => setIsManualRegisterOpen(true)}
        isTelemetryOpen={isTelemetryOpen}
        onToggleTelemetry={() => setIsTelemetryOpen((prev) => !prev)}
        telemetrySnapshot={telemetrySnapshot}
      />

      {/* Cockpit Canvas Main Viewport */}
      <main className="flex-1 max-w-[1920px] w-full mx-auto p-3 sm:p-4 flex flex-col gap-3">

        {/* Row 1: KPI Overview Bento Deck */}
        <KpiDeck
          stats={stats}
          devices={devices}
          telemetrySnapshot={telemetrySnapshot}
        />

        {/* Row 2: Quick Command Deck */}
        <CommandDeck
          activeDroneId={activeDroneId}
          devices={devices}
          telemetry={currentTelemetry}
          onSendCommand={(cmd) => handleSendCommand(cmd)}
          onOpenSsh={() => handleOpenSsh()}
        />

        {/* Row 3: Tactical Viewport + Flight Telemetry Monitor Bento Deck */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 w-full items-start">

          {/* Viewport Canvas (Map / FPV Video) */}
          <div className={`${isTelemetryOpen ? 'xl:col-span-8 2xl:col-span-9' : 'col-span-12'} w-full flex flex-col transition-all duration-200`}>
            {/* Layout Mode 1: Pure Fullscreen Tactical Map */}
            {layoutMode === 'mode-map' && (
              <div className="w-full h-[540px] rounded-xl overflow-hidden">
                <TacticalMap
                  devices={devices}
                  activeDroneId={activeDroneId}
                  onSelectDrone={(id) => setActiveDroneId(id)}
                  telemetrySnapshot={telemetrySnapshot}
                  getFlightTrail={getFlightTrail}
                />
              </div>
            )}

            {/* Layout Mode 2: Split Tactical (Map Left, FPV Video Right) */}
            {layoutMode === 'mode-split' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 h-[540px]">
                <div className="h-full">
                  <TacticalMap
                    devices={devices}
                    activeDroneId={activeDroneId}
                    onSelectDrone={(id) => setActiveDroneId(id)}
                    telemetrySnapshot={telemetrySnapshot}
                    getFlightTrail={getFlightTrail}
                  />
                </div>
                <div className="h-full">
                  <FpvPlayer
                    activeDroneId={activeDroneId !== 'all' ? activeDroneId : devices[0]?.deviceId || null}
                    telemetry={currentTelemetry}
                    socket={socket}
                  />
                </div>
              </div>
            )}

            {/* Layout Mode 3: Cockpit Primary (FPV Video Major, Mini Map Corner) */}
            {layoutMode === 'mode-cockpit' && (
              <div className="relative w-full h-[600px] rounded-xl overflow-hidden">
                <FpvPlayer
                  activeDroneId={activeDroneId !== 'all' ? activeDroneId : devices[0]?.deviceId || null}
                  telemetry={currentTelemetry}
                  socket={socket}
                />

                {/* Floating Mini Radar Map at Bottom Right */}
                <div className="absolute bottom-4 right-4 z-30 w-72 h-56 rounded-xl overflow-hidden border-2 border-slate-700/80 shadow-2xl backdrop-blur-md">
                  <TacticalMap
                    devices={devices}
                    activeDroneId={activeDroneId}
                    onSelectDrone={(id) => setActiveDroneId(id)}
                    telemetrySnapshot={telemetrySnapshot}
                    getFlightTrail={getFlightTrail}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right Sidebar: Flight Telemetry Monitor Card */}
          {isTelemetryOpen && (
            <div className={`xl:col-span-4 2xl:col-span-3 w-full ${layoutMode === 'mode-cockpit' ? 'h-[600px]' : 'h-[540px]'}`}>
              <FlightTelemetryCard
                activeDroneId={activeDroneId}
                devices={devices}
                onSelectDrone={(id) => setActiveDroneId(id)}
                telemetry={currentTelemetry}
                onClose={() => setIsTelemetryOpen(false)}
              />
            </div>
          )}

        </div>

        {/* Row 4: Fleet Management Table */}
        <FleetTable
          devices={devices}
          activeDroneId={activeDroneId}
          onSelectDrone={(id) => setActiveDroneId(id)}
          telemetrySnapshot={telemetrySnapshot}
          onOpenSsh={(id) => handleOpenSsh(id)}
          onSendCommand={(id, cmd) => handleSendCommand(cmd, id)}
        />

      </main>

      {/* Web SSH Modal */}
      <WebSshModal
        isOpen={isSshOpen}
        onClose={() => setIsSshOpen(false)}
        targetDeviceId={sshTargetDrone}
        devices={devices}
        onConnect={emitSshConnect}
        onDisconnect={emitSshDisconnect}
        onInput={emitSshInput}
        onResize={emitSshResize}
        sshOutput={sshOutput}
        sshStatus={sshStatus}
      />

      {/* Manual Device Register Modal */}
      <ManualRegisterModal
        isOpen={isManualRegisterOpen}
        onClose={() => setIsManualRegisterOpen(false)}
        onSuccess={refreshData}
      />

    </div>
  );
};

