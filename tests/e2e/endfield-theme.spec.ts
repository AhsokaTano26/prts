import path from 'node:path'
import { test, expect, waitSaved, type Page } from './fixture'

test.use({ serviceWorkers: 'block', timezoneId: 'Asia/Shanghai' })

const themeNames = {
  rhodes: '明日方舟：罗德岛',
  rhine: '明日方舟：莱茵生命',
  endfield: '明日方舟：终末地',
} as const

async function prepare(page: Page) {
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  // Optional downloaded portraits use the same image fixture as the appearance suite.
  await page.route(/\/assets\/(amiya|priestess|kaltsit)\.png$/, (route) =>
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

async function saveTheme(page: Page, theme: keyof typeof themeNames = 'endfield') {
  await page.goto('/#settings/appearance')
  await page.getByRole('radio', { name: themeNames[theme], exact: true }).check()
  await page.getByRole('button', { name: '保存外观', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '外观已保存' })).toBeVisible()
  await waitSaved(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

function captureErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

async function expectHealthyLayout(page: Page) {
  await expect(
    page.locator(
      'vite-error-overlay, #webpack-dev-server-client-overlay, [data-nextjs-dialog-overlay]',
    ),
  ).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'endfield')
}

test('Endfield saves independently of portraits and reaches public login and install identity', async ({
  page,
  browser,
}) => {
  await prepare(page)
  await page.goto('/#settings/appearance')
  const settings = page.getByRole('region', { name: '外观设置', exact: true })
  await expect(settings.locator('input[name="appearance-theme"]')).toHaveCount(3)
  await settings.getByRole('radio', { name: themeNames.endfield, exact: true }).check()
  await settings.getByRole('radio', { name: '普瑞赛斯', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rhodes')
  await settings.getByRole('button', { name: '保存外观', exact: true }).click()
  await waitSaved(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'endfield')
  await page.reload()
  await expect(
    settings.getByRole('radio', { name: themeNames.endfield, exact: true }),
  ).toBeChecked()
  await expect(settings.getByRole('radio', { name: '普瑞赛斯', exact: true })).toBeChecked()
  await page.goto('/#overview')
  await expect(page.locator('.endfield-hero')).toBeVisible()
  await expect(page.locator('.brand')).toContainText('ENDFIELD')
  await expect(page.locator('.brand')).toContainText('INDUSTRIES')
  await expect(page.getByRole('button', { name: /^个人设置：/ })).toContainText('终末地 · 工业终端')
  await expect(page.locator('.amiya-portrait')).toHaveAttribute('src', '/assets/priestess.png')

  const peer = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    serviceWorkers: 'block',
  })
  try {
    const login = await peer.newPage()
    await login.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
    await login.goto('/')
    await expect(login.getByRole('heading', { name: '终端访问验证', exact: true })).toBeVisible()
    await expect(login.locator('.auth-identity--endfield')).toBeVisible()
    await expect(login.locator('.auth-identity--endfield')).toContainText('ENDFIELD')
    await expect(login.locator('.auth-identity--endfield')).toContainText('INDUSTRIES')
    await expectHealthyLayout(login)
    expect(await (await login.request.get('/api/appearance')).json()).toEqual({ theme: 'endfield' })
    await expect(login.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest-endfield.webmanifest',
    )
    await expect(login.locator('link[rel="icon"]')).toHaveAttribute(
      'href',
      '/icons/endfield-192.png',
    )
    await expect(login.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/icons/endfield-180.png',
    )
    await expect(login.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ecece7')
    const manifestResponse = await login.request.get('/manifest-endfield.webmanifest')
    expect(manifestResponse.ok()).toBe(true)
    expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json')
    const manifest = await manifestResponse.json()
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toBe('#ecece7')
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icons/endfield-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/icons/endfield-512.png', sizes: '512x512' }),
      ]),
    )
    for (const size of [192, 180, 512]) {
      const response = await login.request.get(`/icons/endfield-${size}.png`)
      expect(response.ok()).toBe(true)
      expect(response.headers()['content-type']).toContain('image/png')
      const png = await response.body()
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size])
    }
    await login.screenshot({ path: '/tmp/prts-endfield-public-login.png', animations: 'disabled' })
  } finally {
    await peer.close()
  }

  for (const theme of ['rhodes', 'rhine', 'endfield'] as const) {
    await saveTheme(page, theme)
    await expect(page.getByRole('radio', { name: '普瑞赛斯', exact: true })).toBeChecked()
    await page.goto('/#overview')
    await expect(page.locator('.amiya-portrait')).toHaveAttribute('src', '/assets/priestess.png')
    await expect(page.locator('.amiya-caption strong')).toHaveText('普瑞赛斯')
  }
})

const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]

