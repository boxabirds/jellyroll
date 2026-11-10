import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built site works from any folder or sub-path.
  base: './',
  server: {
    // Reachable from outside the machine and from hosted preview domains (Replit, tunnels).
    host: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});
