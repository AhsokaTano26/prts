import { test, expect, waitSaved, type Page } from './fixture'
import { dateKey, addDays } from '../../src/lib/calendar'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' })
const today = dateKey(new Date())
const tomorrow = addDays(today, 1)
const yesterday = addDays(today, -1)
async function seed(page: Page) {
  await waitSaved(page)
  const current = (await (await page.request.get('/api/state')).json()).documents.workspace
  const base = {
    description: '',
    location: '项目会议室',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const timed = (id: string, title: string, start: string, end: string) => ({
    ...base,
    id,
    title,
    allDay: false,
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
  })
  current.value.calendarEvents = [
    timed('meeting-a', '设计评审', `${today}T09:00:00`, `${today}T10:00:00`),
    timed('meeting-b', '项目讨论', `${today}T09:30:00`, `${today}T11:00:00`),
    timed('midnight-end', '前夜结束的安排', `${yesterday}T23:00:00`, `${today}T00:00:00`),
    timed('late', '晚间整理', `${today}T23:00:00`, `${tomorrow}T00:00:00`),
    {
      ...base,
      id: 'all-day',
      title: '全天资料整理',
      allDay: true,
      startDate: today,
      endDate: today,
    },
  ]
  current.value.tasks.push({
    id: 'deadline',
    title: '提交检查结果',
    priority: 'high',
    done: false,
    categoryId: '',
    dueDate: today,
    dueAt: new Date(`${today}T10:15:00`).toISOString(),
    createdAt: base.createdAt,
  })
  expect(
    (
      await page.request.put('/api/state/workspace', {
        data: {
          value: current.value,
          expectedRevision: current.revision,
          mutationId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '日历日程', exact: true })).toBeVisible()
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

test('calendar offers month, week and day navigation while preserving the selected date', async ({
  page,
}) => {
  await expect(page.getByRole('button', { name: '周视图', exact: true })).toBeVisible({
    timeout: 2000,
  })
  await expect(page.locator('button[data-date]')).toHaveCount(42)
  await page.getByRole('button', { name: '周视图', exact: true }).click()
  await expect(page.locator('.timeline-day-column')).toHaveCount(7)
  const original = await page.locator('.calendar-month-title').textContent()
  await page.getByRole('button', { name: '下一周', exact: true }).click()
  await expect(page.locator('.calendar-month-title')).not.toHaveText(original!)
  await page.getByRole('button', { name: '今天', exact: true }).click()
  await page.getByRole('button', { name: '日视图', exact: true }).click()
  await expect(page.locator('.timeline-day-column')).toHaveCount(1)
  await expect(page.locator('.timeline-day-heading')).toHaveAttribute('data-day', today)
  await page.getByRole('button', { name: '后一天', exact: true }).click()
  await expect(page.locator('.timeline-day-heading')).toHaveAttribute('data-day', tomorrow)
  await page.getByRole('button', { name: '月视图', exact: true }).click()
  await expect(page.locator(`button[data-date="${tomorrow}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('time blocks have proportional positions and overlaps remain separately clickable', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('button', { name: '周视图', exact: true }).click()
  const a = page.locator('[data-event-id="meeting-a"]')
  const b = page.locator('[data-event-id="meeting-b"]')
  const first = (await a.boundingBox())!,
    second = (await b.boundingBox())!
  expect(second.y - first.y).toBeCloseTo(32, 0)
  expect(second.height).toBeGreaterThan(first.height)
  expect(first.x + first.width).toBeLessThanOrEqual(second.x + 1)
  await expect(page.locator('.timeline-task[data-task-id="deadline"]')).toContainText(
    '提交检查结果',
  )
  const marker = page.locator('.timeline-task[data-task-id="deadline"]')
  const markerBox = (await marker.boundingBox())!,
    labelBox = (await marker.locator('strong').boundingBox())!
  expect(labelBox.height).toBeGreaterThanOrEqual(12)
  expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(markerBox.y + markerBox.height)
  // On Tuesday–Sunday, yesterday also belongs to the displayed week.
  const todayColumn = page.locator('.timeline-day-column').filter({
    has: page.locator(`.timeline-slot[data-day="${today}"]`),
  })
  await expect(todayColumn.locator('[data-event-id="midnight-end"]')).toHaveCount(0)
  await expect(
    page.locator('.timeline-all-day').getByRole('button', { name: '全天资料整理', exact: true }),
  ).toBeVisible()
  await a.click()
  await expect(page.getByRole('dialog', { name: '编辑日程', exact: true })).toBeVisible()
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('09:00')
})

test('clicking an empty half-hour prefills its start and saves a one-hour appointment', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('button', { name: '日视图', exact: true }).click()
  await page.locator(`.timeline-slot[data-day="${today}"][data-minute="780"]`).click()
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('13:00')
  await expect(page.getByLabel('结束时间', { exact: true })).toHaveValue('14:00')
  await page.getByLabel('日程标题', { exact: true }).fill('时间线上新建的安排')
  await page.getByRole('button', { name: '创建日程', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '新建日程', exact: true })).toHaveCount(0)
  await waitSaved(page)
  await page.reload()
  await page.getByRole('button', { name: '日视图', exact: true }).click()
  await expect(
    page.locator('.timeline-block').filter({ hasText: '时间线上新建的安排' }),
  ).toHaveCount(1)
})

test('keyboard slot selection and late-night creation preserve the next-day end date', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('button', { name: '日视图', exact: true }).click()
  await page.locator(`.timeline-slot[data-day="${today}"][data-minute="540"]`).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator(`.timeline-slot[data-day="${today}"][data-minute="570"]`)).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('23:30')
  await expect(page.getByLabel('结束日期', { exact: true })).toHaveValue(tomorrow)
  await expect(page.getByLabel('结束时间', { exact: true })).toHaveValue('00:30')
})

test('timeline themes stay usable on desktop and phones with scrolling contained in the week grid', async ({
  page,
}) => {
  await seed(page)
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
    await page.getByRole('button', { name: '周视图', exact: true }).click()
    for (const [width, height] of [
      [1440, 900],
      [768, 1024],
      [390, 844],
      [320, 640],
    ]) {
      await page.setViewportSize({ width, height })
      await page.locator('.main-content').evaluate((el) => el.scrollTo(0, 0))
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      expect(
        await page.locator('.main-content').evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      ).toBe(false)
      await expect(page.locator('.timeline-day-column')).toHaveCount(7)
      await page.screenshot({ path: `/tmp/prts-timeline-${theme}-week-${width}.png` })
    }
    await page.getByRole('button', { name: '日视图', exact: true }).click()
    await page.screenshot({ path: `/tmp/prts-timeline-${theme}-day-320.png` })
    await expect(page.locator('.timeline-day-column')).toHaveCount(1)
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  }
  expect(errors).toEqual([])
})

test('a selected day stays visible when a desktop week is resized to a phone', async ({ page }) => {
  await seed(page)
  await page.getByRole('button', { name: '周视图', exact: true }).click()
  const heading = page.locator('.timeline-day-heading').nth(5)
  await heading.click()
  await page.setViewportSize({ width: 320, height: 640 })
  const viewport = (await page.locator('.timeline-scroll').boundingBox())!
  await expect
    .poll(async () => {
      const box = (await heading.boundingBox())!
      return box.x >= viewport.x + 51 && box.x + box.width <= viewport.x + viewport.width + 1
    })
    .toBe(true)
})

test('keyboard navigation reveals slots below sticky headers and beside the pinned hour axis', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('button', { name: '周视图', exact: true }).click()
  const assertVisibleSlot = async () => {
    const viewport = (await page.locator('.timeline-scroll').boundingBox())!
    const header = (await page.locator('.timeline-all-day-label').boundingBox())!
    const box = (await page.locator('.timeline-slot:focus').boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(header.y + header.height - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1)
    expect(box.x).toBeGreaterThanOrEqual(viewport.x + 51)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1)
  }
  await page.locator(`.timeline-slot[data-day="${today}"][data-minute="540"]`).focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp')
  await assertVisibleSlot()
  await page.keyboard.press('Home')
  await assertVisibleSlot()
  await page.keyboard.press('End')
  await assertVisibleSlot()
  await page.locator('.timeline-day-heading').nth(5).click()
  await page.setViewportSize({ width: 320, height: 640 })
  const selected = await page.locator('.timeline-day-heading').nth(5).getAttribute('data-day')
  await page.locator(`.timeline-slot[data-day="${selected}"][data-minute="540"]`).focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
  await assertVisibleSlot()
})

test('dense simultaneous appointments keep separate visible click targets without crossing day columns', async ({
  page,
}) => {
  await seed(page)
  const current = (await (await page.request.get('/api/state')).json()).documents.workspace
  current.value.calendarEvents = Array.from({ length: 8 }, (_, i) => ({
    id: `dense-${i}`,
    title: `同时安排 ${i + 1}`,
    description: '',
    location: '',
    allDay: false,
    startAt: new Date(`${today}T09:00:00`).toISOString(),
    endAt: new Date(`${today}T10:00:00`).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }))
  expect(
    (
      await page.request.put('/api/state/workspace', {
        data: {
          value: current.value,
          expectedRevision: current.revision,
          mutationId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  await page.reload()
  await page.getByRole('button', { name: '周视图', exact: true }).click()
  const blocks = page.locator('.timeline-block[data-event-id^="dense-"]')
  const boxes = await blocks.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { x: box.x, width: box.width, right: box.right }
    }),
  )
  expect(boxes).toHaveLength(8)
  for (let i = 0; i < boxes.length; i++) {
    expect(boxes[i].width).toBeGreaterThanOrEqual(24)
    if (i) expect(boxes[i - 1].right).toBeLessThanOrEqual(boxes[i].x + 1)
  }
  const column = (await blocks.first().locator('..').boundingBox())!
  expect(boxes.at(-1)!.right).toBeLessThanOrEqual(column.x + column.width)
})

test.describe('clock changes', () => {
  test.use({ timezoneId: 'America/New_York' })
  test('creating inside the repeated hour preserves the exact absolute preset', async ({
    page,
  }) => {
    const target = '2026-11-01'
    await page.locator(`button[data-date="${target}"]`).click()
    await page.getByRole('button', { name: '日视图', exact: true }).click()
    await page.locator(`.timeline-slot[data-day="${target}"][data-minute="90"]`).click()
    await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('01:30')
    await expect(page.getByLabel('结束时间', { exact: true })).toHaveValue('01:30')
    await page.getByLabel('日程标题', { exact: true }).fill('重复小时的准确时刻')
    await page.getByRole('button', { name: '创建日程', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '新建日程', exact: true })).toHaveCount(0)
    await waitSaved(page)
    const workspace = (await (await page.request.get('/api/state')).json()).documents.workspace
      .value
    const event = workspace.calendarEvents.find(
      (item: { title: string }) => item.title === '重复小时的准确时刻',
    )
    expect(event.startAt).toBe('2026-11-01T05:30:00.000Z')
    expect(event.endAt).toBe('2026-11-01T06:30:00.000Z')
  })
})
