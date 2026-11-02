import { test, expect, waitSaved } from './fixture'

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' })
const description = '会前带预算表，主讲 10 分钟。\n晨星：自备投影仪；资料目录 C:\\docs 😀'
for (const theme of ['rhodes', 'rhine']) {
  test(`${theme}: task remarks save, remain searchable, appear in ICS and clear from the same subscribed task`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    expect(
      (
        await page.request.post('/api/auth/login', {
          data: { password: 'prts-e2e-test-password-only' },
        })
      ).ok(),
    ).toBe(true)
    const state = await (await page.request.get('/api/state')).json()
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
    await page.goto('/#tasks')
    await expect(page).toHaveTitle(/PRTS/)
    await page.getByRole('button', { name: '新建任务', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '新建任务', exact: true })
    await editor.getByLabel('任务内容', { exact: true }).fill('项目资料准备')
    const remarks = editor.getByRole('textbox', { name: '任务备注（可选）', exact: true })
    await expect(remarks).toHaveAttribute('maxlength', '5000')
    await remarks.fill(description)
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 })
      expect(await editor.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        false,
      )
      await page.screenshot({ path: `/tmp/prts-task-notes-${theme}-${width}.png`, fullPage: true })
    }
    await editor.getByRole('button', { name: '创建任务', exact: true }).click()
    await waitSaved(page)
    await page.reload()
    await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill('晨星')
    await expect(page.locator('.task-card')).toHaveCount(1)
    await expect(page.locator('.task-card-description')).toHaveText(description)
    await page.screenshot({ path: `/tmp/prts-task-notes-card-${theme}-320.png`, fullPage: true })
    const workspace = (await (await page.request.get('/api/state')).json()).documents.workspace
      .value
    const saved = workspace.tasks.find((task: { title: string }) => task.title === '项目资料准备')
    expect(saved.description).toBe(description)
    const config = await (await page.request.get('/api/calendar/subscription')).json()
    const subscription = await (
      await page.request.post('/api/calendar/subscription', {
        data: { action: 'enable', revision: config.revision },
      })
    ).json()
    const readFeed = async () =>
      (
        await (
          await page.request.get(
            `/api/calendar/feed.ics?token=${encodeURIComponent(subscription.token)}`,
          )
        ).text()
      ).replace(/\r\n /g, '')
    const component = (feed: string) =>
      feed.split('BEGIN:VEVENT\r\n').find((item) => item.includes('SUMMARY:截止 · 项目资料准备'))!
    const original = component(await readFeed())
    expect(original).toContain('DESCRIPTION:会前带预算表')
    expect(original).toContain('\\n晨星')
    const uid = /UID:([^\r\n]+)/.exec(original)![1]
    await page.getByRole('button', { name: '编辑任务：项目资料准备', exact: true }).click()
    const editing = page.getByRole('dialog', { name: '编辑任务', exact: true })
    await expect(
      editing.getByRole('textbox', { name: '任务备注（可选）', exact: true }),
    ).toHaveValue(description)
    await editing
      .getByRole('textbox', { name: '任务备注（可选）', exact: true })
      .fill(description + '\n携带纸质版。')
    await editing.getByRole('button', { name: '保存修改', exact: true }).click()
    await waitSaved(page)
    const changed = component(await readFeed())
    expect(changed).toContain('携带纸质版。')
    expect(/UID:([^\r\n]+)/.exec(changed)![1]).toBe(uid)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/#quadrants')
    await page.getByRole('searchbox', { name: '搜索四象限任务', exact: true }).fill('晨星')
    await page.getByRole('button', { name: /^查看任务：项目资料准备，/ }).click()
    const details = page.getByRole('list', { name: '四象限任务明细' })
    await expect(details).toContainText('携带纸质版。')
    await page.screenshot({ path: `/tmp/prts-task-notes-details-${theme}.png`, fullPage: true })
    await details.getByRole('button', { name: '编辑任务：项目资料准备', exact: true }).click()
    await page
      .getByRole('dialog', { name: '编辑任务', exact: true })
      .getByRole('textbox', { name: '任务备注（可选）', exact: true })
      .fill('')
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await waitSaved(page)
    const cleared = component(await readFeed())
    expect(cleared).not.toContain('DESCRIPTION:')
    expect(/UID:([^\r\n]+)/.exec(cleared)![1]).toBe(uid)
    await page.reload()
    expect(
      (await (await page.request.get('/api/state')).json()).documents.workspace.value.tasks.find(
        (task: { id: string }) => task.id === saved.id,
      ).description,
    ).toBe('')
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}
