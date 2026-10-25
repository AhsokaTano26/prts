import { test, expect, type Page } from './fixture'

const password = 'prts-e2e-test-password-only'

async function openSettings(page: Page, section: 'ai' | 'security' = 'ai') {
  expect((await page.request.post('/api/auth/login', { data: { password } })).ok()).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.goto(`/#settings/${section}`)
  await expect(
    page.getByLabel(section === 'ai' ? 'AI 服务地址' : '当前密码', { exact: true }),
  ).toBeVisible()
}

test('AI configuration saves to the server, survives reload and never returns the key', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openSettings(page)
  await page.getByLabel('AI 服务地址', { exact: true }).fill('https://provider.example/v1')
  await page.getByLabel('AI 模型', { exact: true }).fill('test-model')
  await page.getByLabel('API 密钥', { exact: true }).fill('runtime-settings-test-key-only')
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click()
  await expect(page.getByText('AI 配置已保存，下次对话立即生效。', { exact: true })).toBeVisible()
  await expect(page.getByLabel('API 密钥', { exact: true })).toHaveValue('')
  const response = await page.request.get('/api/settings/ai')
  const data = await response.json()
  expect(data).toMatchObject({
    baseUrl: 'https://provider.example/v1',
    model: 'test-model',
    hasApiKey: true,
  })
  expect(JSON.stringify(data)).not.toContain('runtime-settings-test-key-only')
  await page.reload()
  await expect(page.getByLabel('AI 模型', { exact: true })).toHaveValue('test-model')
  await expect(page.getByLabel('API 密钥', { exact: true })).toHaveValue('')
  await expect(page.getByText('密钥已保存；留空保留现有密钥。', { exact: true })).toBeVisible()
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
    if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    await page.getByRole('button', { name: '保存 AI 配置', exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-runtime-settings-${width}.png`, fullPage: true })
  }
  expect(errors).toEqual([])
})

test('a concurrent AI update requires reload before clearing the stored key', async ({ page }) => {
  await openSettings(page)
  const initial = await (await page.request.get('/api/settings/ai')).json()
  expect(
    (
      await page.request.put('/api/settings/ai', {
        data: {
          baseUrl: initial.baseUrl,
          revision: initial.revision,
          apiKey: 'concurrent-test-key-only',
          model: 'peer-model',
        },
      })
    ).ok(),
  ).toBe(true)
  await page.getByLabel('AI 模型', { exact: true }).fill('stale-model')
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新加载 AI 配置', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重新加载 AI 配置', exact: true }).click()
  await expect(page.getByLabel('AI 模型', { exact: true })).toHaveValue('peer-model')
  await page.getByLabel('清除已保存的 API 密钥', { exact: true }).check()
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click()
  await expect(page.getByText('尚未保存 API 密钥。', { exact: true })).toBeVisible()
  expect((await (await page.request.get('/api/settings/ai')).json()).hasApiKey).toBe(false)
})

test('changing password validates input, locks every session and accepts only the new password', async ({
  page,
  browser,
}) => {
  await openSettings(page, 'security')
  const peer = await browser.newContext({ baseURL: 'http://127.0.0.1:8791' })
  try {
    expect((await peer.request.post('/api/auth/login', { data: { password } })).ok()).toBe(true)
    await page.getByLabel('当前密码', { exact: true }).fill('incorrect-test-password')
    await page.getByLabel('新密码', { exact: true }).fill('updated-test-password-only')
    await page.getByLabel('确认新密码', { exact: true }).fill('different-test-password-only')
    await page.getByRole('button', { name: '修改密码并重新登录', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('两次输入的新密码不一致')
    await page.getByLabel('确认新密码', { exact: true }).fill('updated-test-password-only')
    await page.getByRole('button', { name: '修改密码并重新登录', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('密码')
    await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible()
    await page.getByLabel('当前密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '修改密码并重新登录', exact: true }).click()
    await expect(page.getByRole('heading', { name: '终端访问验证', exact: true })).toBeVisible()
    expect((await peer.request.get('/api/state')).status()).toBe(401)
    expect((await page.request.post('/api/auth/login', { data: { password } })).status()).toBe(401)
    await page.getByLabel('访问密码', { exact: true }).fill('updated-test-password-only')
    await page.getByRole('button', { name: '验证并进入', exact: true }).click()
    await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible()
  } finally {
    await peer.close()
  }
})
