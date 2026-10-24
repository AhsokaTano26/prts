import { test, expect, waitSaved } from './fixture'
import { chooseOption } from './select-helper'

test.beforeEach(async ({ page }) => {
  const password = process.env.PRTS_PASSWORD
  if (!password) throw new Error('请配置 PRTS_PASSWORD 后运行 Edge 验收。')
  const session = await page.request.post('/api/auth/login', { data: { password } })
  expect(session.ok()).toBe(true)
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { configured: true, model: 'mock-test', provider: 'Test' } }),
  )
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
})

test('Amiya illustration loads locally and remains visible on desktop and mobile', async ({
  page,
}) => {
  await page.goto('/')
  const portrait = page.locator('img.amiya-portrait')
  await expect(portrait).toBeVisible()
  await expect
    .poll(() => portrait.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(1024)
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
    await expect(portrait).toBeVisible()
    if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    if (width !== 768)
      await page.screenshot({ path: `/tmp/prts-amiya-${width}.png`, fullPage: true })
  }
})

test('personality and knowledge choices persist and reach AI requests with readable references', async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = []
  await page.route('**/api/chat', async (route) => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({
      json: {
        message: '博士，我们可以一起理清这段资料。[1]',
        persona: 'amiya',
        sources: [
          {
            id: 'amiya-1',
            title: '阿米娅 / 档案',
            source: 'arknights',
            sourceLabel: '明日方舟 · 官方原文',
            url: 'https://prts.wiki/w/Amiya',
            excerpt: '用于验收的来源摘要',
            lineStart: 1,
            lineEnd: 3,
          },
        ],
      },
    })
  })
  await page.goto('/#assistant')
  await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
  await chooseOption(page, 'AI 性格', '阿米娅 · 温和鼓励')
  await chooseOption(page, '参考语料', '仅明日方舟')
  await expect(page.getByRole('heading', { name: '博士，我们一起慢慢来。' })).toBeVisible()
  await waitSaved(page)
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'AI 性格', exact: true })).toContainText('阿米娅')
  await expect(page.getByRole('combobox', { name: '参考语料', exact: true })).toContainText(
    '仅明日方舟',
  )
  await page.getByLabel('发送给 PRTS 的消息', { exact: true }).fill('介绍阿米娅')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-label')).toContainText('阿米娅')
  await page.getByText('参考资料 · 1 条', { exact: true }).click()
  await expect(page.getByRole('link', { name: '阿米娅 / 档案' })).toHaveAttribute(
    'href',
    'https://prts.wiki/w/Amiya',
  )
  expect(requests[0].persona).toBe('amiya')
  expect(requests[0].knowledge).toBe('arknights')
  await chooseOption(page, 'AI 性格', '凯尔希 · 严谨直言')
  await expect(page.locator('.chat-message')).toHaveCount(0)
  await waitSaved(page)
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'AI 性格', exact: true })).toContainText('凯尔希')
  await expect(page.locator('.chat-message')).toHaveCount(0)
  await chooseOption(page, 'AI 性格', '阿米娅 · 温和鼓励')
  await expect(page.locator('.chat-message.assistant .message-label')).toContainText('阿米娅')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
    if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-persona-${width}.png`, fullPage: true })
  }
})

test('persona conversations stay separate through switching, reload and clearing', async ({
  page,
}) => {
  const requests: { persona: string; messages: { content: string; persona: string }[] }[] = []
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON()
    requests.push(payload)
    await route.fulfill({
      json: { persona: payload.persona, message: `${payload.persona} 专属回复` },
    })
  })
  await page.goto('/#assistant')
  await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
  const input = page.getByLabel('发送给 PRTS 的消息', { exact: true })
  const send = async (text: string) => {
    await input.fill(text)
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page.locator('.chat-thinking')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled()
    await waitSaved(page)
  }
  await chooseOption(page, 'AI 性格', '阿米娅 · 温和鼓励')
  await send('只告诉阿米娅的事情')
  await expect(page.locator('.chat-message')).toHaveCount(2)
  await chooseOption(page, 'AI 性格', '凯尔希 · 严谨直言')
  await expect(page.locator('.chat-message')).toHaveCount(0)
  await send('只告诉凯尔希的事情')
  await chooseOption(page, 'AI 性格', '阿米娅 · 温和鼓励')
  await expect(page.locator('.chat-message')).toHaveCount(2)
  await send('继续刚才的事情')
  expect(requests[2].messages.map((m) => m.content)).toEqual([
    '只告诉阿米娅的事情',
    'amiya 专属回复',
    '继续刚才的事情',
  ])
  expect(requests[2].messages.every((m) => m.persona === 'amiya')).toBe(true)
  await page.reload()
  await expect(page.locator('.chat-message')).toHaveCount(4)
  await page.getByRole('button', { name: '清空对话', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('阿米娅')
  await page.getByRole('button', { name: '确认清空', exact: true }).click()
  await expect(page.locator('.chat-message')).toHaveCount(0)
  await chooseOption(page, 'AI 性格', '凯尔希 · 严谨直言')
  await expect(page.locator('.chat-message')).toHaveCount(2)
  await expect(page.locator('.chat-messages')).toContainText('只告诉凯尔希的事情')
})

test('Amiya timeout offers a gentle retry without saving a fake reply or losing input', async ({
  page,
}) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({ status: 504, json: { error: 'AI 响应超时，请稍后重试。' } }),
  )
  await page.goto('/#assistant')
  await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
  await chooseOption(page, 'AI 性格', '阿米娅 · 温和鼓励')
  await page.getByLabel('发送给 PRTS 的消息', { exact: true }).fill('今天有点累')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('博士')
  await expect(page.getByRole('alert')).toContainText('休息')
  await expect(page.getByRole('alert')).toContainText('超时')
  await expect(page.getByLabel('发送给 PRTS 的消息', { exact: true })).toHaveValue('今天有点累')
  await expect(page.locator('.chat-message')).toHaveCount(0)
  const history = await (await page.request.get('/api/messages?mode=ai&persona=amiya')).json()
  expect(history.messages).toHaveLength(0)
  await page.route('**/api/chat', (route) =>
    route.fulfill({ json: { persona: 'amiya', message: '博士，那我们先休息一会儿吧。' } }),
  )
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.chat-message.assistant')).toContainText(
    '博士，那我们先休息一会儿吧。',
  )
})

test('slow replies can be stopped and responses for a different persona are rejected', async ({
  page,
}) => {
  let release: () => void = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = false
  let requestCount = 0
  await page.route('**/api/chat', async (route) => {
    started = true
    requestCount += 1
    await pending
    await route.fulfill({ json: { persona: 'amiya', message: '迟来的回复' } }).catch(() => {})
  })
  await page.goto('/#assistant')
  await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
  await chooseOption(page, 'AI 性格', '阿米娅 · 温和鼓励')
  await page.clock.install()
  const input = page.getByLabel('发送给 PRTS 的消息', { exact: true })
  await input.fill('请陪我整理一下思路')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect.poll(() => started).toBe(true)
  await page.clock.runFor(20_001)
  await expect(page.locator('.chat-thinking')).toContainText('博士，回复还需要一点时间')
  await page.clock.resume()
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('博士，已经停止了')
  await expect(input).toHaveValue('请陪我整理一下思路')
  expect(requestCount).toBe(1)
  release()
  await expect(page.locator('.chat-message')).toHaveCount(0)
  await page.route('**/api/chat', (route) =>
    route.fulfill({ json: { persona: 'kaltsit', message: '错误人格的回复' } }),
  )
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('回复人格与当前会话不一致')
  await expect(page.locator('.chat-message')).toHaveCount(0)
  const history = await (await page.request.get('/api/messages?mode=ai&persona=amiya')).json()
  expect(history.messages).toHaveLength(0)
})

test('an older history response cannot leak messages into the newly selected persona', async ({
  page,
}) => {
  const rows = Array.from({ length: 64 }, (_, index) => ({
    id: `paged-amiya-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: `阿米娅的第${index}条`,
    mode: 'ai',
    ...(index % 2 ? { persona: 'amiya' } : {}),
  }))
  expect((await page.request.post('/api/messages', { data: { messages: rows } })).ok()).toBe(true)
  await page.goto('/#assistant')
  await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
  await chooseOption(page, 'AI 性格', '阿米娅 · 温和鼓励')
  await expect(page.locator('.chat-message')).toHaveCount(60)
  await page.getByRole('button', { name: '加载更早记录', exact: true }).click()
  await expect(page.locator('.chat-message')).toHaveCount(64)
  await expect(page.locator('.chat-message').first()).toContainText('阿米娅的第0条')
  let release: () => void = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = false
  await page.route('**/api/messages?mode=ai&persona=prts&limit=60', async (route) => {
    const response = await route.fetch()
    started = true
    await pending
    await route.fulfill({ response })
  })
  await chooseOption(page, 'AI 性格', 'PRTS · 理性分析')
  await expect.poll(() => started).toBe(true)
  await chooseOption(page, 'AI 性格', '阿米娅 · 温和鼓励')
  await expect(page.locator('.chat-message')).toHaveCount(60)
  release()
  await expect(page.locator('.chat-message')).toHaveCount(60)
  await expect(page.getByRole('button', { name: '加载更早记录', exact: true })).toBeVisible()
})

