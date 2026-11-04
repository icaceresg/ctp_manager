import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.PORT) || 3210;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  optimizeDeps: { exclude: ['@jsquash/webp'] },
  worker: { format: 'es' },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // La escena 3D de la ruleta (three.js) va en su propio fragmento.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: 'client/index.html',
        ruleta: 'client/ruleta.html',
      },
    },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
});
