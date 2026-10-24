import { test, expect, waitSaved } from './fixture'
import { chooseOption } from './select-helper'

test.beforeEach(async ({ page }) => {
  // Keep UI checks independent of the user's live AI provider configuration.
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: { configured: false, model: 'gpt-4.1-mini', provider: 'OpenAI' },
    }),
  )
  const password = process.env.PRTS_PASSWORD
  if (!password) throw new Error('请配置 PRTS_PASSWORD 后运行 Edge 验收。')
  const session = await page.request.post('/api/auth/login', { data: { password } })
  expect(session.ok()).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '欢迎回来，博士。' })).toBeVisible()
  await page
    .locator('.motion-page')
    .evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)))
})

test('overview and all modules render without page errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.screenshot({ path: '/tmp/prts-desktop.png', fullPage: true })
  for (const [nav, heading] of [
    ['任务中枢', '任务中枢.'],
    ['个人档案', '个人档案'],
    ['文件资料库', '文件资料库'],
    ['PRTS 助手', 'PRTS 助手.'],
    ['系统设置', '系统设置.'],
  ]) {
    await page
      .locator('.sidebar')
      .getByRole('button', { name: new RegExp(nav) })
      .click()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('task creation, completion, edit, deletion, and persistence', async ({ page }) => {
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '新建任务', exact: true })).toBeVisible()
  await page.getByLabel('任务内容', { exact: true }).fill('整理 PRTS 测试记录')
  await chooseOption(page, '优先级', '高优先级')
  await page.getByRole('button', { name: '创建任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '整理 PRTS 测试记录', exact: true })).toBeVisible()
  await waitSaved(page)
  await page.reload()
  await page.getByRole('checkbox', { name: '完成任务：整理 PRTS 测试记录', exact: true }).click()
  await page
    .locator('.sidebar')
    .getByRole('button', { name: /任务中枢/ })
    .click()
  await page.getByRole('button', { name: '已完成', exact: false }).first().click()
  await expect(
    page.getByRole('checkbox', { name: '恢复任务：整理 PRTS 测试记录', exact: true }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: '编辑任务：整理 PRTS 测试记录', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('已整理的测试记录')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.getByRole('button', { name: '编辑任务：已整理的测试记录', exact: true }).click()
  await page.getByRole('button', { name: '删除任务', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('button', { name: '已整理的测试记录', exact: true })).toHaveCount(0)
})

test('notes save empty title and Markdown across reloads', async ({ page }) => {
  await page
    .locator('.sidebar')
    .getByRole('button', { name: /个人档案/ })
    .click()
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  await page.getByLabel('笔记标题', { exact: true }).fill('')
  await expect(page.locator('.storage-warning')).toHaveCount(0)
  await page.getByLabel('笔记标题', { exact: true }).fill('QA 笔记')
  await page
    .getByLabel('笔记正文', { exact: true })
    .fill('# 验证内容\n\n**这是一条记录**\n\n- 自动保存\n- 本地存储')
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.getByRole('heading', { name: '验证内容', exact: true })).toBeVisible()
  await waitSaved(page)
  await page.reload()
  await page.getByRole('button', { name: /QA 笔记/ }).click()
  await expect(page.getByLabel('笔记正文', { exact: true })).toHaveValue(/自动保存/)
  await page.screenshot({ path: '/tmp/prts-notes.png', fullPage: true })
})

test('real files survive reload and can be downloaded and deleted', async ({ page }) => {
  await page
    .locator('.sidebar')
    .getByRole('button', { name: /文件资料库/ })
    .click()
  await expect(page.getByRole('heading', { name: '为你的资料，留一个位置。' })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({
    name: 'qa-reference.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('PRTS local storage verification'),
  })
  await expect(page.getByText('qa-reference.txt', { exact: true })).toBeVisible()
  await waitSaved(page)
  await page.reload()
  await expect(page.getByText('qa-reference.txt', { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 qa-reference.txt', exact: true }).click()
  expect((await downloadPromise).suggestedFilename()).toBe('qa-reference.txt')
  await page.getByRole('button', { name: /删除.*qa-reference/ }).click()
  await page.getByRole('button', { name: '确认删除 qa-reference.txt', exact: true }).click()
  await expect(page.getByText('qa-reference.txt', { exact: true })).toHaveCount(0)
})

test('command palette finds notes and keyboard selection works', async ({ page }) => {
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox').fill('作品集')
  await expect(page.getByRole('option', { name: /个人作品集 · 改版思路/ })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('个人作品集 · 改版思路')
})

test('assistant local commands work and unconfigured AI is explicit', async ({ page }) => {
  await page
    .locator('.sidebar')
    .getByRole('button', { name: /PRTS 助手/ })
    .click()
  await page.getByRole('button', { name: '查看笔记', exact: true }).click()
  await expect(page.locator('.message-body').last()).toContainText('找到了 4 篇笔记')
  await page.getByLabel('发送给 PRTS 的消息', { exact: true }).fill('新建任务：完成本地指令测试')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.message-body').last()).toContainText('已添加任务')
  await expect(page.locator('.sidebar').getByRole('button', { name: /任务中枢/ })).toContainText(
    '05',
  )
  await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
  await expect(page.getByRole('button', { name: '连接 AI 服务', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled()
  await page.screenshot({ path: '/tmp/prts-assistant.png', fullPage: true })
})

test('focus timer pauses, resets, and restores across reload', async ({ page }) => {
  await page.getByRole('button', { name: '开始专注', exact: true }).click()
  await expect(page.getByRole('button', { name: '暂停专注', exact: true })).toBeVisible()
  await waitSaved(page)
  await page.reload()
  await expect(page.getByRole('button', { name: '暂停专注', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '暂停专注', exact: true }).click()
  const paused = await page.locator('.timer-digits').innerText()
  await page.waitForTimeout(1100)
  await expect(page.locator('.timer-digits')).toHaveText(paused)
  await page.getByRole('button', { name: '重置专注计时', exact: true }).click()
  await expect(page.locator('.timer-digits')).toHaveText('25:00')
})

test('settings backup round-trip and invalid import do not destroy data', async ({ page }) => {
  await page
    .locator('.sidebar')
    .getByRole('button', { name: /系统设置/ })
    .click()
  await page.getByLabel('博士代号', { exact: true }).fill('测试博士')
  await page.getByRole('button', { name: '保存偏好', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  const path = await (await downloadPromise).path()
  expect(path).toBeTruthy()
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":99}'),
  })
  await expect(page.getByRole('status').filter({ hasText: '暂不支持此数据版本' })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(path!)
  await expect(page.getByRole('heading', { name: '确认导入工作台备份' })).toBeVisible()
  await page.getByRole('button', { name: '确认替换并导入' }).click()
  await waitSaved(page)
  await page.reload()
  await expect(page.getByLabel('博士代号', { exact: true })).toHaveValue('测试博士')
})

for (const width of [1440, 1280, 1024, 768, 390, 320]) {
  test(`responsive layout ${width}px has no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    expect(overflow).toBe(false)
    await expect(
      page.getByRole('button', { name: '搜索任务、笔记或文件', exact: true }),
    ).toBeVisible()
    if (width >= 768) {
      await expect(
        page.locator('.sidebar').getByRole('button', { name: '任务中枢', exact: true }),
      ).toBeVisible()
      await expect(
        page.locator('.sidebar').getByRole('button', { name: '系统设置', exact: true }),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: /^个人设置：/ })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeVisible()
    if (width <= 390) {
      await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
      await page.screenshot({ path: `/tmp/prts-mobile-${width}.png`, fullPage: true })
      await page.getByRole('button', { name: '打开导航', exact: true }).click()
      await page
        .locator('.sidebar')
        .getByRole('button', { name: /个人档案/ })
        .click()
      await page.getByRole('button', { name: '新建笔记', exact: true }).click()
      await expect(page.getByLabel('笔记正文', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '返回笔记列表', exact: true }).click()
      await expect(page.getByRole('searchbox')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
    }
    if (width <= 390) await page.getByRole('button', { name: '打开导航', exact: true }).click()
    await page.locator('.sidebar').getByRole('button', { name: '系统设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '系统设置.', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    if (width === 1440 || width === 390) {
      await page
        .locator('.motion-page')
        .evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)))
      if (width <= 390) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
      await page.screenshot({ path: `/tmp/prts-settings-${width}.png`, fullPage: true })
    }
  })
}

test('boot sequence auto-completes, skips, and respects reduced motion', async ({ page }) => {
  await page
    .locator('.sidebar')
    .getByRole('button', { name: /系统设置/ })
    .click()
  await page.getByRole('button', { name: '重播启动动画', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'PRTS 启动序列' })).toBeVisible()
  await expect(page.locator('.boot-sequence')).toHaveAttribute('data-phase', 'prepare')
  await page.screenshot({ path: '/tmp/prts-boot.png' })
  await expect(page.locator('.boot-sequence')).toHaveCount(0, { timeout: 3000 })
  await page.getByRole('button', { name: '重播启动动画', exact: true }).click()
  await page.getByRole('button', { name: '跳过启动', exact: true }).click()
  await expect(page.locator('.boot-sequence')).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '重播启动动画', exact: true }).click()
  await expect(page.locator('.boot-sequence')).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('checkbox', { name: /终端动态效果/ }).uncheck()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await expect(page.getByRole('button', { name: '重播启动动画', exact: true })).toBeDisabled()
  await waitSaved(page)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
})

test('corrupt stored data remains recoverable after a new edit', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('prts-workspace-v1', '{broken-original'))
  await waitSaved(page)
  await page.reload()
  await expect(page.locator('.storage-warning')).toBeVisible()
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('恢复后的新任务')
  await page.getByRole('button', { name: '创建任务', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('prts-workspace-v1'))).toBe(
    '{broken-original',
  )
  await waitSaved(page)
  await page.reload()
  await expect(page.getByRole('button', { name: '恢复后的新任务', exact: true })).toBeVisible()
  await expect(page.locator('.storage-warning')).toBeVisible()
})

test('AI request retry has one user turn and does not load remote images', async ({ page }) => {
  const remoteImages: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('https://outside.example/')) remoteImages.push(request.url())
  })
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { configured: true, model: 'mock-test', provider: 'Test' } }),
  )
  let attempts = 0
  const histories: unknown[][] = []
  await page.route('**/api/chat', async (route) => {
    histories.push(route.request().postDataJSON().messages)
    attempts += 1
    await route.fulfill(
      attempts === 1
        ? { status: 502, json: { error: '模拟上游暂时不可用' } }
        : {
            json: {
              message: '可以从一个小目标开始。\n\n![external](https://outside.example/test.png)',
            },
          },
    )
  })
  await waitSaved(page)
  await page.reload()
  await page
    .locator('.sidebar')
    .getByRole('button', { name: /PRTS 助手/ })
    .click()
  await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
  await page.getByLabel('发送给 PRTS 的消息', { exact: true }).fill('帮我规划今天')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('模拟上游暂时不可用')
  await expect(page.locator('.chat-message.user')).toHaveCount(0)
  await expect(page.getByLabel('发送给 PRTS 的消息', { exact: true })).toHaveValue('帮我规划今天')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.chat-message.assistant')).toContainText('可以从一个小目标开始')
  await expect(page.locator('.chat-message.user')).toHaveCount(1)
  await expect(page.locator('.chat-message .markdown-content img')).toHaveCount(0)
  expect(remoteImages).toEqual([])
  expect(histories.map((messages) => messages.length)).toEqual([1, 1])
})
