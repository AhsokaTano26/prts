import { test, expect } from '@playwright/test'
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
  await expect(page.locator('.chat-message.assistant .message-label')).toContainText('阿米娅')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'AI 性格', exact: true })).toContainText('凯尔希')
  await expect(page.locator('.chat-message.assistant .message-label')).toContainText('阿米娅')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
    if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-persona-${width}.png`, fullPage: true })
  }
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
