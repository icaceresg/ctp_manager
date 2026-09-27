import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.PORT) || 3210;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
});
