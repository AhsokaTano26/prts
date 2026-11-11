import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { test, expect, waitSaved } from './fixture'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' })
test.beforeEach(async ({ page }) => {
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
})

test('统一数字控件支持步进、键盘、边界与三主题小屏', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#settings/maps')
  const zoom = page.getByRole('spinbutton', { name: '默认缩放级别', exact: true })
  await zoom.fill('18')
  const controls = zoom.locator('..')
  await expect(controls.getByRole('button', { name: '增加数值', exact: true })).toBeDisabled()
  await controls.getByRole('button', { name: '减小数值', exact: true }).click()
  await expect(zoom).toHaveValue('17')
  await zoom.press('ArrowDown')
  await expect(zoom).toHaveValue('16')
  await zoom.fill('1')
  await expect(controls.getByRole('button', { name: '减小数值', exact: true })).toBeDisabled()
  const latitude = page.getByRole('spinbutton', { name: '默认中心纬度', exact: true })
  await latitude.fill('-30.000001')
  await latitude.press('ArrowUp')
  await expect(latitude).toHaveValue('-30')
  for (const theme of ['rhodes', 'rhine', 'endfield']) {
    const preferences = (await (await page.request.get('/api/state')).json()).documents.preferences
    expect(
      (
        await page.request.put('/api/state/preferences', {
          data: {
            value: {
              ...preferences.value,
              appearance: { portrait: 'amiya', ...preferences.value.appearance, theme },
            },
            expectedRevision: preferences.revision,
            mutationId: randomUUID(),
          },
        })
      ).ok(),
    ).toBe(true)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
      await page
        .getByRole('spinbutton', { name: '默认中心经度', exact: true })
        .scrollIntoViewIfNeeded()
      expect(
        await page.locator('.map-settings').evaluate((e) => e.scrollWidth > e.clientWidth),
      ).toBe(false)
      await page.screenshot({ path: `/tmp/prts-controls-${theme}-${width}.png`, fullPage: true })
    }
  }
  expect(errors).toEqual([])
})

test('地点表单使用页内校验和取消提示，不弹出浏览器原生对话框', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.type())
    await dialog.dismiss()
  })
  await page.goto('/#places')
  await page.getByRole('button', { name: '添加地点', exact: true }).click()
  const form = page.getByRole('dialog', { name: '添加地点', exact: true })
  await form.getByLabel('收藏理由', { exact: true }).focus()
  await form.locator('form').evaluate((element: HTMLFormElement) => element.requestSubmit())
  await expect(form.getByRole('alert')).toContainText('请填写地点名称')
  await expect(form.getByLabel('地点名称', { exact: true })).toBeFocused()
  await form.getByLabel('地点名称', { exact: true }).fill('取消测试饭馆')
  await form.getByRole('button', { name: '取消', exact: true }).click()
  await expect(form.getByRole('button', { name: '继续编辑', exact: true })).toBeVisible()
  await form.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(form.getByLabel('地点名称', { exact: true })).toHaveValue('取消测试饭馆')
  await form.getByRole('button', { name: '取消', exact: true }).click()
  await form.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(dialogs).toEqual([])
})

test('AI 通过操作预览添加地点，确认前不写入，确认后清单和刷新保留', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const upstream = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    const payload = JSON.parse(raw)
    const message =
      payload.messages.at(-1).role === 'tool'
        ? { content: '已准备地点收藏，请核对下方资料后确认。' }
        : {
            content: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: 'function',
                function: {
                  name: 'propose_workspace_change',
                  arguments: JSON.stringify({
                    operation: 'create_place',
                    fields: {
                      name: 'AI 河畔饭馆',
                      type: 'restaurant',
                      city: '成都',
                      desire: 'high',
                      tags: ['周末', '聚餐'],
                      note: '试试砂锅',
                      budget: '人均约 80 元',
                    },
                  }),
                },
              },
            ],
          }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message }] }))
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  try {
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('No upstream address')
    const settings = await (await page.request.get('/api/settings/ai')).json()
    expect(
      (
        await page.request.put('/api/settings/ai', {
          data: {
            ...settings,
            baseUrl: `http://127.0.0.1:${address.port}`,
            model: 'places-controls-e2e',
            apiKey: 'e2e-fake-only',
          },
        })
      ).ok(),
    ).toBe(true)
    await page.goto('/#assistant')
    await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
    await waitSaved(page)
    await page
      .getByLabel('发送给 PRTS 的消息', { exact: true })
      .fill('把 AI 河畔饭馆加入想去，在成都，周末聚餐试试砂锅。')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    const card = page.locator('.assistant-action').filter({ hasText: 'AI 河畔饭馆' })
    await expect(card).toBeVisible()
    expect(
      (await (await page.request.get('/api/state')).json()).documents.workspace.value.places,
    ).toEqual([])
    await card.getByText('查看修改预览', { exact: true }).click()
    await expect(card.locator('pre')).toContainText('成都')
    await expect(card.locator('pre')).toContainText('周末')
    await card.getByRole('button', { name: '确认执行', exact: true }).click()
    await expect(card.getByText('已执行', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '想去', exact: true }).click()
    await expect(page.getByRole('link', { name: 'AI 河畔饭馆', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('link', { name: 'AI 河畔饭馆', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})
