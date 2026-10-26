import { test, expect, type Page } from './fixture'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' })
const dialog = (page: Page) => page.getByRole('dialog', { name: '订阅日历', exact: true })
async function open(page: Page) {
  const button = page.getByRole('button', { name: '订阅日历', exact: true })
  await expect(button).toBeVisible({ timeout: 1000 })
  await button.click()
  await expect(dialog(page)).toBeVisible()
}
const address = (page: Page) => page.getByLabel('订阅地址', { exact: true })
async function enable(page: Page) {
  await page.getByRole('button', { name: '生成订阅地址', exact: true }).click()
  await expect(address(page)).toBeVisible()
  return address(page).inputValue()
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  await page.goto('/#calendar')
})

test('calendar subscriptions can be generated, reopened, reset and disabled with a working anonymous URL', async ({
  page,
  playwright,
}) => {
  await open(page)
  const first = await enable(page)
  expect(first).toMatch(/^http:\/\/127\.0\.0\.1:8791\/api\/calendar\/feed\.ics\?token=[\w-]{43}$/)
  await expect(
    dialog(page).getByRole('link', { name: '在苹果日历订阅', exact: true }),
  ).toHaveAttribute('href', first.replace(/^http:/, 'webcal:'))
  const anonymous = await playwright.request.newContext()
  try {
    const feed = await anonymous.get(first)
    expect(feed.status()).toBe(200)
    expect(feed.headers()['content-type']).toContain('text/calendar')
    expect(await feed.text()).toContain('BEGIN:VCALENDAR')
    await dialog(page).getByRole('button', { name: '关闭弹窗', exact: true }).click()
    await page.reload()
    await open(page)
    await expect(address(page)).toHaveValue(first)
    await page.getByRole('button', { name: '重置地址', exact: true }).click()
    await expect(address(page)).not.toHaveValue(first)
    const second = await address(page).inputValue()
    expect((await anonymous.get(first)).status()).toBe(404)
    expect((await anonymous.get(second)).status()).toBe(200)
    await page.getByRole('button', { name: '停用订阅', exact: true }).click()
    await expect(page.getByRole('button', { name: '生成订阅地址', exact: true })).toBeVisible()
    expect((await anonymous.get(second)).status()).toBe(404)
    const third = await enable(page)
    expect(third).not.toBe(second)
  } finally {
    await anonymous.dispose()
  }
})

test('subscription errors allow retry and stale revisions reload the authoritative address', async ({
  page,
}) => {
  await open(page)
  await page.route('**/api/calendar/subscription', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({ status: 503, json: { error: '测试：订阅暂时不可用' } })
    else await route.continue()
  })
  await page.getByRole('button', { name: '生成订阅地址', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('测试：订阅暂时不可用')
  await expect(page.getByRole('button', { name: '生成订阅地址', exact: true })).toBeEnabled()
  await page.unroute('**/api/calendar/subscription')
  const original = await enable(page)
  const current = await (await page.request.get('/api/calendar/subscription')).json()
  const reset = await page.request.post('/api/calendar/subscription', {
    data: { action: 'reset', revision: current.revision },
  })
  expect(reset.ok()).toBe(true)
  const latest = await reset.json()
  await page.getByRole('button', { name: '重置地址', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('其他页面')
  await expect(address(page)).not.toHaveValue(original)
  expect(new URL(await address(page).inputValue()).searchParams.get('token')).toBe(latest.token)
})

test('clipboard failures leave a selectable address and no subscription mutation is repeated', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('blocked')
        },
      },
    }),
  )
  await page.reload()
  await open(page)
  const original = await enable(page)
  await page.getByRole('button', { name: '复制地址', exact: true }).click()
  await expect(dialog(page).getByRole('status')).toContainText('手动复制')
  await expect(address(page)).toBeFocused()
  await expect(address(page)).toHaveValue(original)
  expect(
    await address(page).evaluate(
      (el) => (el as HTMLInputElement).selectionEnd! - (el as HTMLInputElement).selectionStart!,
    ),
  ).toBe(original.length)
})

