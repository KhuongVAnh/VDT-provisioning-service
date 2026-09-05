import React, { useState } from 'react';
import { X, Plus, ShieldCheck, Cpu, Network, Check, Info, AlertTriangle } from 'lucide-react';
import { registerManualDevice } from '../../services/api';
import { useToast } from '../../context/ToastContext';

interface ManualRegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ManualRegisterModal: React.FC<ManualRegisterModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { toast } = useToast();
  const [deviceId, setDeviceId] = useState('');
  const [vpnIp, setVpnIp] = useState('');
  const [hardwareModel, setHardwareModel] = useState('Raspberry Pi 4 / SIM8260E');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceId.trim() || !vpnIp.trim()) {
      setErrorMsg('Vui lòng nhập đầy đủ Mã Drone và IP VPN (10.13.37.X)!');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      await registerManualDevice(deviceId.trim(), vpnIp.trim(), hardwareModel.trim());
      toast.success(`Đã ghi danh thiết bị "${deviceId.trim()}" (${vpnIp.trim()}) thành công vào phi đội!`, 'Ghi Danh Thành Công');
      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi khi ghi danh thiết bị');
      toast.error(err.message || 'Không thể ghi danh thiết bị', 'Lỗi Ghi Danh');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150 select-none">
      <div className="relative w-full max-w-md bg-[#F4F1EA] dark:bg-obsidian-900 border border-slate-300/80 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden p-6">

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-300/80 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-tactical-blue/10 dark:bg-tactical-cyan/10 text-tactical-blue dark:text-tactical-cyan">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider font-sans">
                Cấp Phát Phần Cứng WireGuard
              </h3>
              <p className="text-[10px] font-mono text-slate-400">
                Hardware Subnet Provisioning • Dành cho Admin
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Chú thích & Hướng dẫn Tác chiến (Mục đích tính năng & Cảnh báo an toàn) */}
        <div className="mt-3.5 p-3 rounded-2xl bg-tactical-blue/5 dark:bg-tactical-cyan/5 border border-tactical-blue/20 dark:border-tactical-cyan/20">
          <div className="flex items-start gap-2.5">
            <Info className="w-4 h-4 text-tactical-blue dark:text-tactical-cyan shrink-0 mt-0.5" />
            <div className="space-y-1 text-slate-600 dark:text-slate-300 font-sans text-xs leading-relaxed">
              <p className="font-bold text-slate-800 dark:text-slate-100 text-[11px] uppercase tracking-wide">
                Mục đích & Cảnh báo tác chiến
              </p>
              <p className="text-[11px]">
                Chức năng này dùng để <b>đăng ký thủ công</b> thiết bị Drone (hoặc Companion Computer) vào mạng riêng ảo WireGuard (<span className="font-mono font-bold text-tactical-blue dark:text-tactical-cyan">10.13.37.X</span>) khi thiết bị không sử dụng Auto-Provisioning.
              </p>
              <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium pt-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Cảnh báo: Đảm bảo IP VPN không bị trùng với các Drone khác đang bay trong phi đội.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mt-3 p-2.5 rounded-xl bg-tactical-red/10 border border-tactical-red/30 text-tactical-red text-xs">
            {errorMsg}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 text-xs">
          <div>
            <label className="block text-slate-600 dark:text-slate-400 font-medium mb-1">
              Mã Device ID (ví dụ: DRONE-001):
            </label>
            <div className="relative flex items-center">
              <ShieldCheck className="w-4 h-4 absolute left-3 text-slate-400" />
              <input
                type="text"
                required
                placeholder="DRONE-001"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-100 dark:bg-obsidian-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:border-tactical-blue dark:focus:border-tactical-cyan"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-600 dark:text-slate-400 font-medium mb-1">
              Địa chỉ IP VPN (10.13.37.X):
            </label>
            <div className="relative flex items-center">
              <Network className="w-4 h-4 absolute left-3 text-slate-400" />
              <input
                type="text"
                required
                placeholder="10.13.37.2"
                value={vpnIp}
                onChange={(e) => setVpnIp(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-100 dark:bg-obsidian-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:border-tactical-blue dark:focus:border-tactical-cyan"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-600 dark:text-slate-400 font-medium mb-1">
              Model Phần Cứng & SBC:
            </label>
            <div className="relative flex items-center">
              <Cpu className="w-4 h-4 absolute left-3 text-slate-400" />
              <input
                type="text"
                placeholder="Raspberry Pi 4 / SIM8260E 5G"
                value={hardwareModel}
                onChange={(e) => setHardwareModel(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-100 dark:bg-obsidian-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 font-sans focus:outline-none focus:border-tactical-blue dark:focus:border-tactical-cyan"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-tactical-blue to-cyan-500 text-white font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Đang lưu...' : 'Lưu Thiết Bị'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};

