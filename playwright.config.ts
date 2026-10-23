import { defineConfig } from '@playwright/test'
// Browser tests never read credentials or write to the user's running database.
process.env.PRTS_PASSWORD = 'prts-e2e-test-password-only'
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '/tmp/prts-playwright-results',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'node tests/support/server.mjs',
    url: 'http://127.0.0.1:8791/api/auth/session',
    reuseExistingServer: false,
    timeout: 30000,
  },
  use: {
    channel: 'msedge',
    headless: false,
    baseURL: 'http://127.0.0.1:8791',
    viewport: { width: 1440, height: 1000 },
    // Authentication requests include credentials; do not capture them in traces.
    trace: 'off',
  },
})
