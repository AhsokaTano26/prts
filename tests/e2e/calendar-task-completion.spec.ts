import { test, expect, waitSaved, type Page } from './fixture'
import { dateKey } from '../../src/lib/calendar'

test.use({ serviceWorkers: 'block' })

async function openCalendar(page: Page, theme = 'rhodes') {
  await page.request.post('/api/auth/login', { data: { password: 'prts-e2e-test-password-only' } })
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  const state = await (await page.request.get('/api/state')).json()
  const workspace = state.documents.workspace
  const today = dateKey(new Date())
  workspace.value.tasks = [
    { id: 'calendar-first', title: '日历完成动画体验' },
    {
      id: 'calendar-next',
      title: '日历下一项任务',
      dueAt: new Date(`${today}T10:15:00`).toISOString(),
    },
  ].map((task) => ({
    ...task,
    priority: 'medium',
    dueDate: today,
    done: false,
    categoryId: '',
    createdAt: new Date().toISOString(),
  }))
  expect(
    (
      await page.request.put('/api/state/workspace', {
        data: {
          value: workspace.value,
          expectedRevision: workspace.revision,
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
            motionEnabled: true,
            appearance: { theme, portrait: 'amiya' },
          },
          expectedRevision: preferences.revision,
          mutationId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  if (page.url().endsWith('/#calendar')) await page.reload()
  else await page.goto('/#calendar')
  await page.bringToFront()
  await expect(page.getByRole('region', { name: '当日任务', exact: true })).toBeVisible()
}

for (const theme of ['rhodes', 'rhine']) {
  test(`${theme} calendar completion uses the same one-second effect, saves immediately and keeps the row`, async ({
    page,
  }) => {
    await openCalendar(page, theme)
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
    const row = page.locator('.calendar-task-row').filter({ hasText: '日历完成动画体验' })
    await row.getByRole('checkbox').click()
    await expect(row).toHaveAttribute('data-completing', 'true')
    await expect(row.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    await expect(row.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true')
    expect(
      await row
        .getByRole('checkbox')
        .evaluate((element) => getComputedStyle(element).animationDuration),
    ).toBe('1s')
    await expect(page.locator('.calendar-task-row').first()).toContainText('日历完成动画体验')
    await page.clock.runFor(300)
    await waitSaved(page)
    const saved = (await (await page.request.get('/api/state')).json()).documents.workspace.value
    expect(saved.tasks.find((task: { id: string }) => task.id === 'calendar-first').done).toBe(true)
    await row.getByRole('checkbox').dispatchEvent('click')
    await page.clock.runFor(699)
    await expect(row).toHaveAttribute('data-completing', 'true')
    await page.clock.runFor(1)
    await expect(row).not.toHaveAttribute('data-completing', 'true')
    await expect(row).toContainText('已完成')
    await expect(row.getByRole('checkbox')).toBeFocused()
    await expect(page.locator('.calendar-task-row').last()).toContainText('日历完成动画体验')
    await row.getByRole('checkbox').press('Space')
    await expect(row.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
    await expect(row).not.toHaveAttribute('data-completing', 'true')
    await row.getByRole('checkbox').click()
    await page.goto('/#tasks')
    await waitSaved(page)
    await expect(page.getByRole('button', { name: '日历完成动画体验', exact: true })).toHaveCount(0)
    await page.goto('/#calendar')
    await expect(
      page.getByRole('checkbox', { name: '恢复任务：日历完成动画体验', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
  })
}

test('calendar completion respects reduced motion and turning motion off while playing', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openCalendar(page)
  const first = page.locator('.calendar-task-row').filter({ hasText: '日历完成动画体验' })
  await first.getByRole('checkbox').press('Space')
  await expect(first).not.toHaveAttribute('data-completing', 'true')
  await expect(first.getByRole('checkbox')).toBeFocused()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const next = page.locator('.calendar-task-row').filter({ hasText: '日历下一项任务' })
  await next.getByRole('checkbox').click()
  await expect(next).toHaveAttribute('data-completing', 'true')
  await page.evaluate(() => {
    document.documentElement.dataset.motion = 'off'
  })
  await expect(next).not.toHaveAttribute('data-completing', 'true')
  await expect(next).toContainText('已完成')
})

test('calendar completion remains visible in every layout and on mobile for both themes', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const theme of ['rhodes', 'rhine']) {
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: width > 600 ? 900 : 844 })
      await openCalendar(page, theme)
      for (const mode of ['month', 'month-timeline', 'week', 'day']) {
        if (mode === 'month-timeline')
          await page.getByRole('button', { name: '月时间线模式', exact: true }).click()
        if (mode === 'week' || mode === 'day')
          await page
            .getByRole('button', { name: mode === 'week' ? '周视图' : '日视图', exact: true })
            .click()
        const row = page.locator('.calendar-task-row').filter({ hasText: '日历完成动画体验' })
        await row.getByRole('checkbox').click()
        await expect(row).toHaveAttribute('data-completing', 'true')
        await row.evaluate((element) =>
          element.getAnimations({ subtree: true }).forEach((animation) => {
            animation.pause()
            animation.currentTime = 400
          }),
        )
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        )
        await page.screenshot({
          path: `/tmp/prts-calendar-completion-${theme}-${width}-${mode}.png`,
        })
        await expect(row).not.toHaveAttribute('data-completing', 'true')
        await row.getByRole('checkbox').click()
        await expect(row.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
      }
      await waitSaved(page)
    }
  }
  expect(errors).toEqual([])
})
