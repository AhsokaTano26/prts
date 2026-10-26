import { test, expect, waitSaved, type Page } from './fixture'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Shanghai' })
const today = '2026-10-31'
async function selectMonthEnd(page: Page) {
  const [year, month] = (await page.locator('.calendar-month-title').innerText())
    .match(/\d+/g)!
    .map(Number)
  const difference = (2026 - year) * 12 + 10 - month
  for (let i = 0; i < Math.abs(difference); i++)
    await page
      .getByRole('button', { name: difference > 0 ? '下个月' : '上个月', exact: true })
      .click()
  await page.locator(`button[data-date="${today}"]`).click()
}
async function openTimeline(page: Page) {
  await selectMonthEnd(page)
  await page.getByRole('button', { name: '月时间线模式', exact: true }).click()
}

async function selectedDayIsVisible(page: Page, day: string) {
  await expect
    .poll(async () => {
      const viewport = (await page.locator('.timeline-scroll').boundingBox())!
      const heading = (await page
        .locator(`.timeline-day-heading[data-day="${day}"]`)
        .boundingBox())!
      return (
        heading.x >= viewport.x + 51 && heading.x + heading.width <= viewport.x + viewport.width + 1
      )
    })
    .toBe(true)
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
  await expect(page.getByRole('heading', { name: '日历日程', exact: true })).toBeVisible()
})

