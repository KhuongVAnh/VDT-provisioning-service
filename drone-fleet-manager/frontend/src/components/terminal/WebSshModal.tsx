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
  const [isConnected, setIsConnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  const termContainerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Xterm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Sync selectedId when targetDeviceId prop changes
  useEffect(() => {
    if (targetDeviceId) setSelectedId(targetDeviceId);
  }, [targetDeviceId]);

  // Find VPN IP of target device
  const targetDevice = devices.find((d) => d.deviceId === selectedId);
  const vpnIp = targetDevice?.vpnIp || '';

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

          // TH1: Người dùng đã bôi đen đoạn text -> HÀNH ĐỘNG SAO CHÉP (COPY)
          // KHÔNG gửi SIGINT (\x03) tới tiến trình đang chạy trên Drone!
          if (selection && selection.length > 0) {
            copyToClipboard(selection).then((ok) => {
              if (ok) {
                toast.info(`Đã sao chép ${selection.length} ký tự vào bộ nhớ tạm`);
              }
            });
            term.clearSelection();
            return false; // Ngăn chặn Xterm phát tín hiệu \x03 hủy tiến trình
          }

          // TH2: Nếu có phím Shift (Ctrl+Shift+C) mà không bôi đen -> không làm gì
          if (event.shiftKey) {
            return false;
          }

          // TH3: Không bôi đen -> HÀNH ĐỘNG DỪNG TIẾN TRÌNH (SIGINT \x03)
          // Trả về true để Xterm xử lý phím Ctrl+C mặc định và gửi \x03 qua onData
          return true;
        }

        // 2. Ctrl+V / Cmd+V / Ctrl+Shift+V -> DÁN NỘI DUNG TỪ CLIPBOARD
        if (isCtrlOrCmd && (event.key === 'v' || event.key === 'V')) {
          pasteFromClipboard();
          return false; // Ngăn chặn Xterm chèn ký tự điều khiển ^V (\x16)
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
      term.writeln('\x1b[90m>>> Hỗ trợ phím tắt CMD: Ctrl+C (Sao chép khi bôi đen / Dừng lệnh khi không bôi đen), Ctrl+V (Dán).\x1b[0m');
      term.writeln('\x1b[90m>>> Chuột phải: Sao chép nếu đã bôi đen, hoặc Dán nếu không bôi đen.\x1b[0m\r\n');

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Auto-focus terminal
      setTimeout(() => {
        term.focus();
      }, 150);
    }

    window.addEventListener('resize', handleFitAndResize);

    return () => {
      window.removeEventListener('resize', handleFitAndResize);
    };
  }, [isOpen, copyToClipboard, pasteFromClipboard, handleFitAndResize, onInput, toast]);

  // Re-fit when fullscreen changes
  useEffect(() => {
    const timer = setTimeout(() => {
      handleFitAndResize();
      xtermRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [isFullscreen, handleFitAndResize]);

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
    onClose();
  };

  const handleStartConnect = () => {
    if (!selectedId && !vpnIp) {
      toast.warning('Vui lòng chọn Drone hoặc kiểm tra IP VPN!');
      return;
    }

    const term = xtermRef.current;
    if (term && fitAddonRef.current) {
      fitAddonRef.current.fit();
      term.writeln(`\r\n\x1b[36m>>> Đang mở phiên SSH tới ${selectedId} (${vpnIp}) với user "${username}"...\x1b[0m\r\n`);

      onConnect({
        deviceId: vpnIp || selectedId,
        username,
        password,
        cols: term.cols,
        rows: term.rows,
      });
      setIsConnected(true);
      term.focus();
    }
  };

  const handleDisconnectSession = () => {
    onDisconnect();
    setIsConnected(false);
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div
        className={`relative bg-slate-900 border border-slate-700/80 shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${isFullscreen
            ? 'w-full h-full rounded-none border-none'
            : 'w-full max-w-5xl h-[88vh] rounded-2xl'
          }`}
      >
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950 border-b border-slate-800 text-white select-none">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-tactical-cyan/10 text-tactical-cyan border border-tactical-cyan/30">
              <TerminalIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs uppercase tracking-wider text-slate-100">
                  Web SSH Terminal (Companion Computer)
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-tactical-cyan font-mono border border-slate-700">
                  CMD Emulation
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                {vpnIp ? `Kênh nội bộ WireGuard: ${vpnIp}:22` : 'Chưa chọn thiết bị'}
              </div>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-1.5">
            {/* Shortcut Help Toggle */}
            <button
              onClick={() => setShowShortcutHelp(!showShortcutHelp)}
              title="Xem hướng dẫn phím tắt CMD / Terminal"
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showShortcutHelp ? 'bg-tactical-cyan text-black' : 'hover:bg-slate-800 text-slate-400 hover:text-white'
                }`}
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            {/* Fullscreen Toggle */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Thu nhỏ cửa sổ' : 'Phóng to toàn màn hình'}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Close Modal */}
            <button
              onClick={handleClose}
              title="Đóng cửa sổ SSH"
              className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Shortcut Quick Banner (Collapsible) */}
        {showShortcutHelp && (
          <div className="px-4 py-2 bg-tactical-cyan/10 border-b border-tactical-cyan/30 text-[11px] text-slate-200 flex flex-wrap items-center justify-between gap-2 font-mono animate-in slide-in-from-top duration-150">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-tactical-cyan font-bold">💡 Phím tắt chuẩn CMD / Terminal:</span>
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
              onClick={() => setShowShortcutHelp(false)}
              className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
            >
              Đóng
            </button>
          </div>
        )}

        {/* SSH Connection Controls Toolbar */}
        <div className="p-2.5 sm:p-3 bg-slate-900/95 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-2">
            {/* Target Drone Select */}
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
              <Shield className="w-3.5 h-3.5 text-tactical-cyan" />
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
              >
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId} className="bg-slate-900 text-white">
                    {d.deviceId} ({d.vpnIp || '10.13.37.X'})
                  </option>
                ))}
              </select>
            </div>

            {/* Username */}
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="User (root)"
                className="bg-transparent text-slate-200 focus:outline-none w-16"
              />
            </div>

            {/* Password */}
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
              <Key className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mật khẩu"
                className="bg-transparent text-slate-200 focus:outline-none w-20"
              />
            </div>

            {/* Connect / Disconnect Action */}
            {!isConnected ? (
              <button
                onClick={handleStartConnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-tactical-cyan text-black font-bold font-sans hover:bg-cyan-300 transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-black" />
                <span>Kết nối SSH</span>
              </button>
            ) : (
              <button
                onClick={handleDisconnectSession}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-tactical-red text-white font-bold font-sans hover:bg-red-600 transition-colors cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-white" />
                <span>Ngắt kết nối</span>
              </button>
            )}
          </div>

          {/* Quick Terminal Action Bar */}
          <div className="flex items-center gap-1.5">
            {/* Quick Stop Button (SIGINT) */}
            <button
              onClick={handleSendSigint}
              title="Gửi tín hiệu dừng tiến trình SIGINT (Ctrl+C)"
              className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-rose-950/60 text-rose-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/50 transition-colors cursor-pointer text-[11px]"
            >
              <CornerDownLeft className="w-3 h-3 text-rose-400" />
              <span>Dừng lệnh (Ctrl+C)</span>
            </button>

            {/* Quick Paste Button */}
            <button
              onClick={pasteFromClipboard}
              title="Dán nội dung từ bộ nhớ tạm (Ctrl+V)"
              className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-cyan-950/60 text-cyan-400 hover:text-cyan-300 border border-slate-700 hover:border-cyan-500/50 transition-colors cursor-pointer text-[11px]"
            >
              <ClipboardPaste className="w-3 h-3 text-cyan-400" />
              <span>Dán (Ctrl+V)</span>
            </button>

            {/* Clear Screen */}
            <button
              onClick={handleClearScreen}
              title="Xóa sạch màn hình Terminal"
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {/* Status badge */}
            <div className="hidden sm:block ml-2 text-[11px] text-slate-400 font-mono">
              <span className="text-tactical-cyan font-bold">
                {sshStatus || (isConnected ? '● Đã kết nối' : '○ Sẵn sàng')}
              </span>
            </div>
          </div>
        </div>

        {/* Xterm Container with Context Menu Support */}
        <div
          className="flex-1 w-full bg-[#060911] p-2 overflow-hidden relative cursor-text"
          onContextMenu={handleContextMenu}
        >
          <div ref={termContainerRef} className="w-full h-full" />
        </div>

        {/* Terminal Footer Status Bar */}
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

