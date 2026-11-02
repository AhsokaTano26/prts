import { test, expect, waitSaved, type Page } from './fixture'
import { chooseOption } from './select-helper'

test.use({ serviceWorkers: 'block', timezoneId: 'Asia/Shanghai' })
const now = '2026-11-02T04:00:00Z'
const tasks = [
  { id: 'a', title: '准备评审材料', priority: 'high', dueAt: '2026-11-03T04:00:00Z' },
  { id: 'b', title: '核对报价', priority: 'high', dueAt: '2026-11-03T04:00:00Z' },
  { id: 'plan', title: '研究长期方案', priority: 'high', dueAt: '2026-11-20T04:00:00Z' },
  { id: 'fit', title: '确认参会名单', priority: 'medium', dueAt: '2026-11-04T04:00:00Z' },
  { id: 'later', title: '整理素材', priority: 'low', dueAt: '2026-11-30T04:00:00Z' },
  { id: 'done', title: '已完成的检查', priority: 'low', dueAt: '2026-11-02T04:00:00Z', done: true },
  { id: 'unknown', title: '尚未确定日期', priority: 'high' },
]
async function expectEqualQuadrants(page: Page) {
  const sizes = await page.locator('.matrix-zone').evaluateAll((zones) =>
    zones.map((zone) => {
      const { width, height } = zone.getBoundingClientRect()
      return { width, height }
    }),
  )
  expect(sizes).toHaveLength(4)
  for (const size of sizes) {
    expect(Math.abs(size.width - sizes[0].width)).toBeLessThan(1)
    expect(Math.abs(size.height - sizes[0].height)).toBeLessThan(1)
  }
}

