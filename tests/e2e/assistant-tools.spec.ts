import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { test, expect, waitSaved } from './fixture'

// PWA lifecycle notices are covered separately and must not overlay chat controls.
test.use({ serviceWorkers: 'block' })

test('AI tools prepare a real task, confirmation refreshes the workspace and history keeps its status', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const upstream = createServer(async (request, response) => {
    let body = ''
    for await (const part of request) body += part
    const payload = JSON.parse(body)
    const tool = (name: string, args: unknown) => ({
      id: randomUUID(),
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    })
    const message =
      payload.messages.at(-1).role === 'tool'
        ? { content: '我已读取当前工作台，并准备了任务。请在下方确认后写入。' }
        : {
            content: null,
            tool_calls: [
              tool('get_workspace', {}),
              tool('propose_workspace_change', {
                operation: 'create_task',
                fields: { title: 'AI 创建的晨星计划', priority: 'high' },
              }),
            ],
          }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message }] }))
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  try {
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('No mock upstream port')
    expect(
      (
        await page.request.post('/api/auth/login', {
          data: { password: 'prts-e2e-test-password-only' },
        })
      ).ok(),
    ).toBe(true)
    const settings = await (await page.request.get('/api/settings/ai')).json()
    expect(
      (
        await page.request.put('/api/settings/ai', {
          data: {
            ...settings,
            baseUrl: `http://127.0.0.1:${address.port}`,
            model: 'tools-e2e',
            apiKey: 'tools-e2e-fake-key-only',
          },
        })
      ).ok(),
    ).toBe(true)
    await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
    await page.goto('/#assistant')
    await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
    await waitSaved(page)
    await page.getByLabel('发送给 PRTS 的消息').fill('请新建一个高优先级任务：AI 创建的晨星计划')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    const card = page.getByRole('region', { name: '新建任务：AI 创建的晨星计划' })
    // A labelled section is exposed as a region in Edge.
    await expect(card).toBeVisible()
    const before = await (await page.request.get('/api/state')).json()
    expect(
      before.documents.workspace.value.tasks.some(
        (task: { title: string }) => task.title === 'AI 创建的晨星计划',
      ),
    ).toBe(false)
    await card.getByText('查看修改预览', { exact: true }).click()
    await expect(card.locator('pre')).toContainText('AI 创建的晨星计划')
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
      await card.scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      await page.screenshot({ path: `/tmp/prts-assistant-action-${width}.png` })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await card.getByRole('button', { name: '确认执行', exact: true }).click()
    await expect(card.getByText('已执行', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '任务中枢' }).click()
    await expect(page.getByText('AI 创建的晨星计划', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'PRTS 助手' }).click()
    await expect(page.getByText('已执行', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText('已执行', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})

async function batchChat(
  page: import('@playwright/test').Page,
  theme: 'rhodes' | 'rhine' = 'rhodes',
  changes?: {
    operation: 'create_task' | 'create_calendar_event'
    fields: Record<string, unknown>
  }[],
) {
  let replies = 0
  const upstream = createServer(async (request, response) => {
    let body = ''
    for await (const part of request) body += part
    const payload = JSON.parse(body)
    const message =
      payload.messages.at(-1).role === 'tool'
        ? { content: '博士，本轮计划已整理，请查看操作结果。' }
        : {
            content: null,
            tool_calls: changes
              ? [
                  {
                    id: randomUUID(),
                    type: 'function',
                    function: {
                      name: 'propose_workspace_changes',
                      arguments: JSON.stringify({ changes }),
                    },
                  },
                ]
              : ['A', 'B'].map((suffix) => ({
                  id: randomUUID(),
                  type: 'function',
                  function: {
                    name: 'propose_workspace_change',
                    arguments: JSON.stringify({
                      operation: 'create_task',
                      fields: { title: `批量计划 ${replies} ${suffix}` },
                    }),
                  },
                })),
          }
    if (payload.messages.at(-1).role !== 'tool') replies++
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message }] }))
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('No upstream port')
  await page.request.post('/api/auth/login', { data: { password: 'prts-e2e-test-password-only' } })
  const settings = await (await page.request.get('/api/settings/ai')).json()
  expect(
    (
      await page.request.put('/api/settings/ai', {
        data: {
          ...settings,
          baseUrl: `http://127.0.0.1:${address.port}`,
          model: 'batch-test',
          apiKey: 'batch-fake-only',
        },
      })
    ).ok(),
  ).toBe(true)
  const state = await (await page.request.get('/api/state')).json()
  expect(
    (
      await page.request.put('/api/state/preferences', {
        data: {
          value: {
            ...state.documents.preferences.value,
            appearance: { theme, portrait: 'amiya' },
            assistantMode: 'ai',
          },
          expectedRevision: state.documents.preferences.revision,
          mutationId: randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.goto('/#assistant')
  await expect(page.getByRole('checkbox', { name: '自动确认工作台操作' })).not.toBeChecked()
  await expect(page.locator('.chat-welcome')).toBeVisible()
  return async () => {
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
}
async function requestBatch(page: import('@playwright/test').Page, prompt = '请创建两个任务') {
  await page.getByLabel('发送给 PRTS 的消息').fill(prompt)
  await expect(page.getByLabel('发送给 PRTS 的消息')).toHaveValue(prompt)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
  await waitSaved(page)
}

for (const theme of ['rhodes', 'rhine'] as const) {
  test(`${theme}: one card confirms an entire reply, refreshes tasks and persists batch status`, async ({
    page,
  }) => {
    const close = await batchChat(page, theme)
    try {
      await requestBatch(page)
      const card = page.getByRole('region', { name: '工作台操作 · 2 项' })
      await expect(card).toHaveCount(1)
      await card.getByText('查看修改预览', { exact: true }).click()
      await expect(card.locator('pre')).toHaveCount(2)
      await expect(card.getByRole('button', { name: '确认全部', exact: true })).toBeEnabled()
      const state = await (await page.request.get('/api/state')).json()
      expect(
        state.documents.workspace.value.tasks.filter((task: { title: string }) =>
          task.title.startsWith('批量计划'),
        ),
      ).toHaveLength(0)
      await page.setViewportSize({ width: 320, height: 850 })
      await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
      await card.scrollIntoViewIfNeeded()
      const bounds = await card.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
          x: rect.x,
          right: rect.right,
          width: rect.width,
          scroll: element.scrollWidth,
          viewport: innerWidth,
          parent: element.closest('.chat-messages')?.scrollWidth,
        }
      })
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport)
      expect(bounds.scroll).toBeLessThanOrEqual(Math.ceil(bounds.width))
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      await page.screenshot({ path: `/tmp/prts-batch-${theme}-mobile.png` })
      await card.getByRole('button', { name: '确认全部', exact: true }).click()
      await expect(card.getByText('已全部执行 · 2 项', { exact: true })).toBeVisible()
      await page.reload()
      await expect(card.getByText('已全部执行 · 2 项', { exact: true })).toBeVisible()
      const applied = await (await page.request.get('/api/state')).json()
      expect(
        applied.documents.workspace.value.tasks.filter((task: { title: string }) =>
          task.title.startsWith('批量计划'),
        ),
      ).toHaveLength(2)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.getByRole('button', { name: '任务中枢', exact: true }).click()
      await expect(page.getByText('批量计划 0 A', { exact: true })).toBeVisible()
      await expect(page.getByText('批量计划 0 B', { exact: true })).toBeVisible()
    } finally {
      await close()
    }
  })
}

for (const theme of ['rhodes', 'rhine'] as const) {
  test(`${theme}: a 50-item batch has a keyboard-scrollable preview, confirms once and survives refresh`, async ({
    page,
  }) => {
    const titles = Array.from(
      { length: 50 },
      (_, index) => `大批次任务 ${String(index + 1).padStart(2, '0')}`,
    )
    const close = await batchChat(
      page,
      theme,
      titles.map((title) => ({
        operation: 'create_task',
        fields: { title, priority: 'high', dueDate: '2030-06-10' },
      })),
    )
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    try {
      await requestBatch(page, '请创建以下50项任务，并统一等待我确认。')
      const card = page.getByRole('region', { name: '工作台操作 · 50 项', exact: true })
      await expect(page.locator('.assistant-action')).toHaveCount(1)
      await expect(card).toContainText('等待确认 · 50 项')
      await card.getByText('查看修改预览', { exact: true }).click()
      const preview = card.getByRole('list', { name: '操作修改预览', exact: true })
      await expect(preview.getByRole('listitem')).toHaveCount(50)
      await expect(card.locator('pre')).toHaveCount(50)
      const pending = await (await page.request.get('/api/state')).json()
      expect(
        pending.documents.workspace.value.tasks.filter((task: { title: string }) =>
          task.title.startsWith('大批次任务 '),
        ),
      ).toHaveLength(0)
      const cancel = card.getByRole('button', { name: '取消全部', exact: true })
      const confirm = card.getByRole('button', { name: '确认全部', exact: true })
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: width === 320 ? 850 : 1000 })
        const metrics = await preview.evaluate((element) => ({
          visible: element.clientHeight,
          content: element.scrollHeight,
        }))
        expect(metrics.visible).toBeLessThanOrEqual(360)
        expect(metrics.content).toBeGreaterThan(metrics.visible * 5)
        await preview.evaluate((element) => {
          element.scrollTop = 0
        })
        await preview.focus()
        await expect(preview).toBeFocused()
        await page.keyboard.press('PageDown')
        await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
        await page.keyboard.press('Tab')
        await expect(cancel).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(confirm).toBeFocused()
        await expect(confirm).toBeInViewport()
        await expect(cancel).toBeInViewport()
        const previewBounds = await preview.boundingBox()
        const cancelBounds = await cancel.boundingBox()
        expect(cancelBounds!.y).toBeGreaterThanOrEqual(previewBounds!.y + previewBounds!.height)
        const bounds = await card.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        )
        await page.screenshot({ path: `/tmp/prts-batch-50-${theme}-${width}.png` })
      }
      await confirm.click()
      await expect(card.getByText('已全部执行 · 50 项', { exact: true })).toBeVisible()
      await expect(card.getByRole('button')).toHaveCount(0)
      await waitSaved(page)
      const saved = await (await page.request.get('/api/state')).json()
      expect(
        saved.documents.workspace.value.tasks
          .filter((task: { title: string }) => task.title.startsWith('大批次任务 '))
          .map((task: { title: string }) => task.title)
          .sort(),
      ).toEqual(titles)
      await page.reload()
      await expect(page.locator('.assistant-action')).toHaveCount(1)
      await expect(card.getByText('已全部执行 · 50 项', { exact: true })).toBeVisible()
      await expect(card.getByRole('button')).toHaveCount(0)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.getByRole('button', { name: '任务中枢', exact: true }).click()
      await expect(page.getByText(titles[0], { exact: true })).toBeVisible()
      await expect(page.getByText(titles[49], { exact: true })).toBeVisible()
      expect(errors).toEqual([])
    } finally {
      await close()
    }
  })
}

