import { test, expect } from '@playwright/test'

const idle = {
  state: 'idle',
  phase: null,
  completedFiles: 0,
  totalFiles: 0,
  completedBytes: 0,
  totalBytes: 0,
  release: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  result: null,
}
const installed = {
  ready: true,
  release: 'test-release-1',
  documentCount: 34007,
  sources: [
    { id: 'arknights', name: '明日方舟', documentCount: 17801 },
    { id: 'endfield', name: '明日方舟：终末地', documentCount: 16206 },
  ],
}
const running = {
  ...idle,
  state: 'running',
  phase: 'downloading',
  completedFiles: 5,
  totalFiles: 10,
  completedBytes: 50,
  totalBytes: 100,
  release: 'test-release-2',
  startedAt: '2026-10-23T00:00:00Z',
}
const complete = {
  ...running,
  state: 'succeeded',
  phase: null,
  completedFiles: 10,
  completedBytes: 100,
  result: 'installed',
  finishedAt: '2026-10-23T00:01:00Z',
}

test.beforeEach(async ({ page }) => {
  const password = process.env.PRTS_PASSWORD
  if (!password) throw new Error('请配置 PRTS_PASSWORD 后运行 Edge 验收。')
  expect((await page.request.post('/api/auth/login', { data: { password } })).ok()).toBe(true)
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { configured: false, model: 'mock', provider: 'Test' } }),
  )
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
})

test('first download runs once, resumes after refresh, and activates the installed library', async ({
  page,
}) => {
  let job = { ...idle }
  let ready = false
  let posts = 0
  await page.route('**/api/knowledge', (route) =>
    route.fulfill({
      json: ready
        ? { ...installed, release: 'test-release-2' }
        : { ready: false, release: null, documentCount: 0, sources: [] },
    }),
  )
  await page.route('**/api/knowledge/sync', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ mode: 'install' })
      posts++
      job = { ...running } as typeof job
    }
    await route.fulfill({ status: route.request().method() === 'POST' ? 202 : 200, json: job })
  })
  await page.goto('/#settings')
  await expect(page.getByRole('button', { name: '首次下载语料', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '检查并更新语料', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '首次下载语料', exact: true }).click()
  await expect(page.getByRole('progressbar', { name: '语料同步进度' })).toHaveAttribute(
    'value',
    '50',
  )
  await expect(page.getByRole('button', { name: '首次下载语料', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('progressbar', { name: '语料同步进度' })).toHaveAttribute(
    'value',
    '50',
  )
  expect(posts).toBe(1)
  ready = true
  job = { ...complete } as typeof job
  await expect(page.getByText('语料下载完成，已可使用', { exact: true })).toBeVisible({
    timeout: 6000,
  })
  await expect(page.getByText('test-release-2', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '检查并更新语料', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '首次下载语料', exact: true })).toBeDisabled()
})

test('update failure keeps the old corpus and retry reports current version; mobile remains usable', async ({
  page,
}) => {
  let job = { ...idle }
  let posts = 0
  await page.route('**/api/knowledge', (route) => route.fulfill({ json: installed }))
  await page.route('**/api/knowledge/sync', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ mode: 'update' })
      posts++
      job = { ...running } as typeof job
    }
    await route.fulfill({ status: route.request().method() === 'POST' ? 202 : 200, json: job })
  })
  await page.goto('/#settings')
  await page.getByRole('button', { name: '检查并更新语料', exact: true }).click()
  await expect(page.getByRole('progressbar', { name: '语料同步进度' })).toBeVisible()
  job = { ...running, state: 'failed', error: '下载连接中断，请重试。' } as typeof job
  await expect(page.getByRole('alert')).toContainText('已安装的语料仍可使用', { timeout: 6000 })
  await expect(page.getByText('test-release-1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '检查并更新语料', exact: true }).click()
  job = { ...complete, result: 'current' } as typeof job
  await expect(page.getByText('当前已是最新版本，校验完成', { exact: true })).toBeVisible({
    timeout: 6000,
  })
  expect(posts).toBe(2)
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
    if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    await page.locator('.corpus-settings').scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await expect(page.getByRole('button', { name: '检查并更新语料', exact: true })).toBeVisible()
    await page.screenshot({ path: `/tmp/prts-corpus-settings-${width}.png`, fullPage: true })
  }
})

test('a lost start response reconnects to the existing background job without a second POST', async ({
  page,
}) => {
  let posts = 0
  let job = { ...idle }
  await page.route('**/api/knowledge', (route) => route.fulfill({ json: installed }))
  await page.route('**/api/knowledge/sync', async (route) => {
    if (route.request().method() === 'POST') {
      posts++
      job = { ...running } as typeof job
      return route.abort('failed')
    }
    await route.fulfill({ json: job })
  })
  await page.goto('/#settings')
  await page.getByRole('button', { name: '检查并更新语料', exact: true }).click()
  await expect(page.locator('.corpus-settings-error')).toBeVisible()
  await page.getByRole('button', { name: '重新连接', exact: true }).click()
  await expect(page.getByRole('progressbar', { name: '语料同步进度' })).toBeVisible()
  await expect(page.getByRole('button', { name: '检查并更新语料', exact: true })).toBeDisabled()
  expect(posts).toBe(1)
})

test('removed corpus footnote is absent from the archive panel', async ({ page }) => {
  await page.goto('/#assistant')
  await page.getByRole('button', { name: '语料检索', exact: true }).click()
  await expect(page.locator('.corpus-footnote')).toBeVisible()
  await expect(page.getByText(/下载入口由作者在 ModelScope/)).toHaveCount(0)
})