for (const theme of ['rhodes', 'rhine']) {
  test(`${theme}: completed tasks stay hidden and overdue marks remain clear inside a mixed cluster`, async ({
    page,
  }) => {
    await seed(
      page,
      [
        { id: 'expired', title: '逾期的材料', priority: 'high', dueAt: '2026-11-02T03:59:00Z' },
        { id: 'future', title: '即将截止的材料', priority: 'high', dueAt: '2026-11-02T04:01:00Z' },
        {
          id: 'hidden',
          title: '完成后不再显示',
          priority: 'high',
          dueAt: '2026-11-01T04:00:00Z',
          done: true,
        },
        { id: 'unknown', title: '已完成的无日期任务', priority: 'low', done: true },
      ],
      theme,
    )
    await page.goto('/#quadrants?status=done')
    await expect(page.locator('.matrix-summary')).toContainText('2 / 2 项未完成任务')
    await expect(page.locator('.matrix-summary')).toContainText('已逾期 1 项')
    await expect(page.locator('.matrix-point')).toHaveCount(1)
    await expect(page.locator('.matrix-plot .matrix-dot[data-task-id="hidden"]')).toHaveCount(0)
    const mixed = page.getByRole('button', { name: /查看聚合任务：高优先级，2 项.*含 1 项已逾期/ })
    await expect(mixed).toHaveClass(/matrix-point-overdue/)
    await expect(mixed.locator('.matrix-point-alert')).toHaveText('!')
    await mixed.click()
    const rows = page.getByRole('list', { name: '四象限任务明细' })
    await expect(rows.getByRole('listitem')).toHaveCount(2)
    const expired = rows.getByRole('listitem').filter({ hasText: '逾期的材料' })
    await expect(expired).toContainText('已逾期')
    await expect(
      rows.getByRole('listitem').filter({ hasText: '即将截止的材料' }),
    ).not.toContainText('已逾期')
    await expect(page.getByRole('dialog', { name: '编辑任务', exact: true })).toHaveCount(0)
    await page.screenshot({ path: `/tmp/prts-matrix-overdue-${theme}.png`, fullPage: true })
    await page.setViewportSize({ width: 320, height: 844 })
    await page
      .locator('.matrix-chart')
      .evaluate((element) => element.scrollIntoView({ block: 'start' }))
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-matrix-overdue-${theme}-320.png`, fullPage: true })
    await expired.getByRole('checkbox', { name: '完成任务：逾期的材料', exact: true }).click()
    await waitSaved(page)
    await expect(page.locator('.matrix-summary')).toContainText('1 / 1 项未完成任务')
    await expect(page.locator('.matrix-point-overdue')).toHaveCount(0)
    await expect(rows.getByRole('listitem')).toHaveCount(1)
    await page.clock.setFixedTime(new Date('2026-11-02T04:02:00Z'))
    await expect(page.locator('.matrix-point-overdue')).toHaveCount(1)
    await expect(rows).toContainText('已逾期')
    await rows.getByRole('checkbox', { name: '完成任务：即将截止的材料', exact: true }).click()
    await waitSaved(page)
    await expect(page.locator('.matrix-point')).toHaveCount(0)
    await expect(page.getByText('没有待处理任务', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.locator('.matrix-point')).toHaveCount(0)
    await expect(page.getByText('没有待处理任务', { exact: true })).toBeVisible()
  })
}
async function seed(page: Page, items = tasks, theme = 'rhodes') {
  await page.clock.setFixedTime(new Date(now))
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  const state = await (await page.request.get('/api/state')).json()
  const document = state.documents.workspace
  document.value.tasks = items.map((task) => ({
    categoryId: document.value.taskCategories[0].id,
    done: false,
    dueDate: '',
    createdAt: now,
    ...task,
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
  const preferences = state.documents.preferences
  expect(
    (
      await page.request.put('/api/state/preferences', {
        data: {
          value: {
            ...preferences.value,
            motionEnabled: false,
            appearance: { theme, portrait: 'amiya' },
          },
          expectedRevision: preferences.revision,
          mutationId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

for (const theme of ['rhodes', 'rhine']) {
  test(`${theme}: matrix represents unfinished tasks, edits clusters, completes tasks and restores shared options`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await seed(page, tasks, theme)
    await page.goto('/#quadrants')
    await expect(page).toHaveTitle(/PRTS/)
    await expect(page.getByRole('heading', { name: /^四象限法/ })).toBeVisible()
    await expect(page.locator('.matrix-summary')).toContainText('6 / 6 项未完成任务')
    await expect(
      page.getByRole('button', { name: '查看优先处理任务，2 项', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '查看计划安排任务，1 项', exact: true }),
    ).toBeVisible()
    await expect(page.locator('.matrix-point')).toHaveCount(4)
    await expectEqualQuadrants(page)
    const planDot = page.locator('.matrix-plot .matrix-dot[data-task-id="plan"]')
    await expect(planDot).toBeVisible()
    const planColor = await planDot.evaluate((dot) => getComputedStyle(dot).backgroundColor)
    await expect(page.locator('.matrix-task-list .matrix-dot[data-task-id="plan"]')).toHaveCSS(
      'background-color',
      planColor,
    )
    const colors = await page
      .locator('.matrix-task-list .matrix-dot')
      .evaluateAll((dots) => dots.map((dot) => getComputedStyle(dot).borderColor))
    expect(new Set(colors).size).toBe(6)
    await expect(page.locator('.matrix-point')).toHaveText(['', '', '', ''])
    await page.screenshot({ path: `/tmp/prts-matrix-initial-${theme}.png`, fullPage: true })
    await expect(page.getByRole('group', { name: '未设截止时间的任务' })).toContainText('1')
    await expect(
      page
        .getByRole('list', { name: '四象限任务明细' })
        .getByRole('button', { name: '编辑任务：已完成的检查', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: /^查看聚合任务：高优先级，2 项/ }).click()
    await expect(page.locator('.matrix-task-list > li')).toHaveCount(2)
    await page.getByRole('button', { name: '编辑任务：核对报价', exact: true }).click()
    await page
      .getByRole('dialog', { name: '编辑任务', exact: true })
      .getByLabel('任务内容', { exact: true })
      .fill('核对报价与交付')
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await waitSaved(page)
    await expect(
      page.getByRole('button', { name: '编辑任务：核对报价与交付', exact: true }),
    ).toBeVisible()
    await page.getByRole('checkbox', { name: '完成任务：核对报价与交付', exact: true }).click()
    await waitSaved(page)
    await expect(
      page.getByRole('button', { name: '编辑任务：核对报价与交付', exact: true }),
    ).toHaveCount(0)
    await expect(page.locator('.matrix-task-list > li')).toHaveCount(1)
    await expect(page.locator('.matrix-summary')).toContainText('5 / 5 项未完成任务')
    await chooseOption(page, '紧急范围', '3 天内')
    await chooseOption(page, '重要界线', '中及以上')
    await expectEqualQuadrants(page)
    expect(page.url()).toContain('days=3')
    expect(page.url()).toContain('important=medium')
    await page.reload()
    await expect(page.getByRole('combobox', { name: '紧急范围', exact: true })).toContainText(
      '3 天内',
    )
    await expect(page.getByRole('combobox', { name: '四象限任务状态', exact: true })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '查看优先处理任务，2 项', exact: true }),
    ).toBeVisible()
    await page.locator('.sidebar').getByRole('button', { name: '任务中枢', exact: true }).click()
    await page.goBack()
    await expect(page.getByRole('heading', { name: /^四象限法/ })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '重要界线', exact: true })).toContainText(
      '中及以上',
    )
    await page.getByRole('searchbox', { name: '搜索四象限任务', exact: true }).fill('长期')
    await expect(planDot).toHaveCSS('background-color', planColor)
    await expect(page.locator('.matrix-task-list > li')).toHaveCount(1)
    await page.getByRole('button', { name: /^查看任务：研究长期方案，/ }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: '编辑任务', exact: true })).toHaveCount(0)
    await expect(page.locator('.matrix-selection')).toHaveText('所选任务')
    const selectedTask = page.getByRole('list', { name: '四象限任务明细' })
    await expect(selectedTask.getByRole('listitem')).toHaveCount(1)
    await expect(selectedTask).toContainText('高优先级')
    await expect(selectedTask).toContainText('工作')
    await expect(selectedTask).toContainText('进行中')
    await expect(selectedTask.locator('time')).toHaveText('截止 2026/11/20 12:00')
    await selectedTask.getByRole('button', { name: '编辑任务：研究长期方案', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '编辑任务', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
    await page.getByRole('searchbox', { name: '搜索四象限任务', exact: true }).fill('')
    for (const width of [1440, 1280, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 })
      await expectEqualQuadrants(page)
      if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      await page.screenshot({ path: `/tmp/prts-matrix-${theme}-${width}.png`, fullPage: true })
      if (width < 600) {
        await page
          .locator('.matrix-chart')
          .evaluate((element) => element.scrollIntoView({ block: 'start' }))
        await page.screenshot({
          path: `/tmp/prts-matrix-chart-${theme}-${width}.png`,
          fullPage: true,
        })
      }
    }
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('empty and undated tasks remain actionable and dense clusters retain every task through pagination', async ({
  page,
}) => {
  await seed(page, [])
  await page.goto('/#quadrants?days=broken&important=unknown')
  await expect(page.getByText('还没有任务', { exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/prts-matrix-empty.png', fullPage: true })
  await expect(page.getByRole('combobox', { name: '紧急范围', exact: true })).toContainText(
    '7 天内',
  )
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  await page
    .getByRole('dialog', { name: '新建任务', exact: true })
    .getByLabel('任务内容', { exact: true })
    .fill('先记录再定日期')
  await page.getByRole('button', { name: '选择截止日期', exact: true }).click()
  await page
    .getByRole('dialog', { name: '选择截止日期', exact: true })
    .getByRole('button', { name: '清除日期', exact: true })
    .click()
  await page.getByRole('button', { name: '创建任务', exact: true }).click()
  await waitSaved(page)
  await expect(page.locator('.matrix-point')).toHaveCount(0)
  await expect(page.getByText('这些任务还没有截止时间', { exact: true })).toBeVisible()
  await page
    .getByRole('group', { name: '未设截止时间的任务' })
    .getByRole('button', { name: '中优先级 1', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: '编辑任务：先记录再定日期', exact: true }),
  ).toBeVisible()
  await seed(
    page,
    Array.from({ length: 42 }, (_, i) => ({
      id: `dense-${i}`,
      title: `密集任务 ${i + 1}`,
      priority: 'high',
      dueAt: '2026-11-03T04:00:00Z',
    })),
  )
  await page.reload()
  await page.getByRole('button', { name: /^查看聚合任务：高优先级，42 项/ }).click()
  await page.screenshot({ path: '/tmp/prts-matrix-dense.png', fullPage: true })
  await expect(page.locator('.matrix-task-list > li')).toHaveCount(20)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('.matrix-task-list > li')).toHaveCount(20)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('.matrix-task-list > li')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled()
  await page.getByRole('searchbox', { name: '搜索四象限任务', exact: true }).fill('无匹配的查询')
  await expect(page.getByText('没有符合筛选的任务', { exact: true })).toBeVisible()
  await expect(page.locator('.matrix-point')).toHaveCount(0)
})

test('tasks close to either side of the urgent boundary are independently clickable', async ({
  page,
}) => {
  await seed(page, [
    { id: 'left', title: '边界之前', priority: 'high', dueAt: '2026-11-09T03:59:59.999Z' },
    { id: 'right', title: '边界之后', priority: 'high', dueAt: '2026-11-09T04:00:00.001Z' },
  ])
  await page.goto('/#quadrants')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const title of ['边界之前', '边界之后']) {
      await page
        .getByRole('button', { name: new RegExp(`^查看任务：${title}，`) })
        .click({ timeout: 3000 })
      await expect(page.getByRole('dialog', { name: '编辑任务', exact: true })).toHaveCount(0)
      const details = page.getByRole('list', { name: '四象限任务明细' })
      await expect(details.getByRole('listitem')).toHaveCount(1)
      const editButton = details.getByRole('button', { name: `编辑任务：${title}`, exact: true })
      await expect(editButton).toBeVisible()
      if (width < 1024) {
        await expect(
          page.getByRole('heading', { name: '任务明细 1', exact: true }),
        ).toBeInViewport()
      }
      await editButton.click()
      await expect(
        page
          .getByRole('dialog', { name: '编辑任务', exact: true })
          .getByLabel('任务内容', { exact: true }),
      ).toHaveValue(title)
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
    }
  }
})

test('mobile filters expand and cluster selection takes the user to task details and back', async ({
  page,
}) => {
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#quadrants')
  const filters = page.getByRole('button', { name: /^筛选与界线/ })
  await expect(filters).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('region', { name: '四象限筛选' })).toBeHidden()
  await filters.click()
  await chooseOption(page, '紧急范围', '3 天内')
  await filters.click()
  await expect(filters).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: /^查看聚合任务：高优先级，2 项/ }).click()
  await expect(page.locator('.matrix-task-list > li')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: '任务明细 2', exact: true })).toBeInViewport()
  await expect(page.locator('.matrix-task-list > li').last()).toBeInViewport()
  await page.screenshot({ path: '/tmp/prts-matrix-mobile-details.png', fullPage: true })
  await page.getByRole('button', { name: '返回坐标图 ↑', exact: true }).click()
  await expect(page.getByRole('group', { name: '截止时间与优先级坐标图' })).toBeInViewport()
})

test('undated and quadrant selections follow current task membership after edits', async ({
  page,
}) => {
  await seed(page, [{ id: 'unknown', title: '补充截止时间', priority: 'high' }])
  await page.goto('/#quadrants')
  await page
    .getByRole('group', { name: '未设截止时间的任务' })
    .getByRole('button', { name: '高优先级 1', exact: true })
    .click()
  await page.getByRole('button', { name: '编辑任务：补充截止时间', exact: true }).click()
  await page
    .getByRole('dialog', { name: '编辑任务', exact: true })
    .getByLabel('截止日期', { exact: true })
    .fill('2026-11-03')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await waitSaved(page)
  await expect(page.locator('.matrix-task-list > li')).toHaveCount(0)
  await page.getByRole('button', { name: '查看优先处理任务，1 项', exact: true }).click()
  await page.getByRole('button', { name: '编辑任务：补充截止时间', exact: true }).click()
  await page
    .getByRole('dialog', { name: '编辑任务', exact: true })
    .getByLabel('截止日期', { exact: true })
    .fill('2026-11-20')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await waitSaved(page)
  await expect(page.locator('.matrix-task-list > li')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '查看计划安排任务，1 项', exact: true }),
  ).toBeVisible()
})
