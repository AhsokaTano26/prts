import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { test, expect, waitSaved } from './fixture'

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