for (const viewport of viewports) {
  test(`Endfield routes and login fit ${viewport.width}×${viewport.height}`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const errors = captureErrors(page)
    await prepare(page)
    await saveTheme(page)
    const routes = [
      ['overview', null],
      ['tasks', /^任务中枢/],
      ['quadrants', /^四象限法/],
      ['calendar', /^日历日程/],
      ['notes', /^个人思考/],
      ['files', /^文件资料库/],
      ['assistant', /^PRTS 助手/],
      ['settings', /^系统设置/],
      ['settings/appearance', /^系统设置/],
      ['settings/mobile', /^系统设置/],
    ] as const
    for (const [route, heading] of routes) {
      await page.goto(`/#${route}`)
      await expect(page).toHaveTitle(/PRTS/)
      const content = page.locator('.main-content')
      await expect(content).toBeVisible()
      if (heading)
        await expect(content.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      else {
        await expect(content.getByRole('heading', { level: 1 })).toHaveText(/\S/)
        await expect(content.locator('.endfield-hero')).toBeVisible()
        const hero = await content.locator('.endfield-hero').boundingBox()
        const portrait = await content.locator('.endfield-hero .amiya-visual').boundingBox()
        expect(portrait!.x).toBeGreaterThan(hero!.x + hero!.width / 2)
      }
      if (route === 'settings/appearance')
        await expect(
          content.getByRole('radio', { name: themeNames.endfield, exact: true }),
        ).toBeChecked()
      if (route === 'settings/mobile') {
        const mobile = content.getByRole('region', { name: '手机桌面应用', exact: true })
        await expect(mobile).toBeVisible()
        await expect(
          mobile.getByRole('img', { name: 'PRTS 应用图标', exact: true }),
        ).toHaveAttribute('src', '/icons/endfield-192.png')
      }
      await expectHealthyLayout(page)
      expect(
        await content.evaluate((element) => element.scrollWidth > element.clientWidth),
        route,
      ).toBe(false)
      await page.screenshot({
        path: `/tmp/prts-endfield-${route.replace('/', '-')}-${viewport.width}.png`,
        animations: 'disabled',
      })
    }
    await page.getByRole('button', { name: '锁定终端', exact: true }).click()
    await expect(page.getByLabel('访问密码', { exact: true })).toBeVisible()
    await expect(page.locator('.auth-identity--endfield')).toBeVisible()
    await expectHealthyLayout(page)
    await page.screenshot({
      path: `/tmp/prts-endfield-login-${viewport.width}.png`,
      animations: 'disabled',
    })
    expect(errors).toEqual([])
  })
}

test('Endfield authentication errors remain readable on the light login panel', async ({
  page,
}) => {
  await prepare(page)
  await saveTheme(page)
  await page.getByRole('button', { name: '锁定终端', exact: true }).click()
  await page.getByLabel('访问密码', { exact: true }).fill('incorrect-password-for-contrast-check')
  await page.getByRole('button', { name: '验证并进入', exact: true }).click()
  const error = page.locator('.auth-error')
  await expect(error).toBeVisible()
  const contrast = await error.evaluate((element) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    const paint = (color: string) => {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
    }
    const luminance = () =>
      Array.from(ctx.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((channel) => {
          const value = channel / 255
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        })
        .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
    paint(getComputedStyle(element.closest('.auth-panel')!).backgroundColor)
    paint(getComputedStyle(element).backgroundColor)
    const background = luminance()
    paint(getComputedStyle(element).color)
    const foreground = luminance()
    return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
  })
  expect(contrast).toBeGreaterThanOrEqual(4.5)
  await page.setViewportSize({ width: 320, height: 640 })
  await error.scrollIntoViewIfNeeded()
  await expectHealthyLayout(page)
  await page.screenshot({ path: '/tmp/prts-endfield-login-error-320.png' })
})

