import { test, expect, waitSaved } from './fixture'

test.beforeEach(async ({ page }) => {
  const login = await page.request.post('/api/auth/login', {
    data: { password: 'prts-e2e-test-password-only' },
  })
  expect(login.ok()).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
})

test('settings show one category at a time and preserve unsaved preference and connection drafts', async ({
  page,
}) => {
  await page.goto('/#settings')
  const nav = page.getByRole('navigation', { name: '设置分类', exact: true })
  await expect(nav.getByRole('link')).toHaveCount(7)
  await expect(nav.getByRole('link', { name: '常规偏好', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('region', { name: '手机桌面应用', exact: true })).toBeVisible()
  await expect(page.getByLabel('API 密钥', { exact: true })).toBeHidden()
  await page.getByLabel('博士代号', { exact: true }).fill('未保存的代号')

  await nav.getByRole('link', { name: 'AI 服务', exact: true }).click()
  await expect(page).toHaveURL(/#settings\/ai$/)
  await page.getByLabel('AI 模型', { exact: true }).fill('navigation-draft-model')
  await page.getByLabel('API 密钥', { exact: true }).fill('navigation-test-key-only')
  await nav.getByRole('link', { name: '任务通知', exact: true }).click()
  await page.getByLabel('提前天数', { exact: true }).fill('9,4,1')
  await expect(page.getByLabel('API 密钥', { exact: true })).toBeHidden()
  await nav.getByRole('link', { name: '常规偏好', exact: true }).click()
  await expect(page.getByLabel('博士代号', { exact: true })).toHaveValue('未保存的代号')
  await nav.getByRole('link', { name: 'AI 服务', exact: true }).click()
  await expect(page.getByLabel('AI 模型', { exact: true })).toHaveValue('navigation-draft-model')
  await expect(page.getByLabel('API 密钥', { exact: true })).toHaveValue('navigation-test-key-only')
  await nav.getByRole('link', { name: '任务通知', exact: true }).click()
  await expect(page.getByLabel('提前天数', { exact: true })).toHaveValue('9,4,1')
  await waitSaved(page)
  expect((await (await page.request.get('/api/settings/ai')).json()).hasApiKey).toBe(false)
})

test('nested settings links support reload, browser history, keyboard navigation and safe unknown-category fallback', async ({
  page,
}) => {
  await page.goto('/#settings/ai')
  const nav = page.getByRole('navigation', { name: '设置分类', exact: true })
  await expect(page.getByLabel('API 密钥', { exact: true })).toBeVisible()
  await nav.getByRole('link', { name: '数据备份', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '导出备份', exact: true })).toBeVisible()
  await page.goBack()
  await expect(nav.getByRole('link', { name: 'AI 服务', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await page.goForward()
  await expect(nav.getByRole('link', { name: '数据备份', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await waitSaved(page)
  await page.reload()
  await expect(page.getByRole('button', { name: '导出备份', exact: true })).toBeVisible()
  await page.goto('/#settings/unknown-category')
  await expect(page.getByLabel('博士代号', { exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: '常规偏好', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('resource polling starts only on entry and stops after leaving, while authentication inputs are cleared', async ({
  page,
}) => {
  await page.clock.install()
  let assetReads = 0
  const unrelatedReads: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path === '/api/assets/sync') assetReads++
    if (['/api/settings/ai', '/api/auth/passkeys', '/api/knowledge/sync'].includes(path))
      unrelatedReads.push(path)
  })
  await page.goto('/#settings')
  const nav = page.getByRole('navigation', { name: '设置分类', exact: true })
  await expect(page.getByLabel('博士代号', { exact: true })).toBeVisible()
  expect(assetReads).toBe(0)
  expect(unrelatedReads).toEqual([])
  await nav.getByRole('link', { name: '资源管理', exact: true }).click()
  await expect(page.getByRole('button', { name: '首次下载图片', exact: true })).toBeEnabled()
  expect(assetReads).toBeGreaterThan(0)
  await nav.getByRole('link', { name: '常规偏好', exact: true }).click()
  await expect(page.getByLabel('博士代号', { exact: true })).toBeVisible()
  const stoppedAt = assetReads
  await page.clock.runFor(5000)
  expect(assetReads).toBe(stoppedAt)
  await nav.getByRole('link', { name: '账户安全', exact: true }).click()
  await page.getByLabel('当前密码', { exact: true }).fill('temporary-password-draft')
  await nav.getByRole('link', { name: '常规偏好', exact: true }).click()
  await expect(page.getByLabel('博士代号', { exact: true })).toBeVisible()
  await nav.getByRole('link', { name: '账户安全', exact: true }).click()
  await expect(page.getByLabel('当前密码', { exact: true })).toHaveValue('')
})

test('leaving the backup category through browser history closes a pending import confirmation', async ({
  page,
}) => {
  await page.goto('/#settings')
  await expect(page.getByLabel('博士代号', { exact: true })).toBeVisible()
  await waitSaved(page)
  const workspace = (await (await page.request.get('/api/state')).json()).documents.workspace.value
  await page
    .getByRole('navigation', { name: '设置分类', exact: true })
    .getByRole('link', { name: '数据备份', exact: true })
    .click()
  await page.getByLabel('导入工作台备份', { exact: true }).setInputFiles({
    name: 'navigation-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(workspace)),
  })
  await expect(page.getByRole('dialog', { name: '确认导入工作台备份', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog', { name: '确认导入工作台备份', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('博士代号', { exact: true })).toBeVisible()
})

test('returning to notifications refreshes delivery history without replacing unsaved configuration', async ({
  page,
}) => {
  let sent = false
  await page.route('**/api/notifications/deliveries', (route) =>
    route.fulfill({
      json: {
        deliveries: [
          {
            eventId: 'navigation-test-event',
            target: 'navigation-test-target',
            channel: 'webhook',
            status: sent ? 'sent' : 'pending',
            attempts: sent ? 1 : 0,
            sentAt: sent ? Date.now() : null,
            error: '',
            title: '分类切换期间发送的任务提醒',
            dueAt: Date.now() + 60_000,
            scheduledAt: Date.now(),
          },
        ],
      },
    }),
  )
  await page.goto('/#settings/notifications')
  await page.getByLabel('提前天数', { exact: true }).fill('8,2')
  await page.getByText('最近发送记录 · 1 条', { exact: true }).click()
  await expect(page.getByText('Webhook · 等待重试 · 0 次', { exact: true })).toBeVisible()
  const nav = page.getByRole('navigation', { name: '设置分类', exact: true })
  await nav.getByRole('link', { name: '常规偏好', exact: true }).click()
  sent = true
  await nav.getByRole('link', { name: '任务通知', exact: true }).click()
  await expect(page.getByText('Webhook · 已发送 · 1 次', { exact: true })).toBeVisible()
  await expect(page.getByLabel('提前天数', { exact: true })).toHaveValue('8,2')
})

for (const width of [1440, 1280, 768, 390, 320]) {
  test(`settings navigation stays reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 })
    await page.goto('/#settings')
    const nav = page.getByRole('navigation', { name: '设置分类', exact: true })
    await expect(nav).toBeVisible()
    for (const label of [
      '常规偏好',
      '外观主题',
      'AI 服务',
      '任务通知',
      '资源管理',
      '账户安全',
      '数据备份',
    ]) {
      const link = nav.getByRole('link', { name: label, exact: true })
      await link.click()
      await expect(link).toHaveAttribute('aria-current', 'page')
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      expect(
        await page
          .locator('.main-content')
          .evaluate((element) => element.scrollWidth > element.clientWidth),
      ).toBe(false)
    }
    await page.screenshot({
      path: `/tmp/prts-settings-nav-data-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await nav.getByRole('link', { name: '常规偏好', exact: true }).click()
    await expect(nav.getByRole('link', { name: '常规偏好', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.screenshot({
      path: `/tmp/prts-settings-nav-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  })
}
