import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { prtsPwa } from './scripts/pwa'
export default defineConfig({
  // Game resources are downloaded into data/assets, never bundled into a deployment.
  publicDir: 'static',
  plugins: [react(), prtsPwa()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/assets/amiya.png': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/assets/corpus-images': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
})
