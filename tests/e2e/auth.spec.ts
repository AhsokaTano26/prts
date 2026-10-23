import { test, expect, type Page } from '@playwright/test'

async function login(page: Page) {
  const password = process.env.PRTS_PASSWORD
  if (!password) throw new Error('请在 .env 或环境变量中配置 PRTS_PASSWORD 后运行 Edge 验收。')
  await expect(page.getByRole('heading', { name: '终端访问验证', exact: true })).toBeVisible()
  await page.getByLabel('访问密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '验证并进入', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
})

test('deep links and forged local flags cannot reveal the workspace before login', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('prts-authenticated', 'true')
    localStorage.setItem('prts-session', 'forged-session')
  })
  await page.goto('/#notes')
  await expect(page.getByRole('heading', { name: '终端访问验证', exact: true })).toBeVisible()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('prts-workspace-v1'))).toBeNull()
  expect((await page.request.get('/api/health')).status()).toBe(401)
  expect(
    (
      await page.request.post('/api/chat', {
        data: { messages: [{ role: 'user', content: 'hello' }] },
      })
    ).status(),
  ).toBe(401)
})

test('password login, refresh, explicit lock and new login preserve workspace data', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.getByLabel('访问密码', { exact: true }).fill('deliberately-incorrect-test-password')
  await page.getByRole('button', { name: '验证并进入', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('密码')
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await login(page)
  await expect(page.getByRole('heading', { name: '欢迎回来，博士。' })).toBeVisible()
  const cookies = await context.cookies()
  const cookie = cookies.find((item) => item.name === 'prts_session')
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.sameSite).toBe('Strict')
  await page.reload()
  await expect(page.locator('.sidebar')).toBeVisible()
  await page.getByRole('button', { name: '锁定终端', exact: true }).click()
  await expect(page.getByRole('heading', { name: '终端访问验证', exact: true })).toBeVisible()
  expect((await page.request.get('/api/health')).status()).toBe(401)
  expect(await page.evaluate(() => localStorage.getItem('prts-workspace-v1'))).not.toBeNull()
  await login(page)
  await expect(page.locator('.sidebar')).toBeVisible()
})

test('revoked session locks an open tab when it becomes visible again', async ({ page }) => {
  await page.goto('/')
  await login(page)
  await expect(page.locator('.sidebar')).toBeVisible()
  await page.request.post('/api/auth/logout')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: '终端访问验证', exact: true })).toBeVisible()
  await expect(page.locator('.sidebar')).toHaveCount(0)
})

test('failed logout remains locked across reload and retries revocation before entry', async ({
  page,
}) => {
  await page.goto('/')
  await login(page)
  await expect(page.locator('.sidebar')).toBeVisible()
  await page.route('**/api/auth/logout', (route) => route.abort())
  await page.getByRole('button', { name: '锁定终端', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新连接', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '重新连接', exact: true })).toBeVisible()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await page.unroute('**/api/auth/logout')
  await page.getByRole('button', { name: '重新连接', exact: true }).click()
  await expect(page.getByRole('heading', { name: '终端访问验证', exact: true })).toBeVisible()
  expect((await page.request.get('/api/health')).status()).toBe(401)
})

test('locking one tab also removes the workspace from another open tab', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await login(page)
  await expect(page.locator('.sidebar')).toBeVisible()
  const other = await context.newPage()
  await other.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await other.goto('/#notes')
  await expect(other.locator('.sidebar')).toBeVisible()
  await page.getByRole('button', { name: '锁定终端', exact: true }).click()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await expect(other.locator('.sidebar')).toHaveCount(0)
  await expect(other.getByRole('heading', { name: '终端访问验证', exact: true })).toBeVisible()
})

test('lock received while login is pending wins over the late login response', async ({
  page,
  context,
}) => {
  await page.goto('/')
  const other = await context.newPage()
  await other.goto('/')
  let release!: () => void
  let responseReady!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    responseReady = resolve
  })
  await page.route('**/api/auth/login', async (route) => {
    const response = await route.fetch()
    responseReady()
    await held
    await route.fulfill({ response })
  })
  await page.evaluate(() =>
    window.addEventListener(
      'storage',
      () => {
        document.documentElement.dataset.lockReceived = 'yes'
      },
      { once: true },
    ),
  )
  await login(page)
  await ready
  await other.evaluate(() => localStorage.setItem('prts-lock-required', '1'))
  await expect(page.locator('html')).toHaveAttribute('data-lock-received', 'yes')
  release()
  await expect(page.getByRole('button', { name: '验证并进入', exact: true })).toBeEnabled()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  expect((await page.request.get('/api/health')).status()).toBe(401)
})

for (const width of [1440, 390, 320]) {
  test(`login layout ${width}px stays readable without overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
    await page.goto('/')
    await expect(page.getByLabel('访问密码', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '验证并进入', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page
      .locator('.auth-panel-content')
      .evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)))
    await page.screenshot({ path: `/tmp/prts-login-${width}.png`, fullPage: true })
  })
}

test('missing server password and unavailable auth service remain locked', async ({ page }) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { configured: false, authenticated: false } }),
  )
  await page.goto('/')
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await expect(page.getByText(/PRTS_PASSWORD/)).toBeVisible()
  await expect(page.getByRole('button', { name: '验证并进入', exact: true })).toHaveCount(0)
  await page.unroute('**/api/auth/session')
  await page.route('**/api/auth/session', (route) => route.abort())
  await page.reload()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新连接', exact: true })).toBeVisible()
})
