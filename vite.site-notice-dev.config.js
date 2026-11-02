import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: 'client', plugins: [react()], server: { host: '127.0.0.1', port: 61421, strictPort: true,
  fs: { deny: ['.env', '.env.*', '**/.git/**', '**/validation.local/**', '**/*.private.*'] },
  proxy: { '/api': 'http://127.0.0.1:61422' } } });
