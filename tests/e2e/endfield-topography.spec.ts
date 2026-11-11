import { test, expect } from './fixture'

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' })
const seed = (page: import('@playwright/test').Page) =>
  page.locator('html').getAttribute('data-topography-seed')
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  const preferences = (await (await page.request.get('/api/state')).json()).documents.preferences
  expect(
    (
      await page.request.put('/api/state/preferences', {
        data: {
          value: { ...preferences.value, appearance: { theme: 'endfield', portrait: 'amiya' } },
          expectedRevision: preferences.revision,
          mutationId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
})

test('refresh and page entry change terrain while same-page filtering stays stable', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#places')
  await expect(page.locator('html')).toHaveAttribute('data-topography-seed', /^\d+$/)
  const original = await seed(page)
  await page.getByRole('searchbox', { name: '搜索地点', exact: true }).fill('山间')
  expect(await seed(page)).toBe(original)
  await page.getByRole('button', { name: '任务中枢', exact: true }).click()
  await expect.poll(() => seed(page)).not.toBe(original)
  const tasks = await seed(page)
  await page.reload()
  await expect.poll(() => seed(page)).toMatch(/^\d+$/)
  expect(await seed(page)).not.toBe(tasks)
  await expect
    .poll(() =>
      page.locator('.main-content').evaluate((el) => getComputedStyle(el).backgroundImage),
    )
    .toContain('blob:')
  expect(errors).toEqual([])
})

test('settings subpages get new terrain and other themes release it', async ({ page }) => {
  await page.goto('/#settings/general')
  await expect(page.locator('html')).toHaveAttribute('data-topography-seed', /^\d+$/)
  const original = await seed(page)
  await page
    .getByRole('navigation', { name: '设置分类', exact: true })
    .getByRole('link', { name: '地图服务', exact: true })
    .click()
  await expect.poll(() => seed(page)).not.toBe(original)
  await page
    .getByRole('navigation', { name: '设置分类', exact: true })
    .getByRole('link', { name: '外观主题', exact: true })
    .click()
  await page.getByRole('radio', { name: '明日方舟：莱茵生命', exact: true }).check()
  await page.getByRole('button', { name: '保存外观', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rhine')
  await expect.poll(() => seed(page)).toBeNull()
  expect(
    await page.locator('html').evaluate((el) => el.style.getPropertyValue('--endfield-topography')),
  ).toBe('')
})

test('a blocked navigation keeps terrain until the page change is accepted', async ({ page }) => {
  await page.goto('/#places')
  await expect(page.locator('html')).toHaveAttribute('data-topography-seed', /^\d+$/)
  const original = await seed(page)
  await page.getByRole('button', { name: '添加地点', exact: true }).click()
  const form = page.getByRole('dialog', { name: '添加地点', exact: true })
  await form.getByLabel('地点名称', { exact: true }).fill('尚未保存的地点')
  await page.evaluate(() => {
    location.hash = 'tasks'
  })
  await expect(form.getByText('还有未保存的修改，是否放弃？', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#places$/)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  expect(await seed(page)).toBe(original)
  await form.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(page).toHaveURL(/#tasks$/)
  await expect(page.getByRole('heading', { name: '任务中枢.', exact: true })).toBeVisible()
  await expect.poll(() => seed(page)).not.toBe(original)
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`dense natural contours render at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/#tasks')
    await expect(page.locator('html')).toHaveAttribute('data-topography-seed', /^\d+$/)
    expect(
      Number(await page.locator('html').getAttribute('data-topography-contours')),
    ).toBeGreaterThan(20)
    expect(
      await page.locator('.main-content').evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(false)
    await page.screenshot({ path: `/tmp/prts-random-contours-${viewport.width}.png` })
    await page.goto('/offline-endfield.html')
    await expect(page.locator('html')).toHaveAttribute('data-topography-seed', /^\d+$/)
    await expect(page.getByRole('heading', { name: '终端暂时离线', exact: true })).toBeVisible()
    await page.screenshot({ path: `/tmp/prts-random-contours-offline-${viewport.width}.png` })
  })
}

test.describe('cached random topography', () => {
  test.use({ serviceWorkers: 'allow' })
  test('offline reload still generates a fresh texture from the cached module', async ({
    page,
    context,
  }) => {
    await page.goto('/#tasks')
    await expect(page.locator('html')).toHaveAttribute('data-topography-seed', /^\d+$/)
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cacheNames = await caches.keys()
          for (const name of cacheNames) {
            const cached = await (await caches.open(name)).match('/__prts_public_offline_theme')
            if (cached && (await cached.text()) === 'endfield') return true
          }
          return false
        }),
      )
      .toBe(true)
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: '终端暂时离线', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-topography-seed', /^\d+$/)
    const before = await seed(page)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-topography-seed', /^\d+$/)
    expect(await seed(page)).not.toBe(before)
  })
})
