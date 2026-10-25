import { test, expect, waitSaved, type Page } from './fixture'
import path from 'node:path'

const password = 'prts-e2e-test-password-only'
async function login(page: Page) {
  expect((await page.request.post('/api/auth/login', { data: { password } })).ok()).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  // A self-contained PNG fixture verifies image loading; original-asset visual QA is separate.
  await page.route(/\/assets\/(priestess|kaltsit)\.png$/, (route) =>
    process.env.PRTS_VISUAL_ASSETS
      ? route.fulfill({
          path: path.join(
            process.env.PRTS_VISUAL_ASSETS,
            path.basename(new URL(route.request().url()).pathname),
          ),
        })
      : route.fulfill({
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
            'base64',
          ),
        }),
  )
}

test('appearance offers independent themes and portraits and persists the saved selection', async ({
  page,
  browser,
}) => {
  await login(page)
  await page.goto('/#settings/appearance')
  await expect(page.getByRole('heading', { name: '外观主题', exact: true })).toBeVisible()
  await page.getByRole('radio', { name: '明日方舟：莱茵生命', exact: true }).check()
  await page.getByRole('radio', { name: '凯尔希', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rhodes')
  await page.getByRole('button', { name: '保存外观', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '外观已保存' })).toBeVisible()
  await waitSaved(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rhine')
  await page.reload()
  await expect(page.getByRole('radio', { name: '凯尔希', exact: true })).toBeChecked()
  await page.goto('/#overview')
  await expect(page.locator('.rhine-hero')).toBeVisible()
  await expect(page.locator('.amiya-portrait')).toHaveAttribute('src', '/assets/kaltsit.png')
  const peer = await browser.newContext({ baseURL: 'http://127.0.0.1:8791' })
  try {
    const peerPage = await peer.newPage()
    await peerPage.goto('/')
    await expect(peerPage.locator('html')).toHaveAttribute('data-theme', 'rhine')
    await expect(peerPage.getByLabel('访问密码', { exact: true })).toBeVisible()
    await login(peerPage)
    await peerPage.goto('/#settings/appearance')
    await peerPage.reload()
    await expect(peerPage.getByRole('radio', { name: '凯尔希', exact: true })).toBeChecked()
  } finally {
    await peer.close()
  }
})

async function saveRhine(page: Page) {
  await page.goto('/#settings/appearance')
  await page.getByRole('radio', { name: '明日方舟：莱茵生命', exact: true }).check()
  await page.getByRole('button', { name: '保存外观', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rhine')
  await waitSaved(page)
}

test('returning after an image download retries failed previews without losing an appearance draft', async ({
  page,
}) => {
  await login(page)
  let downloaded = false
  await page.route('**/assets/priestess.png', (route) =>
    downloaded ? route.fallback() : route.fulfill({ status: 404 }),
  )
  await page.goto('/#settings/appearance')
  const choice = page
    .locator('.portrait-choice')
    .filter({ has: page.getByRole('radio', { name: '普瑞赛斯', exact: true }) })
  await expect(choice.getByText('等待下载', { exact: true })).toBeVisible()
  await page.getByRole('radio', { name: '普瑞赛斯', exact: true }).check()
  await page.goto('/#settings/resources')
  downloaded = true
  await page.goto('/#settings/appearance')
  await expect(choice.locator('img')).toBeVisible()
  await expect(choice.getByText('等待下载', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: '普瑞赛斯', exact: true })).toBeChecked()
})

test('a delayed public theme response cannot undo a new saved theme', async ({ page }) => {
  await login(page)
  let release!: () => void
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/appearance', async (route) => {
    await delayed
    await route.fulfill({ json: { theme: 'rhodes' } })
  })
  await saveRhine(page)
  const finished = page.waitForResponse((response) => response.url().endsWith('/api/appearance'))
  release()
  await finished
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rhine')
})

test('failed appearance saves remain visibly unsaved and preserve the database until a retry succeeds', async ({
  page,
}) => {
  await login(page)
  let fail = true
  await page.route('**/api/state/preferences', (route) =>
    fail && route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, json: { error: '测试：保存暂不可用' } })
      : route.continue(),
  )
  await page.goto('/#settings/appearance')
  await page.getByRole('radio', { name: '明日方舟：莱茵生命', exact: true }).check()
  await page.getByRole('button', { name: '保存外观', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '外观尚未保存' })).toBeVisible()
  expect((await (await page.request.get('/api/appearance')).json()).theme).toBe('rhodes')
  fail = false
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await waitSaved(page)
  expect((await (await page.request.get('/api/appearance')).json()).theme).toBe('rhine')
})

