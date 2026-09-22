import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

// Two pages -> two HTML entry points, each with its own bundle and its own
// subject picker.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
  plugins: [
    react(),
  ],
  base: './',
  // strictPort so a clash fails loudly instead of silently moving to 3001 --
  // which is where the API server lives.
  server: {
    port: 3000,
    strictPort: true,
    // The local API (npm run server). Same-origin in dev, so the browser
    // client needs no base URL and no CORS. Swapping to Supabase later means
    // pointing the client at its URL instead -- the request shape is the same.
    proxy: {
      '/api': {
        target: env.API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: { port: 3000, strictPort: true },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        'class-allocation': resolve(__dirname, 'class-allocation.html'),
        'attendance-manager': resolve(__dirname, 'attendance-manager.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  };
});
