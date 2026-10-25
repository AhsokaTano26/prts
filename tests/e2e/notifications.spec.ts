import { test, expect, waitSaved } from './fixture'

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { password: process.env.PRTS_PASSWORD } })
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
})

test('task deadline time persists and an open-page reminder stays dismissed across reload', async ({
  page,
}) => {
  const state = await (await page.request.get('/api/state')).json()
  const workspace = state.documents.workspace
  expect(
    (
      await page.request.put('/api/state/workspace', {
        data: {
          value: { ...workspace.value, tasks: [] },
          expectedRevision: workspace.revision,
          mutationId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  const config = await (await page.request.get('/api/settings/notifications')).json()
  expect(
    (
      await page.request.put('/api/settings/notifications', {
        data: { ...config, enabled: true, leadDays: [1], leadMinutes: 10 },
      })
    ).ok(),
  ).toBe(true)
  const deadline = await page.evaluate(() => {
    const date = new Date(Date.now() + 5 * 60_000)
    return {
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    }
  })
  await page.goto('/#tasks')
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('即将截止的测试任务')
  await page.getByLabel('截止日期', { exact: true }).fill(deadline.date)
  await page.getByLabel('截止时间（可选）', { exact: true }).fill(deadline.time)
  await page.getByRole('button', { name: '创建任务', exact: true }).click()
  await waitSaved(page)
  const notice = page.getByRole('region', { name: '任务截止提醒', exact: true })
  await expect(notice).toContainText('即将截止的测试任务')
  await page.getByRole('button', { name: '编辑任务：即将截止的测试任务', exact: true }).click()
  await expect(page.getByLabel('截止时间（可选）', { exact: true })).toHaveValue(deadline.time)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await notice.getByRole('button', { name: '知道了：即将截止的测试任务', exact: true }).click()
  await expect(notice).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('region', { name: '任务截止提醒', exact: true })).toHaveCount(0)
})

test('notification settings persist lead days, hide SMTP secrets, and remain usable on mobile', async ({
  page,
}) => {
  await page.goto('/#settings/notifications')
  const settings = page.getByRole('region', { name: '任务通知设置', exact: true })
  await expect(settings).toBeVisible()
  await settings.getByLabel('启用任务提醒', { exact: true }).check()
  await settings.getByLabel('提前天数', { exact: true }).fill('7,3,1')
  await settings.getByLabel('临近截止提前分钟', { exact: true }).fill('15')
  await settings.getByLabel('启用 Webhook', { exact: true }).check()
  await settings
    .getByLabel('Webhook 地址', { exact: true })
    .fill('https://qq.example/webhook/general?key=secret-test-url')
  await settings.getByLabel('启用 SMTP 邮件', { exact: true }).check()
  await settings.getByLabel('SMTP 主机', { exact: true }).fill('smtp.example.com')
  await settings.getByLabel('SMTP 账号', { exact: true }).fill('doctor@example.com')
  await settings.getByLabel('SMTP 密码或授权码', { exact: true }).fill('private-test-smtp-password')
  await settings.getByLabel('发件邮箱', { exact: true }).fill('doctor@example.com')
  await settings.getByLabel('收件邮箱', { exact: true }).fill('doctor@example.com')
  await settings.getByRole('button', { name: '保存通知配置', exact: true }).click()
  await expect(settings.getByRole('status')).toContainText('通知配置已保存')
  await expect(settings.getByLabel('SMTP 密码或授权码', { exact: true })).toHaveValue('')
  const read = await (await page.request.get('/api/settings/notifications')).text()
  expect(read).not.toContain('private-test-smtp-password')
  expect(read).not.toContain('secret-test-url')
  await page.reload()
  await expect(settings.getByLabel('提前天数', { exact: true })).toHaveValue('7,3,1')
  await expect(settings.getByLabel('临近截止提前分钟', { exact: true })).toHaveValue('15')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
    if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    await settings.getByLabel('提前天数', { exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-notifications-${width}.png`, fullPage: false })
  }
})

test('denied system permission keeps page reminders usable and completing a task cancels its reminder', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'denied' })
    Notification.requestPermission = async () => {
      throw new Error('Permission must only be requested by a user click')
    }
  })
  const state = await (await page.request.get('/api/state')).json()
  const document = state.documents.workspace
  const task = {
    ...document.value.tasks[0],
    id: 'denied-permission-task',
    title: '完成后取消提醒',
    done: false,
    dueAt: new Date(Date.now() + 300_000).toISOString(),
  }
  await page.request.put('/api/state/workspace', {
    data: {
      value: { ...document.value, tasks: [task] },
      expectedRevision: document.revision,
      mutationId: crypto.randomUUID(),
    },
  })
  const config = await (await page.request.get('/api/settings/notifications')).json()
  await page.request.put('/api/settings/notifications', { data: { ...config, enabled: true } })
  await page.goto('/#tasks')
  await expect(page.getByRole('region', { name: '任务截止提醒', exact: true })).toContainText(
    '完成后取消提醒',
  )
  await page.getByRole('checkbox', { name: '完成任务：完成后取消提醒', exact: true }).check()
  await expect(page.getByRole('region', { name: '任务截止提醒', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '编辑任务：完成后取消提醒', exact: true }).click()
  await page.getByLabel('截止时间（可选）', { exact: true }).fill('')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await waitSaved(page)
  const saved = await (await page.request.get('/api/state')).json()
  expect(saved.documents.workspace.value.tasks[0]).not.toHaveProperty('dueAt')
})
