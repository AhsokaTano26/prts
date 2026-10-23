import { test, expect } from './fixture'
import { chooseOption } from './select-helper'

test.beforeEach(async ({ page }) => {
  const password = process.env.PRTS_PASSWORD
  if (!password) throw new Error('请配置 PRTS_PASSWORD 后运行 Edge 验收。')
  expect((await page.request.post('/api/auth/login', { data: { password } })).ok()).toBe(true)
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { configured: false, model: 'mock', provider: 'Test' } }),
  )
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
})

test('real Talos-II excerpts render headings, lists and the matching local game image', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#assistant')
  await page.getByRole('button', { name: '语料检索', exact: true }).click()
  await chooseOption(page, '检索作品', '终末地')
  await page.getByLabel('搜索语料库', { exact: true }).fill('塔卫二')
  await page.getByRole('button', { name: '检索', exact: true }).click()
  const definition = page
    .locator('.knowledge-results > li')
    .filter({ has: page.getByRole('link', { name: '塔卫二 · 定义与位置', exact: true }) })
  await expect(definition).toBeVisible()
  await expect(definition.getByRole('heading', { name: '定义与位置', exact: true })).toBeVisible()
  await expect(definition.locator('ul > li')).toHaveCount(3)
  await expect(definition).not.toContainText('##')
  const aurora = page
    .locator('.knowledge-results > li')
    .filter({ has: page.getByRole('link', { name: '塔卫二的极光', exact: true }) })
  await expect(aurora).not.toContainText('<image>')
  await expect(aurora).not.toContainText('Reading/document_aurora_intro')
  const picture = aurora.getByRole('img', { name: '塔卫二的极光', exact: true })
  await expect(picture).toBeVisible()
  await picture.scrollIntoViewIfNeeded()
  await expect
    .poll(() => picture.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBe(1024)
  await expect(aurora).not.toContainText('原文配图未收录')
  await expect(aurora).toContainText('第一次天使战争')
  await aurora.scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/prts-corpus-image-1440.png', fullPage: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
    if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    await definition.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-corpus-markdown-${width}.png`, fullPage: true })
    await picture.scrollIntoViewIfNeeded()
    await expect(picture).toBeVisible()
    expect(await picture.evaluate((img) => img.getBoundingClientRect().width <= innerWidth)).toBe(
      true,
    )
    await page.screenshot({ path: `/tmp/prts-corpus-image-${width}.png`, fullPage: true })
  }
  expect(errors).toEqual([])
})

test('AI references render Markdown without executing HTML or fetching embedded images', async ({
  page,
}) => {
  const externalRequests: string[] = []
  await page.route('https://corpus-image.invalid/**', (route) => {
    externalRequests.push(route.request().url())
    return route.abort()
  })
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { configured: true, model: 'mock', provider: 'Test' } }),
  )
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      json: {
        message: '参考资料如下。[1]',
        persona: 'prts',
        sources: [
          {
            id: 'rendering-fixture',
            title: '渲染验证资料',
            source: 'endfield',
            sourceLabel: '明日方舟：终末地',
            url: 'https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-endfield',
            excerpt: [
              '## 资料标题',
              '### 定义',
              '- **天然卫星**',
              '- 宜居环境',
              '> 引用内容',
              '<image>Reading/document_aurora_intro</image>',
              '![远程配图](https://corpus-image.invalid/remote.png)',
              '[来源页面](https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-endfield)',
              '[不安全链接](javascript:alert(1))',
              '`<image>Reading/literal_example</image>`',
              '<script>window.corpusMarkupExecuted = true</script>',
              '<img src="https://corpus-image.invalid/raw.png" onerror="window.corpusMarkupExecuted = true">',
              '正文结束。',
            ].join('\n\n'),
          },
        ],
      },
    }),
  )
  await page.goto('/#assistant')
  await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
  await page.getByLabel('发送给 PRTS 的消息', { exact: true }).fill('查看资料')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByText('参考资料 · 1 条', { exact: true }).click()
  const reference = page.locator('.knowledge-results.compact .corpus-markdown')
  await expect(reference.getByRole('heading', { name: '资料标题', level: 2 })).toBeVisible()
  await expect(reference.getByRole('heading', { name: '定义', level: 3 })).toBeVisible()
  await expect(reference.locator('ul > li')).toHaveCount(2)
  await expect(reference.locator('strong')).toHaveText('天然卫星')
  await expect(reference.locator('blockquote')).toContainText('引用内容')
  await expect(reference.locator('.corpus-image-placeholder')).toHaveCount(1)
  const picture = reference.getByRole('img', { name: '塔卫二的极光', exact: true })
  await expect(picture).toBeVisible()
  await expect
    .poll(() => picture.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBe(1024)
  await expect(reference.locator('code')).toHaveText('<image>Reading/literal_example</image>')
  await expect(reference.getByRole('link', { name: '来源页面' })).toHaveAttribute(
    'href',
    'https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-endfield',
  )
  await expect(reference.getByRole('link', { name: '不安全链接' })).toHaveCount(0)
  await expect(reference).not.toContainText('Reading/document_aurora_intro')
  await expect(reference).toContainText('正文结束。')
  await expect(reference.locator('img')).toHaveCount(1)
  await expect(reference.locator('script')).toHaveCount(0)
  expect(await page.evaluate(() => 'corpusMarkupExecuted' in window)).toBe(false)
  expect(externalRequests).toEqual([])
})

test('image variants recover from load failure and icons stay inline on mobile', async ({
  page,
}) => {
  let attempts = 0
  const femaleUrl = '/assets/corpus-images/reading/reading_sm2l3m5_madina_f.png'
  const maleUrl = '/assets/corpus-images/reading/reading_sm2l3m5_madina_m.png'
  await page.route(`**${femaleUrl}`, (route) => {
    attempts += 1
    return attempts === 1 ? route.fulfill({ status: 404, body: '' }) : route.continue()
  })
  await page.route('**/api/knowledge/search?**', (route) =>
    route.fulfill({
      json: {
        results: [
          {
            id: 'variants-fixture',
            title: '合影与图标',
            source: 'endfield',
            sourceLabel: '终末地',
            url: 'https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-endfield',
            excerpt: [
              '<image>fm//Reading/reading_sm2l3m5_madina</image>',
              '行内图标 <image="WalletIcon/item_domain_tundra_coupon" scale=2> 与正文同行。',
              '<image>Reading/not_found</image>',
              '[![原图](/assets/corpus-images/reading/document_aurora_intro.png)](https://corpus-image.invalid/wrapper)',
            ].join('\n\n'),
          },
        ],
      },
    }),
  )
  await page.goto('/#assistant')
  await page.getByRole('button', { name: '语料检索', exact: true }).click()
  await page.getByRole('button', { name: '塔卫二', exact: true }).click()
  const result = page.locator('.knowledge-results > li').first()
  await expect(result.getByRole('button', { name: '女管理员', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(result.getByRole('status')).toContainText('图片暂不可用')
  await result.getByRole('button', { name: '男管理员', exact: true }).click()
  const male = result.locator(`img[src="${maleUrl}"]`)
  await expect(male).toBeVisible()
  await expect.poll(() => male.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1024)
  await expect(result.getByRole('button', { name: '男管理员', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(male.locator('..')).toHaveAttribute('href', maleUrl)
  await result.getByRole('button', { name: '女管理员', exact: true }).click()
  await expect
    .poll(() =>
      result
        .locator(`img[src="${femaleUrl}"]`)
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBe(1024)
  await expect(result.getByRole('status')).toHaveCount(0)
  await expect(result).toContainText('原文配图未收录')
  const icon = result.getByRole('img', { name: '调度券', exact: true })
  await expect(icon).toBeVisible()
  expect(await icon.evaluate((img) => img.getBoundingClientRect().width)).toBeLessThanOrEqual(32)
  await expect(result.locator('a a')).toHaveCount(0)
  await expect(result.locator('a[href*="corpus-image.invalid"]')).toHaveCount(0)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    await result.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-corpus-variants-${width}.png`, fullPage: true })
  }
})
