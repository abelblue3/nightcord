import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
  // `npm run dev` keeps hot reload while API calls and the chat socket go
  // through the Ruby web layer (web/, port 4567), exactly as in production.
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4567', ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        rooms: resolve(import.meta.dirname, 'rooms.html'),
        room: resolve(import.meta.dirname, 'room.html'),
        profile: resolve(import.meta.dirname, 'profile.html'),
        terms: resolve(import.meta.dirname, 'terms.html'),
        privacy: resolve(import.meta.dirname, 'privacy.html'),
      },
    },
  },
});
