import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5183,
    proxy: {
      '/api': 'http://127.0.0.1:8010',
      '/sanctum': 'http://127.0.0.1:8010',
      '/login': 'http://127.0.0.1:8010',
      '/logout': 'http://127.0.0.1:8010',
    },
  },
})