test('month layout switches preserve the selected date and the month contains no padding days', async ({
  page,
}) => {
  await expect(page.locator('button[data-date]')).toHaveCount(42)
  await openTimeline(page)
  await expect(
    page.getByRole('region', { name: '月时间网格，可横向及纵向滚动', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.timeline-day-column')).toHaveCount(31)
  await expect(page.locator('.timeline-day-heading').first()).toHaveAttribute(
    'data-day',
    '2026-10-01',
  )
  await expect(page.locator('.timeline-day-heading').last()).toHaveAttribute('data-day', today)
  await selectedDayIsVisible(page, today)
  await page.locator('.timeline-day-heading[data-day="2026-10-30"]').click()
  await page.getByRole('button', { name: '日视图', exact: true }).click()
  await expect(page.locator('.timeline-day-heading')).toHaveAttribute('data-day', '2026-10-30')
  await expect(page.getByRole('group', { name: '月视图布局', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '周视图', exact: true }).click()
  await expect(page.locator('.timeline-day-column')).toHaveCount(7)
  await page.getByRole('button', { name: '月视图', exact: true }).click()
  await expect(page.getByRole('button', { name: '月时间线模式', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('.timeline-day-column')).toHaveCount(31)
  await page.getByRole('button', { name: '月历模式', exact: true }).click()
  await expect(page.locator('button[data-date]')).toHaveCount(42)
  await expect(page.locator('button[data-date="2026-10-30"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('month navigation clamps month-end dates, crosses years and returns to today', async ({
  page,
}) => {
  await openTimeline(page)
  for (const [day, count] of [
    ['2026-11-30', 30],
    ['2026-12-30', 31],
    ['2027-01-30', 31],
    ['2027-02-28', 28],
  ] as const) {
    await page.getByRole('button', { name: '下个月', exact: true }).click()
    await expect(page.locator('.timeline-day-column')).toHaveCount(count)
    await expect(page.locator(`.timeline-day-heading[data-day="${day}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await selectedDayIsVisible(page, day)
  }
  await page.getByRole('button', { name: '上个月', exact: true }).click()
  await expect(page.locator('.calendar-month-title')).toHaveText('2027 年 1 月')
  await page.getByRole('button', { name: '今天', exact: true }).click()
  const actualToday = await page.evaluate(() =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()),
  )
  await expect(page.locator(`.timeline-day-heading[data-day="${actualToday}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await selectedDayIsVisible(page, actualToday)
})

test('creating and editing from the month grid saves the selected date and exact time', async ({
  page,
}) => {
  await openTimeline(page)
  await page.locator(`.timeline-slot[data-day="${today}"][data-minute="780"]`).click()
  await expect(page.getByLabel('开始日期', { exact: true })).toHaveValue(today)
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('13:00')
  await expect(page.getByLabel('结束时间', { exact: true })).toHaveValue('14:00')
  await page.getByLabel('日程标题', { exact: true }).fill('月时间线上的安排')
  await page.getByRole('button', { name: '创建日程', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await waitSaved(page)
  const event = page.locator('.timeline-block').filter({ hasText: '月时间线上的安排' })
  await expect(event).toHaveCount(1)
  await event.click()
  await page.getByLabel('日程标题', { exact: true }).fill('更新后的月安排')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await waitSaved(page)
  await page.reload()
  await openTimeline(page)
  await expect(page.locator('.timeline-block').filter({ hasText: '更新后的月安排' })).toHaveCount(1)
})

test('month grids keep scrolling and keyboard focus visible in both themes on desktop and phones', async ({
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
    await openTimeline(page)
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [320, 640],
    ]) {
      await page.setViewportSize({ width, height })
      await page.locator('.main-content').evaluate((el) => el.scrollTo(0, 0))
      await selectedDayIsVisible(page, today)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      expect(
        await page.locator('.main-content').evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      ).toBe(false)
      expect(
        await page.locator('.timeline-scroll').evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true)
      await page.screenshot({ path: `/tmp/prts-month-timeline-${theme}-${width}.png` })
    }
    await page.locator(`.timeline-slot[data-day="${today}"][data-minute="540"]`).focus()
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Home')
    const viewport = (await page.locator('.timeline-scroll').boundingBox())!
    const header = (await page.locator('.timeline-all-day-label').boundingBox())!
    const focused = (await page.locator('.timeline-slot:focus').boundingBox())!
    expect(focused.x).toBeGreaterThanOrEqual(viewport.x + 51)
    expect(focused.x + focused.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1)
    expect(focused.y).toBeGreaterThanOrEqual(header.y + header.height - 1)
    expect(focused.y + focused.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1)
    const corner = (await page.locator('.timeline-corner').boundingBox())!
    expect(corner.x).toBeCloseTo(viewport.x, 0)
    expect(corner.y).toBeCloseTo(viewport.y, 0)
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

test('native Tab and Shift+Tab reveal month headings, all-day entries and short event titles', async ({
  page,
}) => {
  await waitSaved(page)
  const current = (await (await page.request.get('/api/state')).json()).documents.workspace
  const base = {
    description: '',
    location: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  current.value.tasks = []
  current.value.calendarEvents = [
    ...['short', 'later'].map((id, index) => ({
      ...base,
      id,
      title: id === 'short' ? '短日程标题' : '稍后日程标题',
      allDay: false,
      startAt: new Date(`2026-10-30T${index ? '13' : '09'}:00:00+08:00`).toISOString(),
      endAt: new Date(`2026-10-30T${index ? '14:00' : '09:05'}:00+08:00`).toISOString(),
    })),
    ...['a', 'b'].map((id) => ({
      ...base,
      id,
      title: `整月安排 ${id}`,
      allDay: true,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    })),
  ]
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
  await page.setViewportSize({ width: 320, height: 640 })
  await openTimeline(page)
  await page.locator('.timeline-scroll').focus()
  const assertFocusVisible = async () => {
    const viewport = (await page.locator('.timeline-scroll').boundingBox())!
    const focused = page.locator('.timeline-scroll button:focus')
    const box = (await focused.boundingBox())!
    const classes = (await focused.getAttribute('class')) || ''
    const header = (await page.locator('.timeline-all-day-label').boundingBox())!
    const top = classes.includes('timeline-day-heading')
      ? viewport.y
      : classes.includes('timeline-block') || classes.includes('timeline-slot')
        ? header.y + header.height
        : viewport.y + 56
    expect(box.x).toBeGreaterThanOrEqual(viewport.x + 51)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1)
    expect(box.y).toBeGreaterThanOrEqual(top - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1)
  }
  const seen = new Set<string>()
  for (let i = 0; i < 100 && !seen.has('later'); i++) {
    await page.keyboard.press('Tab')
    await assertFocusVisible()
    const id = await page.locator('.timeline-scroll button:focus').getAttribute('data-event-id')
    if (id) seen.add(id)
  }
  expect([...seen]).toEqual(['short', 'later'])
  await page.keyboard.press('Shift+Tab')
  await expect(page.locator('.timeline-block[data-event-id="short"]')).toBeFocused()
  await assertFocusVisible()
})
