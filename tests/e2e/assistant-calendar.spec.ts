import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { test, expect, waitSaved } from './fixture'

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce', timezoneId: 'America/Los_Angeles' })

for (const [theme, automatic] of [
  ['rhodes', false],
  ['rhine', true],
] as const) {
  test(`${theme}: AI calendar CRUD reaches real cards, calendar and subscription (${automatic ? 'automatic' : 'manual'})`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    let range: { day: string; startAt: string; endAt: string }
    const upstream = createServer(async (request, response) => {
      let raw = ''
      for await (const part of request) raw += part
      const payload = JSON.parse(raw)
      const call = (name: string, args: unknown) => ({
        id: randomUUID(),
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      })
      const last = payload.messages.at(-1)
      const requestText = payload.messages
        .filter((item: { role: string }) => item.role === 'user')
        .at(-1).content
      let message
      if (!payload.messages[0].content.includes('"timeZone":"America/Los_Angeles"'))
        message = { content: '未收到客户端时区。' }
      else if (last.role !== 'tool')
        message = {
          content: null,
          tool_calls: [
            call('get_workspace', {}),
            call('search_workspace', {
              kind: 'events',
              query: 'AI 晨星评审',
              fromDate: range.day,
              toDate: range.day,
            }),
          ],
        }
      else {
        const result = JSON.parse(last.content)
        if (result.error) message = { content: `工具失败：${result.error}` }
        else if (result.action) message = { content: '博士，日程操作已准备，请查看下方结果。' }
        else {
          const existing = result.results?.[0]
          const operation = requestText.includes('删除')
            ? 'delete_calendar_event'
            : requestText.includes('全天')
              ? 'update_calendar_event'
              : 'create_calendar_event'
          const fields =
            operation === 'create_calendar_event'
              ? {
                  title: 'AI 晨星评审',
                  allDay: false,
                  startAt: range.startAt,
                  endAt: range.endAt,
                  location: '评审室',
                  description: '测试日程说明',
                }
              : operation === 'update_calendar_event'
                ? { allDay: true, startDate: range.day, endDate: range.day, location: '线上会议' }
                : {}
          message = {
            content: null,
            tool_calls: [
              ...(existing
                ? [call('read_workspace_item', { kind: 'event', id: existing.id })]
                : []),
              call('propose_workspace_change', {
                operation,
                ...(existing ? { id: existing.id } : {}),
                fields,
              }),
            ],
          }
        }
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message }] }))
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    try {
      const address = upstream.address()
      if (!address || typeof address === 'string') throw new Error('No upstream port')
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
              model: 'calendar-tools-test',
              apiKey: 'calendar-tools-fake-only',
            },
          })
        ).ok(),
      ).toBe(true)
      const preferences = (await (await page.request.get('/api/state')).json()).documents
        .preferences
      expect(
        (
          await page.request.put('/api/state/preferences', {
            data: {
              value: {
                ...preferences.value,
                appearance: { theme, portrait: 'amiya' },
                assistantMode: 'ai',
                assistantAutoConfirm: automatic,
              },
              expectedRevision: preferences.revision,
              mutationId: randomUUID(),
            },
          })
        ).ok(),
      ).toBe(true)
      await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
      await page.goto('/#assistant')
      range = await page.evaluate(() => {
        const start = new Date()
        start.setHours(9, 0, 0, 0)
        const end = new Date(start)
        end.setHours(10)
        return {
          day: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        }
      })
      const readEvents = async () =>
        (await (await page.request.get('/api/state')).json()).documents.workspace.value
          .calendarEvents
      const send = async (text: string, summary: string) => {
        await page.getByLabel('发送给 PRTS 的消息').fill(text)
        await page.getByRole('button', { name: '发送消息', exact: true }).click()
        const card = page.getByRole('region', { name: summary, exact: true })
        await expect(card).toBeVisible()
        await page
          .getByRole('button', { name: '停止生成', exact: true })
          .waitFor({ state: 'hidden' })
        await waitSaved(page)
        if (automatic)
          await expect(card.getByText('自动确认 · 已执行 1 项', { exact: true })).toBeVisible()
        return card
      }
      const create = await send(`新建今天09:00到10:00的日程：AI 晨星评审`, '新建日程：AI 晨星评审')
      await create.getByText('查看修改预览', { exact: true }).click()
      await expect(create.locator('pre')).toContainText('开始时间')
      await expect(create.locator('pre')).toContainText('结束时间')
      if (!automatic) {
        expect(await readEvents()).toHaveLength(0)
        await page.setViewportSize({ width: 320, height: 850 })
        await create.scrollIntoViewIfNeeded()
        expect(await create.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false)
        await page.screenshot({ path: '/tmp/prts-ai-calendar-manual-mobile.png' })
        await create.getByRole('button', { name: '确认执行', exact: true }).click()
        await expect(create.getByText('已执行', { exact: true })).toBeVisible()
        await page.setViewportSize({ width: 1440, height: 1000 })
      }
      expect(await readEvents()).toHaveLength(1)
      const subscription = await (await page.request.get('/api/calendar/subscription')).json()
      const enabled = await (
        await page.request.post('/api/calendar/subscription', {
          data: { action: 'enable', revision: subscription.revision },
        })
      ).json()
      const feedPath = `/api/calendar/feed.ics?token=${enabled.token}`
      expect(await (await page.request.get(feedPath)).text()).toContain('SUMMARY:AI 晨星评审')
      await page.getByRole('button', { name: '日历日程', exact: true }).click()
      await expect(page.getByRole('region', { name: '当日日程', exact: true })).toContainText(
        'AI 晨星评审',
      )
      await page.getByRole('button', { name: '日视图', exact: true }).click()
      await expect(
        page.locator('.timeline-block').filter({ hasText: 'AI 晨星评审' }),
      ).toContainText('09:00–10:00')
      await page.screenshot({ path: `/tmp/prts-ai-calendar-${theme}-day.png` })
      await page.getByRole('button', { name: 'PRTS 助手', exact: true }).click()
      const update = await send('把 AI 晨星评审改为今天全天日程', '更新日程：AI 晨星评审')
      if (!automatic) {
        expect((await readEvents())[0].allDay).toBe(false)
        await update.getByRole('button', { name: '确认执行', exact: true }).click()
        await expect(update.getByText('已执行', { exact: true })).toBeVisible()
      }
      expect((await readEvents())[0].allDay).toBe(true)
      const feed = await (await page.request.get(feedPath)).text()
      expect(feed).toContain(`DTSTART;VALUE=DATE:${range.day.replace(/-/g, '')}`)
      await page.getByRole('button', { name: '日历日程', exact: true }).click()
      await expect(
        page.getByRole('region', { name: '当日日程', exact: true }).locator('.calendar-event-time'),
      ).toContainText('全天')
      await page.getByRole('button', { name: 'PRTS 助手', exact: true }).click()
      const remove = await send('删除 AI 晨星评审 日程', '删除日程：AI 晨星评审')
      if (!automatic) {
        expect(await readEvents()).toHaveLength(1)
        await remove.getByRole('button', { name: '确认执行', exact: true }).click()
        await expect(remove.getByText('已执行', { exact: true })).toBeVisible()
      }
      expect(await readEvents()).toHaveLength(0)
      expect(await (await page.request.get(feedPath)).text()).not.toContain('SUMMARY:AI 晨星评审')
      await page.reload()
      await expect(
        page
          .getByRole('region', { name: '删除日程：AI 晨星评审', exact: true })
          .getByText(automatic ? '自动确认 · 已执行 1 项' : '已执行', { exact: true }),
      ).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      expect(errors).toEqual([])
    } finally {
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })
}
