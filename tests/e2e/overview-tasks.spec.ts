import { test, expect, waitSaved } from './fixture'

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' })

for (const theme of ['rhodes', 'rhine']) {
  test(`${theme}: overdue deadlines stay inside overview task rows without covering edit controls`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    expect(
      (
        await page.request.post('/api/auth/login', {
          data: { password: 'prts-e2e-test-password-only' },
        })
      ).ok(),
    ).toBe(true)
    const state = await (await page.request.get('/api/state')).json()
    const workspace = state.documents.workspace
    const preferences = state.documents.preferences
    const title = '已经逾期的任务，核对全部项目材料和验收记录'.repeat(5)
    workspace.value.tasks = [
      {
        id: 'timed',
        title,
        priority: 'high',
        categoryId: '',
        dueDate: '2020-06-09',
        dueAt: '2020-06-09T10:35:00+08:00',
        done: false,
        createdAt: '2020-06-01T00:00:00Z',
      },
      {
        id: 'dated',
        title: '整理上周材料',
        priority: 'medium',
        categoryId: '',
        dueDate: '2020-06-08',
        done: false,
        createdAt: '2020-06-01T00:00:00Z',
      },
      {
        id: 'undated',
        title: '未设置截止日期的任务',
        priority: 'low',
        categoryId: '',
        dueDate: '',
        done: false,
        createdAt: '2020-06-01T00:00:00Z',
      },
    ]
    for (const [key, document, value] of [
      ['workspace', workspace, workspace.value],
      [
        'preferences',
        preferences,
        {
          ...preferences.value,
          motionEnabled: false,
          appearance: { theme, portrait: 'amiya' },
        },
      ],
    ] as const) {
      expect(
        (
          await page.request.put(`/api/state/${key}`, {
            data: {
              value,
              expectedRevision: document.revision,
              mutationId: crypto.randomUUID(),
            },
          })
        ).ok(),
      ).toBe(true)
    }
    await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
    await page.goto('/')
    await expect(page).toHaveTitle(/PRTS/)
    const panel = page.locator('.today-panel')
    await expect(panel.getByRole('heading', { name: '当前任务' })).toBeVisible()
    const rows = panel.locator('.task-row')
    await expect(rows).toHaveCount(3)
    await expect(rows.first().locator('.task-due')).toContainText('已逾期')
    await expect(rows.first().locator('.task-due')).toContainText('06/09 10:35')

    for (const width of [1440, 1920, 1250, 1100, 1000, 901, 900, 760, 600, 390, 320]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 })
      await panel.scrollIntoViewIfNeeded()
      await panel.screenshot({ path: `/tmp/prts-overview-tasks-${theme}-${width}.png` })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      for (const row of await rows.all()) {
        const metrics = await row.evaluate((element) => ({
          width: element.clientWidth,
          scroll: element.scrollWidth,
          columns: getComputedStyle(element).gridTemplateColumns,
          edit: element.querySelector('.task-edit')!.getBoundingClientRect().width,
        }))
        expect(
          metrics.scroll,
          `${theme} at ${width}px: ${JSON.stringify(metrics)}`,
        ).toBeLessThanOrEqual(metrics.width)
        const due = row.locator('.task-due')
        if (await due.isVisible()) {
          const bounds = await due.boundingBox()
          const editBounds = await row.getByRole('button', { name: /^编辑任务：/ }).boundingBox()
          expect(await due.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
            true,
          )
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(editBounds!.x)
        }
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await rows
      .first()
      .getByRole('button', { name: `编辑任务：${title}`, exact: true })
      .click()
    const editor = page.getByRole('dialog', { name: '编辑任务', exact: true })
    await expect(editor.getByLabel('任务内容', { exact: true })).toHaveValue(title)
    await editor.getByRole('button', { name: '关闭弹窗', exact: true }).click()
    await rows
      .first()
      .getByRole('checkbox', { name: `完成任务：${title}`, exact: true })
      .click()
    await expect(rows).toHaveCount(2)
    await waitSaved(page)
    const saved = (await (await page.request.get('/api/state')).json()).documents.workspace.value
    expect(saved.tasks.find((task: { id: string }) => task.id === 'timed').done).toBe(true)
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}
