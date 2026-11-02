import { test, expect, waitSaved } from './fixture'
import { chooseOption } from './select-helper'

test.use({ serviceWorkers: 'block', timezoneId: 'Asia/Shanghai' })

test('task center sorts categories and filters by priority, deadline, creation and Chinese title', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  const state = await (await page.request.get('/api/state')).json()
  const document = state.documents.workspace
  const categoryId = document.value.taskCategories[0].id
  const titles = [
    ['low', '低优先级最早截止', 'low', '2026-11-01', '2026-10-01T00:00:00Z', false],
    ['new', '高优先级较晚添加', 'high', '2026-11-03', '2026-11-02T00:00:00Z', false],
    ['zhong', '中间想法', 'high', '2026-11-03', '2026-11-01T00:00:00Z', false],
    ['a', '阿米娅资料', 'high', '2026-11-03', '2026-11-01T00:00:00Z', false],
    ['b', '补充资料', 'high', '2026-11-03', '2026-11-01T00:00:00Z', false],
    ['timed', '高优先级上午截止', 'high', '2026-11-03', '2026-11-02T00:00:00Z', false],
    ['none', '高优先级无截止', 'high', '', '2026-10-01T00:00:00Z', false],
    ['done', '已完成高优先级早截止', 'high', '2026-11-02', '2026-11-02T00:00:00Z', true],
  ]
  document.value.tasks = titles.map(([id, title, priority, dueDate, createdAt, done]) => ({
    id,
    title,
    priority,
    dueDate,
    createdAt,
    done,
    categoryId,
    ...(id === 'timed' ? { dueAt: '2026-11-03T01:00:00Z' } : {}),
  }))
  expect(
    (
      await page.request.put('/api/state/workspace', {
        data: {
          value: document.value,
          expectedRevision: document.revision,
          mutationId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  await page.goto('/#tasks')
  await expect(page).toHaveTitle(/PRTS/)
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible()
  const ordered = [
    '高优先级上午截止',
    '阿米娅资料',
    '补充资料',
    '中间想法',
    '高优先级较晚添加',
    '高优先级无截止',
    '低优先级最早截止',
  ]
  const cards = page.locator('.task-card .task-card-title')
  await expect(cards).toHaveText(ordered)
  await page.getByRole('button', { name: /^全部任务/ }).click()
  await expect(cards).toHaveText(['已完成高优先级早截止', ...ordered])
  await page
    .getByRole('group', { name: '选择任务分类' })
    .getByRole('button', { name: /^工作/ })
    .click()
  await expect(cards).toHaveText(['已完成高优先级早截止', ...ordered])
  await chooseOption(page, '筛选优先级', '高优先级')
  await expect(cards).toHaveText(['已完成高优先级早截止', ...ordered.slice(0, -1)])
  await page.getByLabel('搜索任务', { exact: true }).fill('资料')
  await expect(cards).toHaveText(['阿米娅资料', '补充资料'])
  await page.getByLabel('搜索任务', { exact: true }).fill('')
  await waitSaved(page)
  await page.reload()
  await expect(cards).toHaveText(ordered)
  const saved = (await (await page.request.get('/api/state')).json()).documents.workspace.value
    .tasks
  expect(saved.map((item: { id: string }) => item.id)).toEqual(titles.map(([id]) => id))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-task-sorting-${width}.png`, fullPage: true })
  }
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(errors).toEqual([])
})
