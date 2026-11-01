import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { test, expect, waitSaved } from './fixture'
import { chooseOption } from './select-helper'

test.use({ serviceWorkers: 'block' })

test('an uploaded image reaches Amiya as vision input and the reply persists', async ({ page }) => {
  const filename = 'e926aa552b2ff626acc6820d91d1b6c2.png'
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
    'base64',
  )
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  let receivedImage = false
  let requests = 0
  const upstream = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body)
    requests++
    const call = (name: string, args: unknown) => ({
      id: randomUUID(),
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    })
    const last = payload.messages.at(-1)
    let message
    if (requests === 1)
      message = {
        content: null,
        tool_calls: [call('search_workspace', { kind: 'files', query: filename })],
      }
    else if (requests === 2) {
      const found = JSON.parse(last.content).results[0]
      message = {
        content: null,
        tool_calls: [call('read_workspace_item', { kind: 'file', id: found.id })],
      }
    } else {
      receivedImage =
        last.role === 'user' &&
        Array.isArray(last.content) &&
        last.content.some(
          (part: { type: string; image_url?: { url: string } }) =>
            part.type === 'image_url' &&
            part.image_url?.url === `data:image/png;base64,${image.toString('base64')}`,
        )
      message = {
        content: receivedImage
          ? '博士，图片内容已经收到，可以分析画面了。'
          : '博士，我只能看到文件的登记信息。',
      }
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
            model: 'vision-e2e',
            apiKey: 'vision-test-only',
          },
        })
      ).ok(),
    ).toBe(true)
    await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
    await page.goto('/#files')
    await expect(page.getByRole('heading', { name: '为你的资料，留一个位置。' })).toBeVisible()
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: filename, mimeType: 'image/png', buffer: image })
    await expect(page.getByText(filename, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'PRTS 助手', exact: true }).click()
    await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
    await chooseOption(page, 'AI 性格', '阿米娅 · 温和鼓励')
    await waitSaved(page)
    await page
      .getByLabel('发送给 PRTS 的消息', { exact: true })
      .fill(`你能看到这张图片「${filename}」嘛？`)
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page.locator('.chat-message.assistant')).toContainText('图片内容已经收到')
    expect(receivedImage).toBe(true)
    expect(requests).toBe(3)
    await waitSaved(page)
    await page.reload()
    await expect(page.locator('.chat-message.assistant')).toContainText('图片内容已经收到')
    await expect(page.locator('.chat-message.assistant .message-label')).toContainText('阿米娅')
    await page.getByText('对话与操作说明', { exact: true }).click()
    await expect(page.locator('.assistant-access-note')).toContainText('图片')
    expect(page.url()).toContain('#assistant')
    await expect(page).toHaveTitle(/PRTS/)
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      await page.screenshot({ path: `/tmp/prts-assistant-image-${width}.png`, fullPage: true })
    }
    expect(errors).toEqual([])
  } finally {
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})
