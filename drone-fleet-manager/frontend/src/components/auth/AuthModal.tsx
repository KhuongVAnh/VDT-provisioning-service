import React, { useState } from 'react';
import { Plane, Lock, Mail, User, ShieldCheck, ArrowRight, UserPlus, Sun, Moon, Zap } from 'lucide-react';
import { apiLogin, apiRegister } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

export const AuthModal: React.FC = () => {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('admin@gmail.com');
  const [password, setPassword] = useState('admin');
  const [fullName, setFullName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    try {
      if (tab === 'login') {
        const { token, user } = await apiLogin(email.trim(), password);
        login(token, user);
      } else {
        if (!fullName.trim()) {
          setErrorMsg('Vui lòng nhập họ tên phi công');
          setIsLoading(false);
          return;
        }
        const { token, user } = await apiRegister(email.trim(), password, fullName.trim());
        login(token, user);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Thao tác không thành công');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDemoLogin = async () => {
    setEmail('admin@gmail.com');
    setPassword('admin');
    setErrorMsg('');
    setIsLoading(true);

    try {
      const { token, user } = await apiLogin('admin@gmail.com', 'admin');
      login(token, user);
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi đăng nhập nhanh. Vui lòng kiểm tra NestJS backend');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-slate-900 dark:bg-obsidian-950 text-slate-100 relative overflow-hidden select-none">

      {/* High-tech Background Tactical Grid & Ambient Glows */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b33_1px,transparent_1px),linear-gradient(to_bottom,#1e293b33_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-tactical-blue/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-tactical-cyan/15 rounded-full blur-[120px] pointer-events-none" />

      {/* Top Bar with System Status & Theme Switcher */}
      <header className="absolute top-0 left-0 right-0 p-4 sm:px-8 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-tactical-cyan animate-pulse" />
          <span className="font-mono text-xs text-slate-400 font-semibold tracking-wider uppercase">
            BVLOS TACTICAL GATEWAY v2.0
          </span>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Chuyển sang Chế độ Sáng' : 'Chuyển sang Chế độ Tối'}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-slate-200 text-xs font-mono transition-colors cursor-pointer backdrop-blur-md"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>LIGHT MODE</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-slate-300" />
              <span>DARK MODE</span>
            </>
          )}
        </button>
      </header>

      {/* Central Login / Register Bento Card */}
      <div className="relative w-full max-w-md bg-white/95 dark:bg-obsidian-900/95 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 overflow-hidden backdrop-blur-xl z-10 transition-all">

        {/* Top Glow Accent Bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-tactical-blue via-tactical-cyan to-tactical-emerald" />

        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="relative flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-tactical-blue to-cyan-500 text-white shadow-glow-cyan shadow-tactical-cyan/20 mb-3">
            <Plane className="w-7 h-7 -rotate-45" />
            <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-tactical-cyan animate-ping" />
          </div>
          <h2 className="text-xl font-extrabold tracking-wider text-slate-900 dark:text-white uppercase font-sans">
            DRONE MISSION CONTROL
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
            Trạm Điều Khiển Phi Đội Drone & An Ninh Tác Chiến
          </p>
        </div>

        {/* Quick Demo 1-Click Button */}
        <button
          type="button"
          onClick={handleQuickDemoLogin}
          disabled={isLoading}
          className="w-full mb-5 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-tactical-cyan/15 hover:bg-tactical-cyan/25 border border-tactical-cyan/40 text-tactical-cyan font-mono text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
        >
          <Zap className="w-4 h-4 text-tactical-cyan fill-tactical-cyan" />
          <span>ĐĂNG NHẬP NHANH (DEMO 1-CLICK)</span>
        </button>

        {/* Tab Switcher */}
        <div className="flex p-1 mb-5 bg-slate-100 dark:bg-obsidian-950 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold">
          <button
            type="button"
            onClick={() => { setTab('login'); setErrorMsg(''); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all cursor-pointer ${tab === 'login'
              ? 'bg-white dark:bg-slate-800 text-tactical-blue dark:text-tactical-cyan shadow-sm font-bold'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>ĐĂNG NHẬP</span>
          </button>
          <button
            type="button"
            onClick={() => { setTab('register'); setErrorMsg(''); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-all cursor-pointer ${tab === 'register'
              ? 'bg-white dark:bg-slate-800 text-tactical-blue dark:text-tactical-cyan shadow-sm font-bold'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>ĐĂNG KÝ PHI CÔNG</span>
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-tactical-red/10 border border-tactical-red/30 text-tactical-red text-xs">
            {errorMsg}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {tab === 'register' && (
            <div>
              <label className="block text-slate-600 dark:text-slate-400 font-medium mb-1">
                Họ và Tên Phi Công
              </label>
              <div className="relative flex items-center">
                <User className="w-4 h-4 absolute left-3.5 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="Phi công Nguyễn Văn A"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-obsidian-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-tactical-blue dark:focus:border-tactical-cyan"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-slate-600 dark:text-slate-400 font-medium mb-1">
              Email Tài Khoản
            </label>
            <div className="relative flex items-center">
              <Mail className="w-4 h-4 absolute left-3.5 text-slate-400" />
              <input
                type="email"
                required
                placeholder="admin@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-obsidian-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-tactical-blue dark:focus:border-tactical-cyan font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-600 dark:text-slate-400 font-medium mb-1">
              Mật Khẩu Tác Chiến
            </label>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 absolute left-3.5 text-slate-400" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-obsidian-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-tactical-blue dark:focus:border-tactical-cyan font-mono"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-tactical-blue to-cyan-500 text-white font-bold tracking-wide hover:opacity-95 transition-opacity shadow-lg shadow-tactical-blue/20 cursor-pointer disabled:opacity-50"
          >
            <span>{isLoading ? 'ĐANG XỬ LÝ...' : tab === 'login' ? 'ĐĂNG NHẬP HỆ THỐNG' : 'HOÀN TẤT ĐĂNG KÝ'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-5 text-center text-[11px] text-slate-400 font-mono">
          Tài khoản mặc định: <b className="text-tactical-blue dark:text-tactical-cyan">admin@gmail.com</b> / <b className="text-tactical-blue dark:text-tactical-cyan">admin</b>
        </div>

      </div>

      {/* Footer System Credits */}
      <footer className="absolute bottom-3 text-center text-[10px] font-mono text-slate-500 z-10">
        Tactical Drone Fleet Management System &copy; 2026
      </footer>

    </div>
  );
};
