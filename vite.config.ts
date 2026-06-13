import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { 
    host: true,
    proxy: {
      '/api/finance': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/finance/, '')
      },
      '/api/cmots': {
        target: 'https://invesmateapis.cmots.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/cmots/, '')
      },
      '/api/nse': {
        target: 'https://archives.nseindia.com',
        changeOrigin: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        rewrite: (path) => path.replace(/^\/api\/nse/, '')
      }
    }
  },
  preview: { host: true, port: 4173 },
})
