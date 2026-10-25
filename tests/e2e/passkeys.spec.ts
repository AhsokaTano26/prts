import { test, expect, waitSaved } from './fixture'

const origin = 'http://localhost:8791'
const password = 'prts-e2e-test-password-only'
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
})
async function authenticator(page: import('@playwright/test').Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return { cdp, authenticatorId }
}
async function register(page: import('@playwright/test').Page) {
  await page.goto(`${origin}/#settings/security`)
  await page.getByLabel('访问密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '验证并进入', exact: true }).click()
  const settings = page.getByRole('region', { name: 'Passkey 设置', exact: true })
  await expect(settings).toBeVisible()
  await settings.getByLabel('Passkey 名称', { exact: true }).fill('测试设备 Passkey')
  await settings.getByLabel('管理 Passkey 的当前密码', { exact: true }).fill(password)
  await settings.getByRole('button', { name: '添加 Passkey', exact: true }).click()
  await expect(settings.getByRole('status')).toContainText('Passkey 已添加')
  await waitSaved(page)
  return settings
}

test('real WebAuthn enrollment survives reload and the login page automatically authenticates once', async ({
  page,
}) => {
  await authenticator(page)
  const settings = await register(page)
  await page.reload()
  await expect(settings).toContainText('测试设备 Passkey')
  let authenticationCalls = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/passkeys/authentication/options')) authenticationCalls++
  })
  await page.getByRole('button', { name: '锁定终端', exact: true }).click()
  await expect(page.getByRole('heading', { name: '终端访问验证', exact: true })).toBeVisible()
  expect(authenticationCalls).toBe(0)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Passkey 设置', exact: true })).toBeVisible()
  expect(authenticationCalls).toBe(1)
  const session = await (await page.request.get(`${origin}/api/auth/session`)).json()
  expect(session.authenticated).toBe(true)
})

test('cancelling automatic Passkey auth allows password fallback and deleting a key locks the workspace', async ({
  page,
}) => {
  const { cdp, authenticatorId } = await authenticator(page)
  const settings = await register(page)
  await page.getByRole('button', { name: '锁定终端', exact: true }).click()
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: false })
  await page.reload()
  await expect(page.getByText('等待设备认证…', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '改用密码登录', exact: true }).click()
  await expect(page.getByLabel('访问密码', { exact: true })).toBeEnabled()
  await page.getByLabel('访问密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '验证并进入', exact: true }).click()
  await expect(settings).toBeVisible()
  await settings.getByLabel('管理 Passkey 的当前密码', { exact: true }).fill(password)
  await settings
    .getByRole('button', { name: '移除 Passkey：测试设备 Passkey', exact: true })
    .click()
  await settings
    .getByRole('button', { name: '确认移除 Passkey：测试设备 Passkey', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '终端访问验证', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '使用 Passkey 登录', exact: true })).toHaveCount(0)
})

test('password fallback revokes a delayed successful Passkey response before showing the workspace', async ({
  page,
}) => {
  await authenticator(page)
  await register(page)
  await page.getByRole('button', { name: '锁定终端', exact: true }).click()
  let release!: () => void
  let responseReady!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    responseReady = resolve
  })
  await page.route('**/api/auth/passkeys/authentication/verify', async (route) => {
    const response = await route.fetch()
    responseReady()
    await held
    await route.fulfill({ response })
  })
  await page.reload()
  await ready
  await page.getByRole('button', { name: '改用密码登录', exact: true }).click()
  release()
  await expect(page.getByLabel('访问密码', { exact: true })).toBeEnabled()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  expect((await page.request.get(`${origin}/api/health`)).status()).toBe(401)
})

for (const width of [390, 320]) {
  test(`Passkey settings and fallback fit a ${width}px mobile viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const { cdp, authenticatorId } = await authenticator(page)
    const settings = await register(page)
    await settings.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-passkey-settings-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: '锁定终端', exact: true }).click()
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: false })
    await page.reload()
    await expect(page.getByText('等待设备认证…', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '改用密码登录', exact: true }).click()
    await expect(page.getByLabel('访问密码', { exact: true })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-passkey-login-${width}.png`, fullPage: true })
  })
}
