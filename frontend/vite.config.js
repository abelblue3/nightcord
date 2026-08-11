import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        rooms: resolve(import.meta.dirname, 'rooms.html'),
        room: resolve(import.meta.dirname, 'room.html'),
        verify: resolve(import.meta.dirname, 'verify.html'),
      },
    },
  },
});
