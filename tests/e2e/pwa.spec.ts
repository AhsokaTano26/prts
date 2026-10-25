import { test, expect } from './fixture'

test('PWA manifest and worker install, private APIs stay uncached, and offline navigation is safe', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.goto('/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  )
  const manifestResponse = await page.request.get('/manifest.webmanifest')
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json')
  const manifest = await manifestResponse.json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  )
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  const response = await page.request.get('/sw.js')
  expect(response.headers()['cache-control']).toContain('no-cache')
  await page.getByLabel('访问密码', { exact: true }).fill('prts-e2e-test-password-only')
  await page.getByRole('button', { name: '验证并进入', exact: true }).click()
  await page.getByRole('button', { name: '系统设置' }).click()
  await expect(page.getByRole('heading', { name: '手机桌面应用' })).toBeVisible()
  await page.evaluate(async () => {
    await fetch('/api/state')
    await fetch('/api/auth/session')
  })
  const keys = await page.evaluate(async () => {
    const names = await caches.keys()
    return (
      await Promise.all(
        names.map(async (name) =>
          (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname),
        ),
      )
    ).flat()
  })
  expect(keys).toContain('/offline.html')
  expect(keys.some((key) => key.startsWith('/api'))).toBe(false)
  await context.setOffline(true)
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: '终端暂时离线' })).toBeVisible()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await context.setOffline(false)
  await page.getByRole('link', { name: '重新连接终端' }).click()
  await expect(page.getByRole('heading', { name: '欢迎回来，博士。' })).toBeVisible()
})

test('mobile install guidance and standalone layout remain usable without horizontal overflow', async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.request.post('/api/auth/login', { data: { password: 'prts-e2e-test-password-only' } })
  await page.goto('/#settings/general')
  const section = page.getByRole('region', { name: '手机桌面应用' })
  await expect(section).toBeVisible()
  await section.getByRole('button', { name: '查看添加方法' }).click()
  await expect(section.getByText(/iPhone \/ iPad：用 Safari/)).toBeVisible()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    await section.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-pwa-${width}.png` })
  }
})

test('install prompt is user initiated and installed mode is reflected in settings', async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.request.post('/api/auth/login', { data: { password: 'prts-e2e-test-password-only' } })
  await page.goto('/#settings/general')
  const section = page.getByRole('region', { name: '手机桌面应用' })
  await expect(section).toBeVisible()
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, {
      prompt: async () => {
        document.documentElement.dataset.installPromptCalls = '1'
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    })
    window.dispatchEvent(event)
  })
  await expect(section.getByRole('button', { name: '安装 PRTS' })).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.dataset.installPromptCalls),
  ).toBeUndefined()
  await section.getByRole('button', { name: '安装 PRTS' }).click()
  expect(await page.evaluate(() => document.documentElement.dataset.installPromptCalls)).toBe('1')
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await expect(section.getByText('桌面应用已就绪')).toBeVisible()
  await expect(section.getByText('已在独立应用窗口中运行')).toHaveCount(0)
  await expect(section.getByRole('button', { name: '安装 PRTS' })).toHaveCount(0)
})

test('iPhone standalone mode shows installed state and keeps the mobile viewport usable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('prts-boot-seen', '1')
    Object.defineProperty(navigator, 'standalone', { value: true })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.request.post('/api/auth/login', { data: { password: 'prts-e2e-test-password-only' } })
  await page.goto('/#settings/general')
  const section = page.getByRole('region', { name: '手机桌面应用' })
  await expect(section.getByText('已在独立应用窗口中运行')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-standalone', 'true')
  await expect(section.getByRole('button', { name: '查看添加方法' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('a real service worker update waits for approval without discarding current form input', async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.request.post('/api/auth/login', { data: { password: 'prts-e2e-test-password-only' } })
  await page.goto('/#settings/general')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  const name = page.getByLabel('博士代号', { exact: true })
  const original = await name.inputValue()
  await name.fill('更新前未保存的表单')
  expect(
    (
      await page.request.post('/__test/pwa-update', {
        headers: { 'x-prts-test': 'isolated-browser-test' },
      })
    ).ok(),
  ).toBe(true)
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await expect(page.getByText('PRTS 有新版本', { exact: true })).toBeVisible()
  await expect(name).toHaveValue('更新前未保存的表单')
  await page.locator('.pwa-notice').getByRole('button', { name: '更新应用' }).click()
  await expect(name).toHaveValue(original)
  await expect(page.locator('.pwa-notice')).toHaveCount(0)
})