test('large overlap warnings remain keyboard-scrollable while batch controls stay reachable on mobile', async ({
  page,
}) => {
  const close = await batchChat(
    page,
    'rhodes',
    Array.from({ length: 50 }, (_, index) => ({
      operation: 'create_calendar_event' as const,
      fields: {
        title: `重叠安排 ${index + 1}`,
        allDay: false,
        startAt: '2030-06-10T09:00:00+08:00',
        endAt: '2030-06-10T10:00:00+08:00',
      },
    })),
  )
  try {
    await page.setViewportSize({ width: 320, height: 850 })
    await requestBatch(page, '请准备这50项同期日程，保留时间重叠提醒，等待统一确认。')
    const card = page.getByRole('region', { name: '工作台操作 · 50 项', exact: true })
    const warnings = card.getByRole('list', { name: '录入提醒', exact: true })
    await expect(warnings).toContainText('时间重叠')
    expect(await warnings.getByRole('listitem').count()).toBeGreaterThan(50)
    const metrics = await warnings.evaluate((element) => ({
      visible: element.clientHeight,
      content: element.scrollHeight,
    }))
    expect(metrics.visible).toBeLessThanOrEqual(220)
    expect(metrics.content).toBeGreaterThan(metrics.visible * 5)
    await warnings.focus()
    await expect(warnings).toBeFocused()
    await page.keyboard.press('PageDown')
    await expect.poll(() => warnings.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    const cancel = card.getByRole('button', { name: '取消全部', exact: true })
    await cancel.focus()
    await expect(cancel).toBeInViewport()
    await expect(card.getByRole('button', { name: '确认全部', exact: true })).toBeInViewport()
    const warningBounds = await warnings.boundingBox()
    const cancelBounds = await cancel.boundingBox()
    expect(cancelBounds!.y).toBeGreaterThanOrEqual(warningBounds!.y + warningBounds!.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: '/tmp/prts-batch-50-overlap-mobile.png' })
    await cancel.click()
    await expect(card.getByText('已取消', { exact: true })).toBeVisible()
    const state = await (await page.request.get('/api/state')).json()
    expect(
      state.documents.workspace.value.calendarEvents.filter((event: { title: string }) =>
        event.title.startsWith('重叠安排 '),
      ),
    ).toHaveLength(0)
  } finally {
    await close()
  }
})