test('Endfield missing portrait keeps its resource action beside the mobile hero copy', async ({
  page,
}) => {
  await prepare(page)
  await page.route('**/assets/amiya.png', (route) => route.fulfill({ status: 404 }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await saveTheme(page)
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/#overview')
  const hero = page.locator('.endfield-hero')
  await expect(hero.getByText('阿米娅立绘尚未就绪', { exact: true })).toBeVisible()
  const resource = hero.getByRole('button', { name: '前往资源管理', exact: true })
  const bounds = await hero.boundingBox()
  const action = await resource.boundingBox()
  expect(action!.x).toBeGreaterThan(bounds!.x + bounds!.width / 2)
  expect(action!.y).toBeGreaterThanOrEqual(bounds!.y)
  expect(action!.y + action!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height)
  await expectHealthyLayout(page)
  await page.screenshot({ path: '/tmp/prts-endfield-missing-portrait-320.png' })
  await resource.click()
  await expect(page.getByRole('heading', { name: '资源管理', exact: true })).toBeVisible()
})

test('Endfield startup supports keyboard skip and reduced motion', async ({ page }) => {
  await prepare(page)
  await saveTheme(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/#settings/general')
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 1000))
  await page.getByRole('button', { name: '重播启动动画', exact: true }).click()
  const boot = page.locator('.boot-sequence--endfield')
  await expect(boot).toBeVisible()
  const skip = boot.getByRole('button', { name: '跳过启动', exact: true })
  await expect(skip).toBeFocused()
  await expectHealthyLayout(page)
  await page.screenshot({ path: '/tmp/prts-endfield-boot-desktop.png' })
  await page.keyboard.press('Enter')
  await expect(boot).toHaveCount(0)
  await page.setViewportSize({ width: 320, height: 640 })
  await page.getByRole('button', { name: '重播启动动画', exact: true }).click()
  await expect(boot).toBeVisible()
  expect(await boot.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false)
  await page.screenshot({ path: '/tmp/prts-endfield-boot-320.png' })
  await page.keyboard.press('Escape')
  await expect(boot).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '重播启动动画', exact: true }).click()
  await expect(page.locator('.boot-sequence')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '常规偏好', exact: true })).toBeVisible()
})

test('Endfield keeps overdue compact rows and task edit confirmation usable on narrow screens', async ({
  page,
}) => {
  const errors = captureErrors(page)
  await prepare(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await saveTheme(page)
  const state = await (await page.request.get('/api/state')).json()
  const workspace = state.documents.workspace
  const title = '检查终末地工业设施的维护材料与交接记录'.repeat(6)
  expect(
    (
      await page.request.put('/api/state/workspace', {
        data: {
          value: {
            ...workspace.value,
            tasks: [
              {
                id: 'endfield-overdue',
                title,
                priority: 'high',
                categoryId: '',
                done: false,
                dueDate: '2020-06-09',
                dueAt: '2020-06-09T10:35:00+08:00',
                createdAt: '2020-06-01T00:00:00Z',
              },
            ],
          },
          expectedRevision: workspace.revision,
          mutationId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  await page.goto('/#overview')
  await page.reload()
  const row = page.locator('.today-panel .task-row.compact')
  await expect(row).toHaveCount(1)
  await expect(row.locator('.task-due')).toContainText('已逾期')
  await expect(row.locator('.task-due')).toContainText('06/09 10:35')
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await row.scrollIntoViewIfNeeded()
    await expectHealthyLayout(page)
    expect(await row.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false)
    if (await row.locator('.task-due').isVisible()) {
      const due = await row.locator('.task-due').boundingBox()
      const edit = await row
        .getByRole('button', { name: `编辑任务：${title}`, exact: true })
        .boundingBox()
      expect(due!.x + due!.width).toBeLessThanOrEqual(edit!.x)
    }
    await page.screenshot({
      path: `/tmp/prts-endfield-overdue-${viewport.width}.png`,
      animations: 'disabled',
    })
  }
  await row.getByRole('button', { name: `编辑任务：${title}`, exact: true }).click()
  await expect(
    page
      .getByRole('dialog', { name: '编辑任务', exact: true })
      .getByLabel('任务内容', { exact: true }),
  ).toHaveValue(title)
  await page.keyboard.press('Escape')
  await page.goto('/#tasks')
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  const create = page.getByRole('dialog', { name: '新建任务', exact: true })
  await create.getByLabel('任务内容', { exact: true }).fill('终末地任务交互检查')
  await create.getByLabel('任务备注（可选）', { exact: true }).fill('核对任务保存与移动端表单。')
  expect(await create.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false)
  await page.screenshot({ path: '/tmp/prts-endfield-task-dialog-320.png', animations: 'disabled' })
  await create.getByRole('button', { name: '创建任务', exact: true }).click()
  await waitSaved(page)
  await page.reload()
  await page.getByRole('button', { name: '编辑任务：终末地任务交互检查', exact: true }).click()
  const edit = page.getByRole('dialog', { name: '编辑任务', exact: true })
  await edit.getByLabel('任务内容', { exact: true }).fill('终末地任务已核对')
  await edit.getByRole('button', { name: '保存修改', exact: true }).click()
  await waitSaved(page)
  await expect(page.getByRole('button', { name: '终末地任务已核对', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '编辑任务：终末地任务已核对', exact: true }).click()
  await edit.getByRole('button', { name: '删除任务', exact: true }).click()
  await expect(edit.getByRole('button', { name: '确认删除', exact: true })).toBeVisible()
  await edit.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('button', { name: '终末地任务已核对', exact: true })).toBeVisible()
  await expectHealthyLayout(page)
  expect(errors).toEqual([])
})
