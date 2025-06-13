import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // API routes proxy
      '/api': {
        target: 'https://chatify-backend-sh82.onrender.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      
      // Socket.IO proxy
      '/socket.io': {
        target: 'https://chatify-backend-sh82.onrender.com',
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      
      // Uploads proxy
      '/uploads': {
        target: 'https://chatify-backend-sh82.onrender.com',
        changeOrigin: true,
        secure: false,
      }
    },
  },
  // Optional: Configure WebSocket connection for HMR
  build: {
    target: 'esnext' // For better WebSocket support
  }
});
