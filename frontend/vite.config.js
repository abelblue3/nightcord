import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        rooms: resolve(__dirname, 'rooms.html'),
        room: resolve(__dirname, 'room.html'),
      },
    },
  },
});