test('automatic confirmation persists, only affects future replies and can be switched off', async ({
  page,
}) => {
  const close = await batchChat(page, 'rhine')
  try {
    await requestBatch(page)
    const cards = page.getByRole('region', { name: '工作台操作 · 2 项' })
    await expect(cards.first().getByRole('button', { name: '确认全部', exact: true })).toBeEnabled()
    await page.getByRole('checkbox', { name: '自动确认工作台操作' }).check()
    await waitSaved(page)
    await page.reload()
    await expect(page.getByRole('checkbox', { name: '自动确认工作台操作' })).toBeChecked()
    await expect(cards.first().getByRole('button', { name: '确认全部', exact: true })).toBeVisible()
    await requestBatch(page)
    await expect(cards.nth(1).getByText('自动确认 · 已执行 2 项', { exact: true })).toBeVisible()
    await expect(cards.nth(1).getByRole('button')).toHaveCount(0)
    let state = await (await page.request.get('/api/state')).json()
    expect(state.documents.preferences.value.assistantAutoConfirm).toBe(true)
    expect(
      state.documents.workspace.value.tasks.filter((task: { title: string }) =>
        task.title.startsWith('批量计划'),
      ),
    ).toHaveLength(2)
    await cards.first().getByRole('button', { name: '取消全部', exact: true }).click()
    await expect(cards.first().getByText('已取消', { exact: true })).toBeVisible()
    await page.getByRole('checkbox', { name: '自动确认工作台操作' }).uncheck()
    await waitSaved(page)
    await requestBatch(page)
    await expect(cards.nth(2).getByRole('button', { name: '确认全部', exact: true })).toBeEnabled()
    await page.reload()
    await expect(page.getByRole('checkbox', { name: '自动确认工作台操作' })).not.toBeChecked()
    await expect(cards.nth(1).getByText('自动确认 · 已执行 2 项', { exact: true })).toBeVisible()
    state = await (await page.request.get('/api/state')).json()
    expect(
      state.documents.workspace.value.tasks.filter((task: { title: string }) =>
        task.title.startsWith('批量计划'),
      ),
    ).toHaveLength(2)
  } finally {
    await close()
  }
})
