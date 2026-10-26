import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { prtsPwa } from './scripts/pwa'
import { getAppVersion } from './scripts/version'
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(
      getAppVersion(fileURLToPath(new URL('.', import.meta.url)), process.env.PRTS_VERSION),
    ),
  },
  // Game resources are downloaded into data/assets, never bundled into a deployment.
  publicDir: 'static',
  plugins: [react(), prtsPwa()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/assets/amiya.png': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/assets/priestess.png': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/assets/kaltsit.png': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/assets/corpus-images': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
})
