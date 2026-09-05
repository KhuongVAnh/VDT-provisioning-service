import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  Terminal as TerminalIcon,
  X,
  Play,
  Square,
  Key,
  User,
  Shield,
  ClipboardPaste,
  Maximize2,
  Minimize2,
  Trash2,
  HelpCircle,
  CornerDownLeft,
  Eye,
  EyeOff,
  Settings,
  AlertCircle,
  Wifi,
  Sparkles,
} from 'lucide-react';
import { DroneDevice } from '../../types';
import { useToast } from '../../context/ToastContext';

interface WebSshModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetDeviceId: string;
  devices: DroneDevice[];
  onConnect: (params: { deviceId: string; username: string; password?: string; cols: number; rows: number }) => void;
  onDisconnect: () => void;
  onInput: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  sshOutput: string | null;
  sshStatus: string;
}

export const WebSshModal: React.FC<WebSshModalProps> = ({
  isOpen,
  onClose,
  targetDeviceId,
  devices,
  onConnect,
  onDisconnect,
  onInput,
  onResize,
  sshOutput,
  sshStatus,
}) => {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState(targetDeviceId || devices[0]?.deviceId || '');
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  const termContainerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Xterm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const usernameInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  // Sync selectedId when targetDeviceId prop changes
  useEffect(() => {
    if (targetDeviceId) setSelectedId(targetDeviceId);
  }, [targetDeviceId]);

  // Find VPN IP of target device
  const targetDevice = devices.find((d) => d.deviceId === selectedId);
  const vpnIp = targetDevice?.vpnIp || '';

  // Focus input field when modal opens (DO NOT focus terminal)
  useEffect(() => {
    if (!isOpen) return;

    // Reset config display when opening
    if (!isConnected) {
      setShowConfig(true);
    }

    const timer = setTimeout(() => {
      if (username) {
        passwordInputRef.current?.focus();
      } else {
        usernameInputRef.current?.focus();
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [isOpen, isConnected, username]);

  // Safe clipboard copy with fallback
  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('navigator.clipboard.writeText failed, using fallback', err);
    }

    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.top = '-9999px';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return success;
    } catch (err) {
      console.error('Fallback copy failed', err);
      return false;
    }
  }, []);

  // Safe clipboard paste
  const pasteFromClipboard = useCallback(async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          onInput(text);
          return;
        }
      }
    } catch (err) {
      console.warn('Clipboard readText failed or permission denied:', err);
      toast.warning('Trình duyệt chặn truy cập bộ nhớ tạm. Hãy dùng chuột phải để dán.');
    }
  }, [onInput, toast]);

  // Handle Resize & notify backend PTY
  const handleFitAndResize = useCallback(() => {
    if (fitAddonRef.current && xtermRef.current) {
      fitAddonRef.current.fit();
      const cols = xtermRef.current.cols;
      const rows = xtermRef.current.rows;
      if (cols > 0 && rows > 0 && onResize) {
        onResize(cols, rows);
      }
    }
  }, [onResize]);

  // Initialize Xterm
  useEffect(() => {
    if (!isOpen || !termContainerRef.current) return;

    if (!xtermRef.current) {
      const term = new Xterm({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
        theme: {
          background: '#060911',
          foreground: '#f8fafc',
          cursor: '#00e5ff',
          selectionBackground: 'rgba(0, 229, 255, 0.35)',
        },
        convertEol: true,
        scrollback: 5000,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(termContainerRef.current);
      fitAddon.fit();

      // Keyboard Event Interceptor (Smart CMD behavior)
      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type !== 'keydown') return true;

        const isCtrlOrCmd = event.ctrlKey || event.metaKey;

        // 1. SMART Ctrl+C / Cmd+C
        if (isCtrlOrCmd && (event.key === 'c' || event.key === 'C')) {
          const selection = term.getSelection();

          if (selection && selection.length > 0) {
            copyToClipboard(selection).then((ok) => {
              if (ok) {
                toast.info(`Đã sao chép ${selection.length} ký tự vào bộ nhớ tạm`);
              }
            });
            term.clearSelection();
            return false;
          }

          if (event.shiftKey) {
            return false;
          }

          return true;
        }

        // 2. Ctrl+V / Cmd+V -> DÁN NỘI DUNG TỪ CLIPBOARD
        if (isCtrlOrCmd && (event.key === 'v' || event.key === 'V')) {
          pasteFromClipboard();
          return false;
        }

        // 3. Phím Windows chuẩn: Ctrl+Insert (Sao chép) & Shift+Insert (Dán)
        if (event.ctrlKey && event.key === 'Insert') {
          const selection = term.getSelection();
          if (selection && selection.length > 0) {
            copyToClipboard(selection);
            term.clearSelection();
            toast.info('Đã sao chép vào bộ nhớ tạm');
          }
          return false;
        }

        if (event.shiftKey && event.key === 'Insert') {
          pasteFromClipboard();
          return false;
        }

        return true;
      });

      term.onData((data) => {
        onInput(data);
      });

      term.writeln('\x1b[36m>>> Drone Fleet Remote Web SSH Gateway (WireGuard VPN Subnet)\x1b[0m');
      term.writeln('\x1b[90m>>> Sẵn sàng kết nối tới Linux Companion SBC trên Drone.\x1b[0m\r\n');

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
    }

    window.addEventListener('resize', handleFitAndResize);

    return () => {
      window.removeEventListener('resize', handleFitAndResize);
    };
  }, [isOpen, copyToClipboard, pasteFromClipboard, handleFitAndResize, onInput, toast]);

  // Re-fit when fullscreen or config panel changes
  useEffect(() => {
    const timer = setTimeout(() => {
      handleFitAndResize();
      if (isConnected && !showConfig) {
        xtermRef.current?.focus();
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [isFullscreen, showConfig, isConnected, handleFitAndResize]);

  // Stream SSH Output to Xterm
  useEffect(() => {
    if (sshOutput && xtermRef.current) {
      xtermRef.current.write(sshOutput);
    }
  }, [sshOutput]);

  // Handle native paste event on terminal container
  useEffect(() => {
    const container = termContainerRef.current;
    if (!container) return;

    const handleNativePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text');
      if (text) {
        e.preventDefault();
        onInput(text);
      }
    };

    container.addEventListener('paste', handleNativePaste);
    return () => {
      container.removeEventListener('paste', handleNativePaste);
    };
  }, [isOpen, onInput]);

  // Clean up when modal closes
  const handleClose = () => {
    if (isConnected) {
      onDisconnect();
      setIsConnected(false);
    }
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    setShowConfig(true);
    onClose();
  };

  // Start SSH Connection
  const handleStartConnect = () => {
    if (!selectedId && !vpnIp) {
      toast.warning('Vui lòng chọn Drone hoặc kiểm tra IP VPN!');
      return;
    }

    const term = xtermRef.current;
    if (term && fitAddonRef.current) {
      fitAddonRef.current.fit();
      term.writeln(`\r\n\x1b[36m>>> Đang mở phiên SSH tới ${selectedId} (${vpnIp || '10.13.37.X'}:22) với user "${username}"...\x1b[0m\r\n`);

      onConnect({
        deviceId: vpnIp || selectedId,
        username,
        password,
        cols: term.cols,
        rows: term.rows,
      });

      setIsConnected(true);
      setShowConfig(false);

      // Focus terminal once connected
      setTimeout(() => {
        term.focus();
      }, 200);
    }
  };

  // Disconnect SSH Session
  const handleDisconnectSession = () => {
    onDisconnect();
    setIsConnected(false);
    setShowConfig(true);
    if (xtermRef.current) {
      xtermRef.current.writeln('\r\n\x1b[31m>>> [DISCONNECTED] Đã đóng phiên SSH.\x1b[0m\r\n');
    }
  };

  // Right-click context menu (CMD / PuTTY style: Copy if selected, Paste if not)
  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const term = xtermRef.current;
    if (!term) return;

    const selection = term.getSelection();
    if (selection && selection.length > 0) {
      const ok = await copyToClipboard(selection);
      if (ok) {
        toast.info(`Đã sao chép ${selection.length} ký tự (Chuột phải)`);
      }
      term.clearSelection();
    } else {
      await pasteFromClipboard();
      toast.info('Đã dán lệnh từ bộ nhớ tạm (Chuột phải)');
    }
  };

  // Button: Send SIGINT (Ctrl+C)
  const handleSendSigint = () => {
    onInput('\x03');
    toast.info('Đã gửi tín hiệu dừng tiến trình SIGINT (Ctrl+C)');
    xtermRef.current?.focus();
  };

  // Button: Clear Screen
  const handleClearScreen = () => {
    xtermRef.current?.clear();
    xtermRef.current?.focus();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
      <div
        className={`relative bg-slate-900 border border-slate-700/80 shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${isFullscreen
            ? 'w-full h-full rounded-none border-none'
            : 'w-full max-w-5xl h-[88vh] rounded-2xl'
          }`}
      >
        {/* ========================================================================= */}
        {/* 1. TERMINAL TOP HEADER BAR                                                */}
        {/* ========================================================================= */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950 border-b border-slate-800 text-white select-none">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-tactical-cyan/10 text-tactical-cyan border border-tactical-cyan/30">
              <TerminalIcon className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs uppercase tracking-wider text-slate-100 font-sans">
                  Web SSH Console
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-tactical-cyan font-mono border border-slate-700 font-semibold">
                  {selectedId || 'CHƯA CHỌN'}
                </span>
                {isConnected ? (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-tactical-emerald bg-tactical-emerald/15 px-2 py-0.5 rounded border border-tactical-emerald/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-tactical-emerald animate-pulse" />
                    <span>ĐÃ KẾT NỐI</span>
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">
                    CHƯA KẾT NỐI
                  </span>
                )}
              </div>
              <div className="text-[10px] font-mono text-slate-400 flex items-center gap-2">
                <span>WireGuard VPN: <b className="text-slate-300">{vpnIp ? `${vpnIp}:22` : 'Chưa có IP'}</b></span>
                {isConnected && (
                  <>
                    <span className="text-slate-600">|</span>
                    <span>User: <b className="text-tactical-cyan">{username}</b></span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Top Bar Action Buttons */}
          <div className="flex items-center gap-1.5">
            {/* Toggle Configuration Panel Button */}
            <button
              type="button"
              onClick={() => setShowConfig((prev) => !prev)}
              title={showConfig ? 'Thu gọn bảng cấu hình' : 'Mở bảng cấu hình kết nối'}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${showConfig
                  ? 'bg-tactical-cyan text-black font-bold shadow-sm'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700'
                }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{showConfig ? 'Đóng cấu hình' : 'Thiết lập SSH'}</span>
            </button>

            {/* Shortcut Help Toggle */}
            <button
              type="button"
              onClick={() => setShowShortcutHelp(!showShortcutHelp)}
              title="Xem hướng dẫn phím tắt CMD / Terminal"
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showShortcutHelp ? 'bg-tactical-cyan text-black' : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                }`}
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Thu nhỏ cửa sổ' : 'Phóng to toàn màn hình'}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Close Modal */}
            <button
              type="button"
              onClick={handleClose}
              title="Đóng cửa sổ SSH"
              className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 2. SHORTCUT QUICK BANNER (COLLAPSIBLE)                                     */}
        {/* ========================================================================= */}
        {showShortcutHelp && (
          <div className="px-4 py-2 bg-tactical-cyan/10 border-b border-tactical-cyan/30 text-[11px] text-slate-200 flex flex-wrap items-center justify-between gap-2 font-mono animate-in slide-in-from-top duration-150 select-none">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-tactical-cyan font-bold flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                Phím tắt chuẩn Terminal:
              </span>
              <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                <strong className="text-cyan-300">Ctrl + C</strong> (có bôi đen): Sao chép
              </span>
              <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                <strong className="text-rose-400">Ctrl + C</strong> (không bôi đen): Dừng tiến trình (SIGINT)
              </span>
              <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                <strong className="text-emerald-300">Ctrl + V</strong> / <strong className="text-emerald-300">Chuột phải</strong>: Dán lệnh
              </span>
              <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                <strong className="text-amber-300">Chuột phải</strong> (khi bôi đen): Sao chép nhanh
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowShortcutHelp(false)}
              className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
            >
              Đóng
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 3. ACTIVE SESSION QUICK TOOLBAR (WHEN CONNECTED)                          */}
        {/* ========================================================================= */}
        {isConnected && !showConfig && (
          <div className="px-3 py-2 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-tactical-emerald animate-pulse" />
              <span className="text-slate-200 font-semibold">
                {username}@{vpnIp || selectedId}
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400 text-[11px]">
                {sshStatus || 'Phiên SSH đang hoạt động'}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Quick Stop (SIGINT) */}
              <button
                type="button"
                onClick={handleSendSigint}
                title="Gửi tín hiệu dừng tiến trình SIGINT (Ctrl+C)"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-950/60 text-rose-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/50 transition-colors cursor-pointer text-xs"
              >
                <CornerDownLeft className="w-3.5 h-3.5 text-rose-400" />
                <span>Dừng lệnh (Ctrl+C)</span>
              </button>

              {/* Quick Paste */}
              <button
                type="button"
                onClick={pasteFromClipboard}
                title="Dán nội dung từ bộ nhớ tạm (Ctrl+V)"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-cyan-950/60 text-cyan-400 hover:text-cyan-300 border border-slate-700 hover:border-cyan-500/50 transition-colors cursor-pointer text-xs"
              >
                <ClipboardPaste className="w-3.5 h-3.5 text-cyan-400" />
                <span>Dán (Ctrl+V)</span>
              </button>

              {/* Clear Screen */}
              <button
                type="button"
                onClick={handleClearScreen}
                title="Xóa màn hình Terminal"
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              {/* Disconnect Button */}
              <button
                type="button"
                onClick={handleDisconnectSession}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/40 transition-colors cursor-pointer text-xs font-semibold"
              >
                <Square className="w-3 h-3 fill-rose-400" />
                <span>Ngắt SSH</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 4. MAIN TERMINAL VIEWPORT WITH SMART CONNECTION SETUP OVERLAY             */}
        {/* ========================================================================= */}
        <div className="flex-1 w-full bg-[#060911] relative overflow-hidden flex flex-col">

          {/* Xterm Canvas Container */}
          <div
            className="flex-1 w-full p-2 cursor-text overflow-hidden"
            onContextMenu={handleContextMenu}
          >
            <div ref={termContainerRef} className="w-full h-full" />
          </div>

          {/* ======================================================================= */}
          {/* CONNECTION SETUP CARD (Displayed when !isConnected or showConfig=true)  */}
          {/* ======================================================================= */}
          {showConfig && (
            <div className="absolute inset-0 z-20 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
              <div className="w-full max-w-lg bg-slate-900 border border-slate-700/90 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-5 text-slate-100 font-sans">

                {/* Card Title */}
                <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-tactical-cyan/10 text-tactical-cyan border border-tactical-cyan/30">
                      <Shield className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white uppercase tracking-wider">
                        Thiết Lập Kết Nối SSH
                      </h3>
                      <p className="text-xs text-slate-400 font-mono">
                        Remote Shell via WireGuard VPN (10.13.37.X)
                      </p>
                    </div>
                  </div>

                  {/* If already connected, allow user to dismiss this setup card */}
                  {isConnected && (
                    <button
                      type="button"
                      onClick={() => setShowConfig(false)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Quay lại Terminal đang chạy"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Status Notice if disconnected or error */}
                {sshStatus && (
                  <div className={`p-2.5 rounded-xl text-xs font-mono flex items-center gap-2 border ${sshStatus.toLowerCase().includes('lỗi') || sshStatus.toLowerCase().includes('error') || sshStatus.toLowerCase().includes('kết thúc')
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                      : 'bg-tactical-cyan/10 border-tactical-cyan/30 text-cyan-300'
                    }`}>
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{sshStatus}</span>
                  </div>
                )}

                {/* Form Inputs Container */}
                <div className="space-y-4">

                  {/* 1. Target Drone Selection */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      Drone Mục Tiêu (Thiết bị):
                    </label>
                    <div className="relative">
                      <select
                        value={selectedId}
                        onChange={(e) => setSelectedId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-tactical-cyan focus:ring-2 focus:ring-tactical-cyan/30 cursor-pointer appearance-none"
                      >
                        {devices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId} className="bg-slate-900 text-white">
                            {d.deviceId} — IP VPN: {d.vpnIp || '10.13.37.X'} {d.hardwareModel ? `(${d.hardwareModel})` : ''}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs font-mono">
                        ▼
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mt-1 px-1">
                      <span>IP nội bộ: <b className="text-tactical-cyan">{vpnIp || 'Chưa gán'}</b></span>
                      <span>Port: <b className="text-slate-300">22</b></span>
                    </div>
                  </div>

                  {/* 2. Username Input with Quick Tag Presets */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      Tài khoản SSH (Username):
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        ref={usernameInputRef}
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') passwordInputRef.current?.focus();
                        }}
                        placeholder="Nhập tên tài khoản (mặc định: root)"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-tactical-cyan focus:ring-2 focus:ring-tactical-cyan/30 placeholder:text-slate-600"
                      />
                    </div>
                    {/* Quick Username Tags */}
                    <div className="flex items-center gap-1.5 mt-2 select-none">
                      <span className="text-[11px] text-slate-400">Gợi ý nhanh:</span>
                      {['root', 'pi', 'ubuntu', 'drone'].map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => {
                            setUsername(u);
                            passwordInputRef.current?.focus();
                          }}
                          className={`px-2 py-0.5 rounded-lg text-[11px] font-mono transition-colors cursor-pointer ${username === u
                              ? 'bg-tactical-cyan/20 text-tactical-cyan border border-tactical-cyan/40 font-bold'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                            }`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 3. Password Input with Show/Hide Eye Toggle */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      Mật khẩu (Password):
                    </label>
                    <div className="relative">
                      <Key className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        ref={passwordInputRef}
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleStartConnect();
                        }}
                        placeholder="Nhập mật khẩu truy cập..."
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-10 pr-10 py-2.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-tactical-cyan focus:ring-2 focus:ring-tactical-cyan/30 placeholder:text-slate-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                </div>

                {/* Primary Action Buttons */}
                <div className="pt-2 flex flex-col sm:flex-row items-center gap-2.5">
                  {!isConnected ? (
                    <button
                      type="button"
                      onClick={handleStartConnect}
                      className="w-full flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-tactical-cyan text-black font-bold text-sm tracking-wider uppercase hover:bg-cyan-300 transition-all shadow-[0_0_20px_rgba(0,229,255,0.3)] cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-black" />
                      <span>KẾT NỐI SSH NGAY (ENTER)</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowConfig(false)}
                        className="w-full sm:w-1/2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-colors cursor-pointer"
                      >
                        <span>Quay lại dòng lệnh Terminal</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDisconnectSession}
                        className="w-full sm:w-1/2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/40 font-semibold text-xs transition-colors cursor-pointer"
                      >
                        <Square className="w-3.5 h-3.5 fill-rose-400" />
                        <span>Ngắt kết nối phiên</span>
                      </button>
                    </>
                  )}
                </div>

                {/* Keyboard Shortcut Note */}
                <p className="text-[11px] text-slate-500 text-center font-mono">
                  💡 Nhấn <b>Enter</b> để kết nối nhanh. Toàn bộ phiên SSH được mã hóa đầu cuối qua WireGuard VPN.
                </p>

              </div>
            </div>
          )}

        </div>

        {/* ========================================================================= */}
        {/* 5. TERMINAL FOOTER STATUS BAR                                             */}
        {/* ========================================================================= */}
        <div className="px-3 py-1 bg-slate-950 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400 select-none">
          <div className="flex items-center gap-3">
            <span>
              Mẹo: <span className="text-slate-200 font-semibold">Ctrl+C</span> để Copy (khi chọn chữ) hoặc Dừng tiến trình
            </span>
            <span className="text-slate-600">|</span>
            <span>
              <span className="text-slate-200 font-semibold">Ctrl+V</span> hoặc <span className="text-slate-200 font-semibold">Chuột phải</span> để Dán
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>Encoding: UTF-8</span>
            <span className="text-slate-600">|</span>
            <span>Term: xterm-256color</span>
          </div>
        </div>

      </div>
    </div>
  );
};