test('failed reads can retry and pending mutations cannot be hidden with Escape or the close button', async ({
  page,
}) => {
  let failRead = true
  let mutations = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/calendar/subscription', async (route) => {
    if (route.request().method() === 'GET' && failRead) {
      failRead = false
      await route.fulfill({ status: 503, json: { error: '测试：加载失败' } })
    } else if (route.request().method() === 'POST') {
      mutations++
      await gate
      await route.continue()
    } else await route.continue()
  })
  await open(page)
  await expect(dialog(page).getByRole('alert')).toContainText('测试：加载失败')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await page.getByRole('button', { name: '生成订阅地址', exact: true }).click()
  await expect(page.getByRole('button', { name: '正在生成…', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeVisible()
  await dialog(page).getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await expect(dialog(page)).toBeVisible()
  expect(mutations).toBe(1)
  release()
  await expect(address(page)).toBeVisible()
})

test('copy and Apple entry reconcile tokens changed or disabled in another page before use', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          ;(window as unknown as { copiedURL: string }).copiedURL = value
        },
      },
    }),
  )
  await page.reload()
  await open(page)
  const original = await enable(page)
  let current = await (await page.request.get('/api/calendar/subscription')).json()
  const response = await page.request.post('/api/calendar/subscription', {
    data: { action: 'reset', revision: current.revision },
  })
  expect(response.ok()).toBe(true)
  current = await response.json()
  await page.getByRole('button', { name: '复制地址', exact: true }).click()
  const expectedURL = new URL(original)
  expectedURL.searchParams.set('token', current.token)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { copiedURL: string }).copiedURL))
    .toBe(expectedURL.href)
  const copied = await page.evaluate(() => (window as unknown as { copiedURL: string }).copiedURL)
  expect(new URL(copied).searchParams.get('token')).toBe(current.token)
  await expect(address(page)).toHaveValue(copied)
  expect(
    (
      await page.request.post('/api/calendar/subscription', {
        data: { action: 'disable', revision: current.revision },
      })
    ).ok(),
  ).toBe(true)
  const apple = dialog(page).getByRole('link', { name: '在苹果日历订阅', exact: true })
  // Suppress any native protocol launch even on a regression; this test never opens Calendar.app.
  await apple.evaluate((el) => el.addEventListener('click', (event) => event.preventDefault()))
  await apple.click()
  await expect(page.getByRole('button', { name: '生成订阅地址', exact: true })).toBeVisible()
  await expect(address(page)).toHaveCount(0)
  await enable(page)
  await page.route('**/api/calendar/subscription', async (route) => {
    if (route.request().method() === 'GET')
      await route.fulfill({ status: 503, json: { error: '测试：无法核对地址' } })
    else await route.continue()
  })
  await page.getByRole('button', { name: '复制地址', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('测试：无法核对地址')
  await expect(address(page)).toHaveCount(0)
  await page.unroute('**/api/calendar/subscription')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(address(page)).toBeVisible()
})

test('subscription dialogs fit desktop and phones in both themes without page or console errors', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (entry) => {
    if (entry.type() === 'error') errors.push(entry.text())
  })
  for (const theme of ['rhodes', 'rhine']) {
    const preferences = (await (await page.request.get('/api/state')).json()).documents.preferences
    expect(
      (
        await page.request.put('/api/state/preferences', {
          data: {
            value: { ...preferences.value, appearance: { theme, portrait: 'amiya' } },
            expectedRevision: preferences.revision,
            mutationId: crypto.randomUUID(),
          },
        })
      ).ok(),
    ).toBe(true)
    await page.reload()
    await open(page)
    if (await page.getByRole('button', { name: '生成订阅地址', exact: true }).count())
      await enable(page)
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [320, 640],
    ]) {
      await page.setViewportSize({ width, height })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      expect(await dialog(page).evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false)
      await expect(address(page)).toBeVisible()
      await expect(page.getByRole('button', { name: '复制地址', exact: true })).toBeVisible()
      await page.screenshot({ path: `/tmp/prts-subscription-${theme}-${width}.png` })
    }
    await dialog(page).getByRole('button', { name: '关闭弹窗', exact: true }).click()
  }
  expect(errors).toEqual([])
})
