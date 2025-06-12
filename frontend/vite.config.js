import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://chatify-backend-sh82.onrender.com',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'https://chatify-backend-sh82.onrender.com',
        ws: true,
      },
      '/uploads': {
        target: 'https://chatify-backend-sh82.onrender.com',
        changeOrigin: true,
        secure: false,
      }
    },
  },
});
