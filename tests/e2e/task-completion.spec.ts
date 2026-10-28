import { test, expect, waitSaved, type Page } from './fixture'

test.use({ serviceWorkers: 'block' })

async function openTasks(page: Page, theme = 'rhodes') {
  await page.request.post('/api/auth/login', { data: { password: 'prts-e2e-test-password-only' } })
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  const state = await (await page.request.get('/api/state')).json()
  const workspace = state.documents.workspace
  workspace.value.tasks = [
    ['first', '完成交互检查', false],
    ['second', '下一项待办', false],
    ['done', '历史已完成任务', true],
  ].map(([id, title, done]) => ({
    id,
    title,
    done,
    priority: 'medium',
    dueDate: '',
    categoryId: workspace.value.taskCategories[0].id,
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
  if (page.url().endsWith('/#tasks')) await page.reload()
  else await page.goto('/#tasks')
  await page.bringToFront()
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible()
}

test('task center starts with pending tasks and keeps that filter when changing category', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openTasks(page)
  await expect(page.getByRole('button', { name: /^进行中/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('.task-card')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '历史已完成任务', exact: true })).toHaveCount(0)
  await page
    .getByRole('group', { name: '选择任务分类' })
    .getByRole('button', { name: /^工作/ })
    .click()
  await expect(page.locator('.task-card')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /^进行中/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: /^全部任务/ }).click()
  await expect(page.locator('.task-card')).toHaveCount(3)
  await page.reload()
  await expect(page.locator('.task-card')).toHaveCount(2)
})

for (const theme of ['rhodes', 'rhine']) {
  test(`${theme} completes immediately, animates for one second and then reveals the next task`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openTasks(page, theme)
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
    const card = page
      .locator('.task-card')
      .filter({ has: page.getByRole('button', { name: '完成交互检查', exact: true }) })
    await card.getByRole('checkbox').click()
    await expect(card).toHaveAttribute('data-completing', 'true')
    await expect(card.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    await expect(card.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true')
    expect(await card.evaluate((el) => getComputedStyle(el).animationDuration)).toBe('1s')
    await page.clock.runFor(300)
    await waitSaved(page)
    const stored = (await (await page.request.get('/api/state')).json()).documents.workspace.value
    expect(stored.tasks.find((task: { id: string }) => task.id === 'first').done).toBe(true)
    // A rapid second activation must not toggle the saved result back.
    await card.getByRole('checkbox').dispatchEvent('click')
    await page.clock.runFor(699)
    await expect(card).toBeAttached()
    await page.clock.runFor(1)
    await expect(card).toHaveCount(0)
    await expect(
      page.getByRole('checkbox', { name: '完成任务：下一项待办', exact: true }),
    ).toBeFocused()
    await page.getByRole('button', { name: /^已完成/ }).press('Enter')
    await expect(
      page.getByRole('checkbox', { name: '恢复任务：完成交互检查', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
    await page.reload()
    await expect(page.getByRole('button', { name: '完成交互检查', exact: true })).toHaveCount(0)
  })
}

test('all tasks retain completed cards, undo stays immediate, and navigation never cancels the save', async ({
  page,
}) => {
  await openTasks(page)
  await page.getByRole('button', { name: /^全部任务/ }).press('Enter')
  const card = page.locator('.task-card').filter({ hasText: '完成交互检查' })
  await card.getByRole('checkbox').press('Space')
  await expect(card).toHaveAttribute('data-completing', 'true')
  await expect(card).not.toHaveClass(/task-card--leaving/)
  await expect(card).not.toHaveAttribute('data-completing', 'true')
  await card.getByRole('checkbox').click()
  await expect(card.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
  await expect(card).not.toHaveAttribute('data-completing', 'true')
  await card.getByRole('checkbox').click()
  await page.goto('/#notes')
  await waitSaved(page)
  await page.goto('/#tasks')
  await expect(page.getByRole('button', { name: '完成交互检查', exact: true })).toHaveCount(0)
})

test('reduced and disabled motion finish without waiting, including a preference change mid-animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openTasks(page)
  await page.getByRole('checkbox', { name: '完成任务：完成交互检查', exact: true }).click()
  await expect(page.locator('[data-completing]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '完成交互检查', exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('checkbox', { name: '完成任务：下一项待办', exact: true }),
  ).toBeFocused()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('checkbox', { name: '完成任务：下一项待办', exact: true }).click()
  await expect(page.locator('[data-completing]')).toHaveCount(1)
  await page.evaluate(() => {
    document.documentElement.dataset.motion = 'off'
  })
  await expect(page.locator('[data-completing]')).toHaveCount(0)
  await expect(page.locator('.task-card')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^进行中/ })).toBeFocused()
})

test('disabled motion immediately moves keyboard focus to the next task or pending filter', async ({
  page,
}) => {
  await openTasks(page)
  await page.evaluate(() => {
    document.documentElement.dataset.motion = 'off'
  })
  await page.getByRole('checkbox', { name: '完成任务：完成交互检查', exact: true }).press('Space')
  const next = page.getByRole('checkbox', { name: '完成任务：下一项待办', exact: true })
  await expect(next).toBeFocused()
  await next.press('Space')
  await expect(page.getByRole('button', { name: /^进行中/ })).toBeFocused()
  await expect(page.locator('.task-card')).toHaveCount(0)
})

test('completion effects fit desktop and mobile in both themes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const theme of ['rhodes', 'rhine']) {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width > 600 ? 900 : 844 })
      await openTasks(page, theme)
      const card = page.locator('.task-card').filter({ hasText: '完成交互检查' })
      await card.scrollIntoViewIfNeeded()
      await card.getByRole('checkbox').click()
      await expect(card).toHaveAttribute('data-completing', 'true')
      await card.evaluate((el) =>
        el.getAnimations({ subtree: true }).forEach((animation) => {
          animation.pause()
          animation.currentTime = 400
        }),
      )
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      await page.screenshot({ path: `/tmp/prts-task-completion-${theme}-${width}.png` })
      await waitSaved(page)
    }
  }
  expect(errors).toEqual([])
})