test('both complete local corpora can be searched without an AI key and offer author download links', async ({
  page,
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { configured: false, model: 'mock-test', provider: 'Test' } }),
  )
  await page.goto('/#assistant')
  await page.getByRole('button', { name: '语料检索', exact: true }).click()
  await expect(page.getByText('已内置 34,007 篇文档', { exact: true })).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByRole('link', { name: '下载明日方舟语料包', exact: true })).toHaveAttribute(
    'href',
    'https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-arknights',
  )
  await expect(
    page.getByRole('link', { name: '下载明日方舟：终末地语料包', exact: true }),
  ).toHaveAttribute('href', 'https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-endfield')
  await chooseOption(page, '检索作品', '明日方舟')
  await page.getByRole('button', { name: '阿米娅', exact: true }).click()
  await expect(page.locator('.knowledge-results > li').first()).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.knowledge-results')).toContainText('阿米娅')
  await expect(page.locator('.knowledge-result-meta').first()).toContainText('明日方舟')
  await page.getByLabel('搜索语料库', { exact: true }).fill('管理员')
  await chooseOption(page, '检索作品', '终末地')
  await expect(page.locator('.knowledge-result-count')).toContainText('管理员', { timeout: 15000 })
  await expect(page.locator('.knowledge-results > li').first()).toBeVisible()
  await expect(page.locator('.knowledge-result-meta').first()).toContainText('终末地')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
    if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-corpus-${width}.png`, fullPage: true })
    if (width === 390) {
      await page.locator('.knowledge-results > li').first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: '/tmp/prts-corpus-results-390.png', fullPage: true })
    }
  }
})
