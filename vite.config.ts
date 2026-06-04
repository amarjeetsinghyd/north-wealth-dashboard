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
      }
    }
  },
  preview: { host: true, port: 4173 },
})
