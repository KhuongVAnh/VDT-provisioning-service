import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:10004',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:10004',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});