for (const width of [1440, 390, 320]) {
  test(`Rhine login and startup fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 400 ? 844 : 900 })
    await login(page)
    await saveRhine(page)
    await page.goto('/#settings/general')
    await page.getByRole('button', { name: '重播启动动画', exact: true }).click()
    await expect(page.locator('.boot-sequence--rhine')).toBeVisible()
    await expect(page.locator('.boot-sequence--rhine')).toHaveAttribute('data-phase', 'prepare')
    await page.screenshot({ path: `/tmp/prts-rhine-boot-${width}.png` })
    expect(
      await page
        .locator('.boot-sequence--rhine')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false)
    await page.getByRole('button', { name: '跳过启动', exact: true }).click()
    await page.getByRole('button', { name: '锁定终端', exact: true }).click()
    await expect(page.getByLabel('访问密码', { exact: true })).toBeVisible()
    await expect(page.locator('.rhine-auth-title')).toHaveCount(1)
    await page.screenshot({ path: `/tmp/prts-rhine-login-${width}.png`, animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  })
}

test('Rhine startup is distinct, skippable and respects the motion preference', async ({
  page,
}) => {
  await login(page)
  await saveRhine(page)
  await page.goto('/#settings/general')
  await page.getByRole('button', { name: '重播启动动画', exact: true }).click()
  await expect(page.locator('.boot-sequence--rhine')).toBeVisible()
  await expect(page.locator('.rhine-boot-instrument')).toBeVisible()
  await page.getByRole('button', { name: '跳过启动', exact: true }).click()
  await expect(page.locator('.boot-sequence')).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '重播启动动画', exact: true }).click()
  await expect(page.locator('.boot-sequence')).toHaveCount(0)
  await page.goto('/#overview')
  await expect(page.locator('.rhine-hero-orbit--inner')).toHaveCSS('animation-name', 'none')
})

for (const width of [1440, 768, 390, 320]) {
  test(`all Rhine pages and settings remain readable and usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await login(page)
    await saveRhine(page)
    for (const route of [
      'overview',
      'tasks',
      'notes',
      'files',
      'assistant',
      'settings/general',
      'settings/appearance',
      'settings/ai',
      'settings/notifications',
      'settings/resources',
      'settings/security',
      'settings/data',
    ]) {
      await page.goto(`/#${route}`)
      await expect(page.locator('.main-content')).toBeVisible()
      await page.screenshot({
        path: `/tmp/prts-rhine-${route.replace('/', '-')}-${width}.png`,
        animations: 'disabled',
      })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        route,
      ).toBe(false)
      expect(
        await page
          .locator('.main-content')
          .evaluate((element) => element.scrollWidth > element.clientWidth),
        route,
      ).toBe(false)
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'rhine')
    }
    await page.goto('/#tasks')
    await page.getByRole('button', { name: '新建任务', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('任务内容', { exact: true }).fill('莱茵生命主题交互验证')
    if (width <= 420)
      expect(
        (await page.getByLabel('截止日期', { exact: true }).boundingBox())!.width,
      ).toBeGreaterThan(200)
    await page.screenshot({ path: `/tmp/prts-rhine-dialog-${width}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  })
}

test('appearance drafts survive category switching and each portrait can be selected in either theme', async ({
  page,
}) => {
  await login(page)
  await page.goto('/#settings/appearance')
  const nav = page.getByRole('navigation', { name: '设置分类', exact: true })
  await page.getByRole('radio', { name: '普瑞赛斯', exact: true }).check()
  await nav.getByRole('link', { name: '常规偏好', exact: true }).click()
  await nav.getByRole('link', { name: '外观主题', exact: true }).click()
  await expect(page.getByRole('radio', { name: '普瑞赛斯', exact: true })).toBeChecked()
  for (const theme of ['明日方舟：罗德岛', '明日方舟：莱茵生命']) {
    for (const [name, id] of [
      ['阿米娅', 'amiya'],
      ['普瑞赛斯', 'priestess'],
      ['凯尔希', 'kaltsit'],
    ]) {
      await page.goto('/#settings/appearance')
      await page.getByRole('radio', { name: theme, exact: true }).check()
      await page.getByRole('radio', { name, exact: true }).check()
      await page.getByRole('button', { name: '保存外观', exact: true }).click()
      await waitSaved(page)
      await page.goto('/#overview')
      await expect(page.locator('.amiya-portrait')).toHaveAttribute('src', `/assets/${id}.png`)
      await expect(page.locator('.amiya-caption strong')).toHaveText(name)
    }
  }
})

test('a missing selected portrait has a resource entry and does not prevent choosing another portrait', async ({
  page,
}) => {
  await login(page)
  await page.route('**/assets/priestess.png', (route) => route.fulfill({ status: 404 }))
  await page.goto('/#settings/appearance')
  await page.getByRole('radio', { name: '普瑞赛斯', exact: true }).check()
  await page.getByRole('button', { name: '保存外观', exact: true }).click()
  await waitSaved(page)
  await page.goto('/#overview')
  await expect(page.getByText('普瑞赛斯立绘尚未就绪', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '前往资源管理', exact: true }).click()
  await expect(page).toHaveURL(/#settings\/resources$/)
  await page.goto('/#settings/appearance')
  await page.getByRole('radio', { name: '阿米娅', exact: true }).check()
  await page.getByRole('button', { name: '保存外观', exact: true }).click()
  await waitSaved(page)
  await page.goto('/#overview')
  await expect(page.locator('.amiya-portrait')).toHaveAttribute('src', '/assets/amiya.png')
})

test('the offline page follows the saved theme without caching private API responses', async ({
  page,
  context,
}) => {
  await login(page)
  await saveRhine(page)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const response = await caches.match('/__prts_public_offline_theme')
        return response?.text()
      }),
    )
    .toBe('rhine')
  const cached = await page.evaluate(async () => {
    const names = await caches.keys()
    return (
      await Promise.all(
        names.map(async (name) =>
          (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname),
        ),
      )
    ).flat()
  })
  expect(cached.some((url) => url.startsWith('/api/'))).toBe(false)
  await context.setOffline(true)
  try {
    await page.goto('/?offline-appearance-check=1')
    await expect(page.getByRole('heading', { name: '终端暂时离线', exact: true })).toBeVisible()
    await expect(page.getByText('RHINE LAB', { exact: true }).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  } finally {
    await context.setOffline(false)
  }
})

for (const width of [1440, 390]) {
  test(`portrait compositions fit both themes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await login(page)
    for (const theme of ['rhodes', 'rhine']) {
      for (const [name, id] of [
        ['阿米娅', 'amiya'],
        ['普瑞赛斯', 'priestess'],
        ['凯尔希', 'kaltsit'],
      ]) {
        await page.goto('/#settings/appearance')
        await page
          .getByRole('radio', {
            name: theme === 'rhine' ? '明日方舟：莱茵生命' : '明日方舟：罗德岛',
            exact: true,
          })
          .check()
        await page.getByRole('radio', { name, exact: true }).check()
        await page.getByRole('button', { name: '保存外观', exact: true }).click()
        await waitSaved(page)
        await page.goto('/#overview')
        await expect(page.locator('.amiya-portrait')).toHaveAttribute('src', `/assets/${id}.png`)
        await expect
          .poll(() =>
            page
              .locator('.amiya-portrait')
              .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
          )
          .toBe(true)
        await page.screenshot({
          path: `/tmp/prts-portrait-${theme}-${id}-${width}.png`,
          animations: 'disabled',
        })
      }
    }
  })
}
