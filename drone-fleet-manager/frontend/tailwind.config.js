/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        tactical: {
          cyan: '#00E5FF',
          blue: '#0284C7',
          emerald: '#10B981',
          amber: '#F59E0B',
          red: '#EF4444',
          glow: 'rgba(0, 229, 255, 0.15)',
        },
        obsidian: {
          950: '#0B1120', // Deep Aerospace Navy background (thay thế màu đen kịt)
          900: '#131D31', // Deep Aerospace Navy card surface (khối thẻ nổi)
          850: '#172239', // Elevated surface
          800: '#1E293B', // Viền Slate Navy
          700: '#2D3D5E', // Viền sáng
        },
        titanium: {
          50: '#F8FAFC',  // Nền thẻ sáng (Slate-50 ngà nhạt, thay cho trắng tinh)
          100: '#EEF2F6', // Nền ứng dụng sáng (Warm Titanium dịu mắt)
          200: '#E2E8F0', // Nền hover
          300: '#CBD5E1', // Viền bạc Titan
          400: '#94A3B8', // Chữ phụ mờ
          700: '#334155', // Chữ phụ
          800: '#1E293B', // Chữ đậm
          900: '#0F172A', // Chữ chính (Slate Navy thẫm)
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'glow-cyan': '0 0 20px -3px rgba(0, 229, 255, 0.3)',
        'glow-emerald': '0 0 20px -3px rgba(16, 185, 129, 0.3)',
        'glow-red': '0 0 20px -3px rgba(239, 68, 68, 0.3)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'radar-sweep': 'radar 4s linear infinite',
      },
      keyframes: {
        radar: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
    },
  },
  plugins: [],
};

