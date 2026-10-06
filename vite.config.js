import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: { ignored: ['**/.vercel/**', '**/data/**', '**/backups/**', '**/*.log'] },
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || `http://127.0.0.1:${process.env.PORT || 3000}`,
        // Preserve the browser-facing Host so server origin checks see the
        // same origin as the POST request (Vite string targets rewrite Host).
        changeOrigin: false,
      },
      '/socket.io': {
        target: process.env.API_PROXY_TARGET || `http://127.0.0.1:${process.env.PORT || 3000}`,
        ws: true,
        changeOrigin: false,
      },
    },
  },
})
