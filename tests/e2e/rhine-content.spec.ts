import { test, expect, type Page } from './fixture'

async function enterRhine(page: Page) {
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.goto('/#settings/appearance')
  await page.getByRole('radio', { name: '明日方舟：莱茵生命', exact: true }).check()
  await page.getByRole('button', { name: '保存外观', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '外观已保存' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rhine')
}

for (const width of [1440, 390]) {
  test(`Rhine content survives navigation from scrolled pages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await enterRhine(page)
    for (const route of [
      'overview',
      'tasks',
      'notes',
      'files',
      'assistant',
      'settings/appearance',
      'tasks',
    ]) {
      await page.locator('.main-content').evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await page.evaluate((route) => {
        location.hash = route
      }, route)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.transition))
        .toBeUndefined()
      await expect(page.locator('.motion-page')).not.toBeEmpty()
      await expect(page.locator('.motion-page .view-heading')).toBeVisible()
      await expect(page.locator('.main-content')).toHaveJSProperty('scrollTop', 0)
      await page.screenshot({
        path: `/tmp/prts-rhine-content-${route.replace('/', '-')}-${width}.png`,
      })
    }
    await page.reload()
    await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible()
  })
}

test('WebKit uses live Rhine content instead of document snapshots', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'webkit',
    'This regression exercises the Safari engine compatibility path.',
  )
  await enterRhine(page)
  await page.evaluate(() => {
    const original = document.startViewTransition.bind(document)
    let captures = 0
    document.startViewTransition = (update: ViewTransitionUpdateCallback) => {
      captures++
      document.documentElement.dataset.testCaptures = String(captures)
      return original(update)
    }
  })
  await page.evaluate(() => {
    location.hash = 'tasks'
  })
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.transition))
    .toBeUndefined()
  expect(await page.evaluate(() => document.documentElement.dataset.testCaptures || '0')).toBe('0')
})

test('an unfinished browser capture cannot leave Rhine navigation pending until reload', async ({
  page,
}) => {
  await enterRhine(page)
  await page.evaluate(() => {
    document.startViewTransition = () => {
      const pending = new Promise<void>(() => {})
      return {
        ready: pending,
        finished: pending,
        updateCallbackDone: pending,
        skipTransition() {},
      } as ViewTransition
    }
    location.hash = 'tasks'
  })
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible({ timeout: 2000 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.transition))
    .toBeUndefined()
})
