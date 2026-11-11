import { test, expect, waitSaved } from './fixture'

test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ page }) => {
  const login = await page.request.post('/api/auth/login', {
    data: { password: 'prts-e2e-test-password-only' },
  })
  expect(login.ok()).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
})

test('map settings retain drafts, save independently, survive reload and can explicitly clear the key', async ({
  page,
}) => {
  const sdkRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('api.tianditu.gov.cn')) sdkRequests.push(request.url())
  })
  await page.goto('/#settings/maps')
  await expect(page.getByRole('heading', { name: '地图服务', exact: true })).toBeVisible()
  const key = page.getByLabel('天地图浏览器密钥', { exact: true })
  await key.fill('0123456789abcdef0123456789abcdef')
  await page.getByLabel('默认中心经度', { exact: true }).fill('116.397')
  await page.getByLabel('默认中心纬度', { exact: true }).fill('39.908')
  await page.getByLabel('默认缩放级别', { exact: true }).fill('12')
  const nav = page.getByRole('navigation', { name: '设置分类', exact: true })
  await nav.getByRole('link', { name: '常规偏好', exact: true }).click()
  await nav.getByRole('link', { name: '地图服务', exact: true }).click()
  await expect(key).toHaveValue('0123456789abcdef0123456789abcdef')
  await page.getByRole('button', { name: '保存地图设置', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '地图设置已保存' })).toBeVisible()
  await waitSaved(page)
  await page.reload()
  await expect(key).toHaveValue('0123456789abcdef0123456789abcdef')
  await expect(page.getByLabel('默认中心经度', { exact: true })).toHaveValue('116.397')
  await expect(page.getByLabel('默认中心纬度', { exact: true })).toHaveValue('39.908')
  expect(sdkRequests).toEqual([])
  const state = (await (await page.request.get('/api/state')).json()).documents
  expect(state.preferences.value.map.apiKey).toBe('0123456789abcdef0123456789abcdef')
  expect(state.preferences.value.appearance.theme).toBe('rhodes')
  await page.getByRole('button', { name: '清空密钥', exact: true }).click()
  await expect(key).toHaveValue('')
  await page.getByRole('button', { name: '保存地图设置', exact: true }).click()
  await waitSaved(page)
  await page.reload()
  await expect(key).toHaveValue('')
})

test('invalid coordinates retain the unsaved map draft without submitting preferences', async ({
  page,
}) => {
  await page.goto('/#settings/maps')
  const longitude = page.getByLabel('默认中心经度', { exact: true })
  await longitude.fill('181')
  await page.getByRole('button', { name: '保存地图设置', exact: true }).click()
  await expect(longitude).toHaveValue('181')
  const map = (await (await page.request.get('/api/state')).json()).documents.preferences.value.map
  expect(map?.center?.lng).not.toBe(181)
})
