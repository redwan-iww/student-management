import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

// Two Zoho web tabs -> two HTML entry points. A web tab is a standalone page in
// the CRM nav, not a panel on a record, so each gets its own bundle and its own
// subject picker (there is no record context to inherit).
//
// `base: './'` matters: Zoho serves the widget from inside its own frame, so an
// absolute /assets/... path would 404.
export default defineConfig({
  plugins: [react()],
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
});
