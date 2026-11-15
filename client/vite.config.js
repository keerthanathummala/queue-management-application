import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE is set for the GitHub Pages build, which is served from /<repo-name>/.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
    // The demo build imports the shared queue/analytics modules from ../server/src.
    fs: { allow: ['..'] },
  },
});
