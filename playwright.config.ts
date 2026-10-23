import { defineConfig } from '@playwright/test'
try {
  process.loadEnvFile('.env')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '/tmp/prts-playwright-results',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    channel: 'msedge',
    headless: false,
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1000 },
    // Authentication requests include credentials; do not capture them in traces.
    trace: 'off',
  },
})
