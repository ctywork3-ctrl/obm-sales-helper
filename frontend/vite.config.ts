import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'path'

const useHttps = process.env.VITE_HTTPS === 'true'

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    host: true,
    https: useHttps ? {} : undefined,
    // Vite rejects requests whose Host header it does not recognise ("Blocked
    // request"), which is exactly what a tunnel produces: the browser asks for
    // the public hostname while Vite thinks it is localhost. Both the throwaway
    // quick-tunnel domain and the company's own domain are allowed here.
    allowedHosts: ['.trycloudflare.com', '.hipercom.com.my'],
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})
