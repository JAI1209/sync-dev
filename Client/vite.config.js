import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: true,   // ✅ use this (more reliable than 'all')
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})