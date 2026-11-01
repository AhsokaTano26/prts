import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { test, expect, waitSaved, type Page } from './fixture'
import { chooseOption } from './select-helper'

test.use({ serviceWorkers: 'block' })
const change = (operation: string, fields: object) => ({ operation, fields })
const task = change('create_task', {
  title: '提交报名材料',
  dueDate: '2026-11-04',
  priority: 'high',
})
const event = change('create_calendar_event', {
  title: '培训说明会',
  startAt: '2026-11-03T10:00:00+08:00',
  endAt: '2026-11-03T11:00:00+08:00',
  location: '会议室 A',
})
const tool = (name: string, args: unknown) => ({
  id: randomUUID(),
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

async function setup(page: Page, reply: (body: any, round: number) => object) {
  let round = 0
  const upstream = createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) text += chunk
    const message = reply(JSON.parse(text), round++)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message }] }))
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('Missing mock port')
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
          model: 'capture-e2e',
          apiKey: 'capture-test-only',
        },
      })
    ).ok(),
  ).toBe(true)
  const state = await (await page.request.get('/api/state')).json()
  const document = state.documents.workspace
  expect(
    (
      await page.request.put('/api/state/workspace', {
        data: {
          value: {
            ...document.value,
            tasks: [],
            calendarEvents: [
              {
                id: 'already-scheduled',
                title: '部门周会',
                description: '',
                location: '',
                allDay: false,
                startAt: '2026-11-03T09:30:00+08:00',
                endAt: '2026-11-03T10:30:00+08:00',
                createdAt: '2026-11-01T00:00:00Z',
                updatedAt: '2026-11-01T00:00:00Z',
              },
            ],
          },
          expectedRevision: document.revision,
          mutationId: randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  return async () => {
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
}

async function openChat(page: Page) {
  await page.goto('/#assistant')
  await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
  await chooseOption(page, 'AI 性格', '阿米娅 · 温和鼓励')
  await waitSaved(page)
}
async function send(page: Page, content: string) {
  await page.getByLabel('发送给 PRTS 的消息', { exact: true }).fill(content)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
  await waitSaved(page)
}

test('image notice becomes one mixed plan with overlap warnings, confirmation and durable results', async ({
  page,
}) => {
  const filename = '活动通知.png'
  let receivedImage = false
  const close = await setup(page, (body, round) => {
    if (round === 0)
      return {
        content: null,
        tool_calls: [tool('search_workspace', { kind: 'files', query: filename })],
      }
    if (round === 1)
      return {
        content: null,
        tool_calls: [
          tool('read_workspace_item', {
            kind: 'file',
            id: JSON.parse(body.messages.at(-1).content).results[0].id,
          }),
        ],
      }
    if (round === 2) {
      receivedImage = body.messages
        .at(-1)
        .content.some((part: { type: string }) => part.type === 'image_url')
      return {
        content: null,
        tool_calls: [
          tool('propose_workspace_changes', {
            changes: [
              task,
              event,
              change('create_task', { title: '携带签到表' }),
              change('create_calendar_event', {
                title: '全天布展',
                allDay: true,
                startDate: '2026-11-05',
                endDate: '2026-11-05',
              }),
            ],
          }),
        ],
      }
    }
    return {
      content:
        '博士，已从通知中整理两项任务、两项日程，等待确认；培训说明会与部门周会时间重叠，请核对。',
    }
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  try {
    await page.goto('/#files')
    await page.locator('input[type=file]').setInputFiles({
      name: filename,
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
        'base64',
      ),
    })
    await expect(page.getByText(filename, { exact: true })).toBeVisible()
    await openChat(page)
    await send(page, `请根据已上传的「${filename}」记录任务和日程。`)
    expect(receivedImage).toBe(true)
    const card = page.getByRole('region', { name: '工作台操作 · 4 项', exact: true })
    await expect(card).toBeVisible()
    await expect(card.getByRole('list', { name: '录入提醒' })).toContainText('部门周会')
    await expect(card.getByRole('list', { name: '录入提醒' })).toContainText('培训说明会')
    let state = (await (await page.request.get('/api/state')).json()).documents.workspace.value
    expect(state.tasks).toHaveLength(0)
    expect(state.calendarEvents).toHaveLength(1)
    await card.getByText('查看修改预览', { exact: true }).click()
    await expect(card.locator('pre')).toHaveCount(4)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
      await card.scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      await page.screenshot({ path: `/tmp/prts-agent-capture-${width}.png`, fullPage: true })
    }
    await card.getByRole('button', { name: '确认全部', exact: true }).click()
    await expect(card).toContainText('已全部执行')
    state = (await (await page.request.get('/api/state')).json()).documents.workspace.value
    expect(state.tasks.map((item: { title: string }) => item.title).sort()).toEqual([
      '提交报名材料',
      '携带签到表',
    ])
    expect(state.calendarEvents).toHaveLength(3)
    expect(
      state.calendarEvents.find((item: { title: string }) => item.title === '培训说明会').startAt,
    ).toBe('2026-11-03T10:00:00+08:00')
    await page.reload()
    await expect(card).toContainText('已全部执行')
    await expect(card.getByRole('list', { name: '录入提醒' })).toContainText('部门周会')
    expect(page.url()).toContain('#assistant')
    await expect(page).toHaveTitle(/PRTS/)
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await close()
  }
})

test('an incomplete notice asks for its missing time and records only the corrected batch', async ({
  page,
}) => {
  const close = await setup(page, (_body, round) => {
    if (round === 0)
      return {
        content: null,
        tool_calls: [
          tool('propose_workspace_changes', {
            changes: [
              task,
              change('create_calendar_event', {
                title: '培训说明会',
                startAt: '2026-11-03T10:00:00+08:00',
              }),
            ],
          }),
        ],
      }
    if (round === 1)
      return { content: '博士，培训说明会几点结束？结束时间尚未明确，本批安排还没有写入。' }
    if (round === 2)
      return {
        content: null,
        tool_calls: [tool('propose_workspace_changes', { changes: [task, event] })],
      }
    return { content: '博士，两项安排已整理，等待确认。' }
  })
  try {
    await openChat(page)
    await send(page, '记录：11月4日前交报名材料，11月3日10点开始培训说明会。')
    await expect(page.locator('.chat-message.assistant')).toContainText('几点结束')
    await expect(page.getByRole('button', { name: '确认全部', exact: true })).toHaveCount(0)
    expect(
      (await (await page.request.get('/api/state')).json()).documents.workspace.value.tasks,
    ).toHaveLength(0)
    await send(page, '培训说明会11点结束，地点会议室 A。')
    const card = page.getByRole('region', { name: '工作台操作 · 2 项', exact: true })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: '确认全部', exact: true }).click()
    await expect(card).toContainText('已全部执行')
    const state = (await (await page.request.get('/api/state')).json()).documents.workspace.value
    expect(state.tasks).toHaveLength(1)
    expect(state.calendarEvents).toHaveLength(2)
  } finally {
    await close()
  }
})
