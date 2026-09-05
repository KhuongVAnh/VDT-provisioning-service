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
          950: '#12151B', // Gunmetal Slate background (Xám than chì ấm, hoàn toàn khử ám xanh)
          900: '#1A202C', // Gunmetal Card surface (Đá phiến sẫm trung tính)
          850: '#222B3C', // Elevated surface
          800: '#2D3748', // Viền khung kim loại công nghiệp
          700: '#4A5568', // Viền sáng
        },
        titanium: {
          50: '#F4F1EA',  // Nền thẻ sáng (Màu giấy can ngà nhám nhẹ, Tactical Parchment)
          100: '#EAE6DF', // Nền ứng dụng sáng (Tone cát sa mạc / giấy bản đồ dã chiến)
          200: '#E0DBD0', // Nền hover
          300: '#D3CCC0', // Viền màu đá ấm
          400: '#A39C90', // Chữ phụ mờ
          700: '#736D64', // Chữ phụ
          800: '#3D3933', // Chữ đậm
          900: '#24221E', // Chữ chính (Đen than củi, triệt tiêu 100% độ lóa)
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

