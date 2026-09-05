import React, { useState } from 'react';
import { X, KeyRound, Check, Info, ShieldAlert, Cpu } from 'lucide-react';
import { apiClaimDrone } from '../../services/api';
import { useToast } from '../../context/ToastContext';

interface ClaimDroneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ClaimDroneModal: React.FC<ClaimDroneModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { toast } = useToast();
  const [deviceId, setDeviceId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = deviceId.trim().toUpperCase();
    if (!cleanId) {
      setErrorMsg('Vui lòng nhập Mã định danh Drone (Device ID)!');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const res = await apiClaimDrone(cleanId);
      toast.success(
        res.message || `Đã thêm Drone [${cleanId}] vào danh sách quyền quản lý của bạn thành công!`,
        'Nhận Quyền Drone'
      );
      setDeviceId('');
      onSuccess();
      onClose();
    } catch (err: any) {
      const msg = err.message || 'Không thể nhận quyền Drone này';
      setErrorMsg(msg);
      toast.error(msg, 'Lỗi Nhận Quyền');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="claim-drone-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150 select-none"
    >
      <div className="relative w-full max-w-md bg-[#F4F1EA] dark:bg-obsidian-900 border border-slate-300/80 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden p-6">

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-300/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-tactical-blue/10 dark:bg-tactical-cyan/10 text-tactical-blue dark:text-tactical-cyan border border-tactical-blue/20 dark:border-tactical-cyan/20">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 id="claim-drone-title" className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider font-sans">
                Nhận Quyền Quản Lý Drone
              </h3>
              <p className="text-[10px] font-mono text-slate-400">
                Pilot Fleet Assignment • C2 Ownership
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-tactical-cyan focus-visible:outline-none"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hướng Dẫn Tác Chiến & Nguyên Tắc Vận Hành */}
        <div className="mt-3.5 p-3 rounded-2xl bg-tactical-blue/5 dark:bg-tactical-cyan/5 border border-tactical-blue/20 dark:border-tactical-cyan/20">
          <div className="flex items-start gap-2.5">
            <Info className="w-4 h-4 text-tactical-blue dark:text-tactical-cyan shrink-0 mt-0.5" />
            <div className="space-y-1 text-slate-600 dark:text-slate-300 font-sans text-xs leading-relaxed">
              <p className="font-bold text-slate-800 dark:text-slate-100 text-[11px] uppercase tracking-wide">
                Hướng Dẫn Phi Công
              </p>
              <p className="text-[11px]">
                Nhập <b>Mã định danh duy nhất (Device ID)</b> được in trên tem Companion Computer / thân vỏ Drone hoặc do Kỹ thuật viên cung cấp (ví dụ: <span className="font-mono font-bold text-tactical-blue dark:text-tactical-cyan">DRONE-001</span>).
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-0.5">
                Sau khi nhận quyền, Drone sẽ xuất hiện trên PFD, Bản đồ chiến thuật và Bảng phi đội của bạn.
              </p>
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mt-3 p-3 rounded-xl bg-tactical-red/10 border border-tactical-red/30 text-tactical-red text-xs flex items-start gap-2 animate-in fade-in">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Lỗi Nhận Quyền</div>
              <div className="text-[11px] opacity-90">{errorMsg}</div>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          <div>
            <label htmlFor="claim-device-id" className="block text-slate-700 dark:text-slate-300 font-semibold mb-1.5">
              Mã Device ID Drone tác chiến:
            </label>
            <div className="relative flex items-center">
              <Cpu className="w-4 h-4 absolute left-3 text-slate-400 pointer-events-none" />
              <input
                id="claim-device-id"
                type="text"
                autoFocus
                required
                placeholder="VD: DRONE-001, DRONE-002..."
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value.toUpperCase())}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-100 dark:bg-obsidian-950 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-white font-mono font-bold uppercase tracking-wider focus:outline-none focus:border-tactical-blue dark:focus:border-tactical-cyan focus:ring-1 focus:ring-tactical-cyan"
              />
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
              * Phân biệt chữ hoa/thường tự động hóa. Đảm bảo Drone đã được bật nguồn và kết nối mạng.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer font-medium"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !deviceId.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-tactical-blue to-cyan-500 hover:from-tactical-blue/90 hover:to-cyan-400 text-white font-semibold transition-all cursor-pointer disabled:opacity-50 shadow-md shadow-cyan-500/10 active:scale-[0.98]"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Đang xác thực...' : 'Nhận Quyền Điều Khiển'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
