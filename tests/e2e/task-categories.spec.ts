import { test, expect, type Page } from '@playwright/test'
import { chooseOption } from './select-helper'

test.beforeEach(async ({ page }) => {
  const password = process.env.PRTS_PASSWORD
  if (!password) throw new Error('请配置 PRTS_PASSWORD 后运行 Edge 验收。')
  expect((await page.request.post('/api/auth/login', { data: { password } })).ok()).toBe(true)
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { configured: false, model: 'mock', provider: 'Test' } }),
  )
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
})

async function addCategory(page: Page, name: string) {
  await page.getByRole('button', { name: '管理分类', exact: true }).click()
  const manager = page.getByRole('dialog', { name: '管理分类', exact: true })
  await manager.getByRole('textbox', { name: '新分类名称', exact: true }).fill(name)
  await manager.getByRole('button', { name: '添加分类', exact: true }).click()
  await expect(
    manager.getByRole('button', { name: `重命名分类：${name}`, exact: true }),
  ).toBeVisible()
  await manager.getByRole('button', { name: '关闭弹窗', exact: true }).click()
}

test('custom category columns support task moves, rename, safe deletion and reload', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#tasks')
  const board = page.locator('.task-board-grid')
  await expect(board).toBeVisible()
  expect(
    await board.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
    ),
  ).toBe(3)
  await expect(page.locator('.task-board-column')).toHaveCount(3)
  await page.screenshot({
    path: '/tmp/prts-task-board-populated-1440.png',
    fullPage: true,
    animations: 'disabled',
  })
  await addCategory(page, '研究')
  await expect(page.locator('.task-board-column')).toHaveCount(4)
  const positions = await page
    .locator('.task-board-column')
    .evaluateAll((columns) => columns.map((column) => column.getBoundingClientRect().top))
  expect(positions[0]).toBeCloseTo(positions[1], 0)
  expect(positions[1]).toBeCloseTo(positions[2], 0)
  expect(positions[3]).toBeGreaterThan(positions[0])
  await page.getByRole('button', { name: '在研究中添加任务', exact: true }).click()
  const taskDialog = page.getByRole('dialog', { name: '新建任务', exact: true })
  await expect(taskDialog.getByRole('combobox', { name: '任务分类', exact: true })).toContainText(
    '研究',
  )
  await taskDialog.getByLabel('任务内容', { exact: true }).fill('验证分类迁移')
  await chooseOption(page, '优先级', '高优先级')
  await taskDialog.getByRole('button', { name: '创建任务', exact: true }).click()
  await expect(
    page
      .getByRole('region', { name: '研究分类', exact: true })
      .getByRole('button', { name: '验证分类迁移', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '编辑任务：验证分类迁移', exact: true }).click()
  await chooseOption(page, '任务分类', '学习')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  const study = page.getByRole('region', { name: '学习分类', exact: true })
  await expect(study.getByRole('button', { name: '验证分类迁移', exact: true })).toBeVisible()
  await study.getByRole('checkbox', { name: '完成任务：验证分类迁移', exact: true }).click()
  await page.reload()
  await expect(
    study.getByRole('checkbox', { name: '恢复任务：验证分类迁移', exact: true }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.getByLabel('搜索任务', { exact: true }).fill('验证分类迁移')
  await expect(page.locator('.task-board-grid').getByRole('checkbox')).toHaveCount(1)
  await chooseOption(page, '筛选优先级', '低优先级')
  await expect(page.getByRole('button', { name: '验证分类迁移', exact: true })).toHaveCount(0)
  await chooseOption(page, '筛选优先级', '高优先级')
  await expect(page.getByRole('button', { name: '验证分类迁移', exact: true })).toBeVisible()
  await page.getByLabel('搜索任务', { exact: true }).fill('')
  await chooseOption(page, '筛选优先级', '全部优先级')
  await page.getByRole('button', { name: '管理分类', exact: true }).click()
  const manager = page.getByRole('dialog', { name: '管理分类', exact: true })
  await manager.getByRole('button', { name: '重命名分类：学习', exact: true }).click()
  await manager.getByRole('textbox', { name: '分类名称', exact: true }).fill('研习')
  await manager.getByRole('button', { name: '保存分类名称', exact: true }).click()
  await expect(manager.getByRole('button', { name: '删除分类：研习', exact: true })).toBeVisible()
  await manager.getByRole('button', { name: '删除分类：研习', exact: true }).click()
  await expect(manager).toContainText('未分类')
  await manager.getByRole('button', { name: '确认删除分类', exact: true }).click()
  await manager.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await expect(
    page
      .getByRole('region', { name: /未分类/ })
      .getByRole('checkbox', { name: '恢复任务：验证分类迁移', exact: true }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: /未分类/ })
      .getByRole('button', { name: '验证分类迁移', exact: true }),
  ).toBeVisible()
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('prts-workspace-v1') || '{}'),
  )
  expect(saved.schemaVersion).toBe(2)
  expect(saved.taskCategories.some((category: { name: string }) => category.name === '研究')).toBe(
    true,
  )
  const task = saved.tasks.find((item: { title: string }) => item.title === '验证分类迁移')
  expect(task.categoryId).toBe('')
  expect(task.done).toBe(true)
  expect(task.priority).toBe('high')
  expect(errors).toEqual([])
})

test('legacy tasks remain intact and categories fit three desktop columns and one phone column', async ({
  page,
}) => {
  await page.goto('/#tasks')
  await expect(page.getByRole('heading', { name: '任务中枢.', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem('prts-workspace-v1') || '{}')
    workspace.schemaVersion = 1
    delete workspace.taskCategories
    workspace.tasks = [
      {
        id: 'legacy-task',
        title: '旧任务保留测试',
        priority: 'medium',
        done: false,
        dueDate: '',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ]
    localStorage.setItem('prts-workspace-v1', JSON.stringify(workspace))
  })
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: /未分类/ })
      .getByRole('button', { name: '旧任务保留测试', exact: true }),
  ).toBeVisible()
  for (const name of ['研究项目', '阅读学习', '日常生活']) await addCategory(page, name)
  for (const [width, columns] of [
    [1440, 3],
    [1000, 2],
    [390, 1],
    [320, 1],
  ]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
    if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    const board = page.locator('.task-board-grid')
    expect(
      await board.evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
      ),
    ).toBe(columns)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({
      path: `/tmp/prts-task-board-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  }
})
