import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  X,
  AlertOctagon,
  ShieldAlert,
  ArrowRight,
  Lock,
  Volume2,
  VolumeX
} from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success';
  requiresHold?: boolean;
}

interface ToastContextType {
  showToast: (type: ToastType, message: string, title?: string, duration?: number) => void;
  toast: {
    success: (message: string, title?: string) => void;
    error: (message: string, title?: string) => void;
    warning: (message: string, title?: string) => void;
    info: (message: string, title?: string) => void;
  };
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  isSoundEnabled: boolean;
  toggleSound: () => void;
  playSfx: (type: 'beep' | 'confirm' | 'alert' | 'arm' | 'success') => void;
}

// Synthesized Tactical Audio SFX via Web Audio API (Zero external MP3 dependencies)
let audioCtx: AudioContext | null = null;

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
};

const playTacticalSfx = (type: 'beep' | 'confirm' | 'alert' | 'arm' | 'success', enabled: boolean = true) => {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'beep') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'confirm') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.06); // A5
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.16);
    } else if (type === 'arm') {
      // Tactical lock chirp
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.linearRampToValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === 'alert') {
      // Danger alert warble
      osc.type = 'square';
      osc.frequency.setValueAtTime(700, now);
      osc.frequency.setValueAtTime(480, now + 0.08);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.28);
    }
  } catch {
    // Ignore audio failures if browser blocks autoplay
  }
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('tactical_sound_enabled');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const toggleSound = useCallback(() => {
    setIsSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('tactical_sound_enabled', String(next));
      } catch {}
      if (next) playTacticalSfx('beep', true);
      return next;
    });
  }, []);

  const playSfx = useCallback(
    (type: 'beep' | 'confirm' | 'alert' | 'arm' | 'success') => {
      playTacticalSfx(type, isSoundEnabled);
    },
    [isSoundEnabled]
  );

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  // Hold-to-confirm progress state
  const [holdProgress, setHoldProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef<number>(0);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (type: ToastType, message: string, title?: string, duration: number = 4000) => {
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: ToastItem = { id, type, title, message, duration };

      setToasts((prev) => [...prev, newToast]);

      // Trigger audio feedback
      if (type === 'success') playTacticalSfx('success', isSoundEnabled);
      else if (type === 'error' || type === 'warning') playTacticalSfx('alert', isSoundEnabled);
      else playTacticalSfx('beep', isSoundEnabled);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast, isSoundEnabled]
  );

  const toast = {
    success: (message: string, title?: string) => showToast('success', message, title || 'Thành công'),
    error: (message: string, title?: string) => showToast('error', message, title || 'Lỗi thao tác'),
    warning: (message: string, title?: string) => showToast('warning', message, title || 'Cảnh báo tác chiến'),
    info: (message: string, title?: string) => showToast('info', message, title || 'Thông báo hệ thống'),
  };

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        playTacticalSfx('alert', isSoundEnabled);
        setHoldProgress(0);
        setIsHolding(false);
        setConfirmDialog({
          isOpen: true,
          options,
          resolve: (val: boolean) => {
            if (val) playTacticalSfx('arm', isSoundEnabled);
            setConfirmDialog(null);
            resolve(val);
          },
        });
      });
    },
    [isSoundEnabled]
  );

  // Cancel hold if unmounted or closed
  const resetHold = useCallback(() => {
    if (holdTimerRef.current) {
      cancelAnimationFrame(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setIsHolding(false);
    setHoldProgress(0);
  }, []);

  // Handle hold-to-confirm progress
  const startHold = useCallback(() => {
    setIsHolding(true);
    holdStartRef.current = performance.now();
    const duration = 1200; // 1.2s hold required

    const updateHold = (now: number) => {
      const elapsed = now - holdStartRef.current;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setHoldProgress(pct);

      if (pct >= 100) {
        resetHold();
        if (confirmDialog) {
          confirmDialog.resolve(true);
        }
      } else {
        holdTimerRef.current = requestAnimationFrame(updateHold);
      }
    };

    holdTimerRef.current = requestAnimationFrame(updateHold);
  }, [confirmDialog, resetHold]);

  // Keyboard shortcut: ESC to cancel confirmation dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && confirmDialog?.isOpen) {
        resetHold();
        confirmDialog.resolve(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmDialog, resetHold]);

  const requiresHold = confirmDialog?.options.requiresHold ?? (confirmDialog?.options.variant === 'danger');

  return (
    <ToastContext.Provider value={{ showToast, toast, confirm, isSoundEnabled, toggleSound, playSfx }}>
      {children}

      {/* 1. TOAST NOTIFICATION CONTAINER (Fixed Top-Right) */}
      <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none select-none">
        {toasts.map((t) => {
          const config = {
            success: {
              icon: <CheckCircle2 className="w-5 h-5 text-tactical-emerald shrink-0" />,
              border: 'border-tactical-emerald/40',
              glow: 'shadow-[0_0_15px_rgba(16,185,129,0.15)]',
              tagBg: 'bg-tactical-emerald/10 text-tactical-emerald',
              title: t.title || 'Thành công',
            },
            error: {
              icon: <XCircle className="w-5 h-5 text-tactical-red shrink-0" />,
              border: 'border-tactical-red/40',
              glow: 'shadow-[0_0_15px_rgba(239,68,68,0.15)]',
              tagBg: 'bg-tactical-red/10 text-tactical-red',
              title: t.title || 'Lỗi',
            },
            warning: {
              icon: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
              border: 'border-amber-400/40',
              glow: 'shadow-[0_0_15px_rgba(251,191,36,0.15)]',
              tagBg: 'bg-amber-400/10 text-amber-400',
              title: t.title || 'Cảnh báo',
            },
            info: {
              icon: <Info className="w-5 h-5 text-tactical-cyan shrink-0" />,
              border: 'border-tactical-cyan/40',
              glow: 'shadow-[0_0_15px_rgba(0,229,255,0.15)]',
              tagBg: 'bg-tactical-cyan/10 text-tactical-cyan',
              title: t.title || 'Thông tin',
            },
          }[t.type];

          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-2xl bg-titanium-50/95 dark:bg-obsidian-900/95 border ${config.border} ${config.glow} shadow-xl backdrop-blur-xl transition-all animate-in slide-in-from-top-2 fade-in duration-200 motion-reduce:animate-none`}
            >
              <div className="mt-0.5">{config.icon}</div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-900 dark:text-white font-sans">
                    {config.title}
                  </span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 font-mono leading-relaxed break-words">
                  {t.message}
                </p>
              </div>

              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="p-1 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* 2. TACTICAL CONFIRMATION MODAL WITH HOLD-TO-CONFIRM SAFETY */}
      {confirmDialog?.isOpen && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150 select-none motion-reduce:animate-none">
          <div className="relative w-full max-w-md bg-titanium-50 dark:bg-obsidian-900 border border-slate-300 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden p-6">

            {/* Top Accent Glow */}
            <div
              className={`absolute top-0 left-0 right-0 h-1.5 ${
                confirmDialog.options.variant === 'danger'
                  ? 'bg-gradient-to-r from-red-600 via-rose-500 to-amber-500'
                  : confirmDialog.options.variant === 'warning'
                  ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                  : 'bg-gradient-to-r from-tactical-blue to-tactical-cyan'
              }`}
            />

            {/* Header with Icon */}
            <div className="flex items-start gap-3.5 mb-4">
              <div
                className={`p-3 rounded-2xl ${
                  confirmDialog.options.variant === 'danger'
                    ? 'bg-tactical-red/10 text-tactical-red'
                    : confirmDialog.options.variant === 'warning'
                    ? 'bg-amber-400/10 text-amber-400'
                    : 'bg-tactical-cyan/10 text-tactical-cyan'
                }`}
              >
                {confirmDialog.options.variant === 'danger' ? (
                  <AlertOctagon className="w-6 h-6" />
                ) : confirmDialog.options.variant === 'warning' ? (
                  <AlertTriangle className="w-6 h-6" />
                ) : (
                  <ShieldAlert className="w-6 h-6" />
                )}
              </div>

              <div className="flex-1">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white uppercase tracking-wider font-sans">
                  {confirmDialog.options.title || 'XÁC NHẬN LỆNH TÁC CHIẾN'}
                </h3>
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase mt-0.5">
                  <Lock className="w-3 h-3 text-amber-500" />
                  <span>
                    {requiresHold ? 'Yêu cầu nhấn giữ 1.2s an toàn' : 'Xác nhận ủy quyền lệnh'}
                  </span>
                </div>
              </div>
            </div>

            {/* Message Body */}
            <div className="p-3.5 mb-5 rounded-2xl bg-slate-100 dark:bg-obsidian-950 border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-800 dark:text-slate-200 font-mono leading-relaxed">
                {confirmDialog.options.message}
              </p>
            </div>

            {/* Hold instructions banner if hold required */}
            {requiresHold && (
              <div className="mb-4 text-[11px] font-mono flex items-center justify-between text-slate-600 dark:text-slate-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl">
                <span>Cơ chế bảo vệ 2 bước:</span>
                <span className="font-bold text-amber-600 dark:text-amber-400">
                  {isHolding ? `Đang giữ: ${holdProgress}%` : 'Nhấn giữ phím xác nhận 1.2s'}
                </span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  resetHold();
                  confirmDialog.resolve(false);
                }}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none"
              >
                {confirmDialog.options.cancelText || 'Hủy Bỏ'}
              </button>

              {requiresHold ? (
                /* Hold-to-confirm Button with live fill progress */
                <button
                  type="button"
                  onMouseDown={startHold}
                  onMouseUp={resetHold}
                  onMouseLeave={resetHold}
                  onTouchStart={startHold}
                  onTouchEnd={resetHold}
                  className="relative overflow-hidden flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-xl text-white text-xs font-bold shadow-lg transition-all cursor-pointer select-none bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 shadow-red-600/25 active:scale-95 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none min-w-[170px]"
                >
                  {/* Progress Fill Bar */}
                  <div
                    className="absolute inset-0 bg-white/30 backdrop-invert-0 transition-all ease-linear"
                    style={{ width: `${holdProgress}%` }}
                  />
                  <span className="relative z-10">
                    {isHolding ? `GIỮ... ${holdProgress}%` : confirmDialog.options.confirmText || 'NHẤN GIỮ ĐỂ PHÁT LỆNH'}
                  </span>
                  <Lock className="relative z-10 w-3.5 h-3.5" />
                </button>
              ) : (
                /* Instant Click Button for non-critical confirmation */
                <button
                  type="button"
                  onClick={() => confirmDialog.resolve(true)}
                  className={`flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-white text-xs font-bold shadow-lg transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none ${
                    confirmDialog.options.variant === 'danger'
                      ? 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 shadow-red-600/25'
                      : confirmDialog.options.variant === 'warning'
                      ? 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-yellow-500 shadow-amber-600/25'
                      : 'bg-gradient-to-r from-tactical-blue to-cyan-500 hover:opacity-95 shadow-cyan-500/25'
                  }`}
                >
                  <span>{confirmDialog.options.confirmText || 'Xác Nhận Phát Lệnh'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

          </div>
        </div>
      )}

    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
