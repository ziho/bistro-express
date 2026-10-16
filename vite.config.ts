import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The whole app lives under /bistro/ — keep in sync with shared/constants.ts.
// In dev, the API is proxied to the internal (admin) listener, which also serves guest features.
const devTarget = process.env.BISTRO_DEV_API ?? 'http://127.0.0.1:3101';

export default defineConfig({
  root: 'web',
  base: '/bistro/',
  publicDir: 'public',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/bistro/api': { target: devTarget, changeOrigin: false },
    },
  },
});
