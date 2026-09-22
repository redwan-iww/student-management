import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { zohoProxy } from './vite-zoho-proxy';

// Two Zoho web tabs -> two HTML entry points. A web tab is a standalone page in
// the CRM nav, not a panel on a record, so each gets its own bundle and its own
// subject picker (there is no record context to inherit).
//
// `base: './'` matters: Zoho serves the widget from inside its own frame, so an
// absolute /assets/... path would 404.
export default defineConfig(({ mode }) => {
  // Third arg '' loads every var, not just VITE_-prefixed ones: the OAuth
  // credentials are read here in Node and must never reach the browser bundle.
  const env = loadEnv(mode, process.cwd(), '');

  return {
  plugins: [
    react(),
    zohoProxy({
      clientId: env.ZOHO_CLIENT_ID,
      clientSecret: env.ZOHO_CLIENT_SECRET,
      refreshToken: env.ZOHO_REFRESH_TOKEN,
      dc: env.ZOHO_DC,
    }),
  ],
  base: './',
  // Port 3000, not Vite's default 5173. `strictPort` makes a clash fail loudly
  // instead of silently moving to 3001 -- a widget URL registered in Zoho points
  // at one port, so a silent shift would just 404 inside the CRM frame.
  server: { port: 3000, strictPort: true },
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
      },
    },
  },
  };
});
