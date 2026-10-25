import { createHash } from 'node:crypto'
import { test, expect, waitSaved, type Page } from './fixture'

async function prepare(page: Page, migratedBrowserIds: string[] = []) {
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  const preferences = (await (await page.request.get('/api/state')).json()).documents.preferences
  expect(
    (
      await page.request.put('/api/state/preferences', {
        data: {
          value: {
            ...preferences.value,
            appearance: { theme: 'rhine', portrait: 'kaltsit' },
            migratedBrowserIds,
          },
          expectedRevision: preferences.revision,
          mutationId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  await page.addInitScript(() => {
    sessionStorage.setItem('prts-boot-seen', '1')
    localStorage.setItem('prts-motion', 'off')
  })
}

test('migrating legacy browser preferences preserves the server theme and portrait', async ({
  page,
}) => {
  await prepare(page)
  await page.goto('/#settings/appearance')
  await page.getByRole('button', { name: '迁移浏览器旧数据', exact: true }).click()
  await page.getByRole('button', { name: '确认迁移并替换工作台', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '迁移浏览器旧数据', exact: true })).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rhine')
  await expect(page.getByRole('radio', { name: '凯尔希', exact: true })).toBeChecked()
  await waitSaved(page)
  const saved = (await (await page.request.get('/api/state')).json()).documents.preferences.value
  expect(saved.motionEnabled).toBe(false)
  expect(saved.appearance).toEqual({ theme: 'rhine', portrait: 'kaltsit' })
  await page.reload()
  await expect(page.getByRole('heading', { name: '外观主题', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '迁移浏览器旧数据', exact: true })).toHaveCount(0)
})

test('adding appearance defaults does not change an already migrated legacy browser fingerprint', async ({
  page,
}) => {
  const legacyFingerprint = JSON.stringify({
    raw: null,
    preferences: {
      motionEnabled: false,
      assistant: { persona: 'prts', knowledge: 'all' },
      assistantMode: 'local',
    },
    focus: null,
    messages: [],
    files: [],
  })
  const sourceId = createHash('sha256').update(legacyFingerprint).digest('hex')
  await prepare(page, [sourceId])
  await page.goto('/#settings/appearance')
  await expect(page.getByRole('heading', { name: '外观主题', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '迁移浏览器旧数据', exact: true })).toHaveCount(0)
  const saved = (await (await page.request.get('/api/state')).json()).documents.preferences.value
  expect(saved.migratedBrowserIds).toEqual([sourceId])
})

test('theme changes update browser install metadata and restore original Rhodes URLs', async ({
  page,
}) => {
  await prepare(page)
  await page.goto('/#settings/appearance')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest-rhine.webmanifest',
  )
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/icons/rhine-lab-192.png')
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('type', 'image/png')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/icons/rhine-lab-180.png',
  )
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f0f2ed')
  await page.getByRole('radio', { name: '明日方舟：罗德岛', exact: true }).check()
  await page.getByRole('button', { name: '保存外观', exact: true }).click()
  await waitSaved(page)
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  )
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/rhodes-island.svg')
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('type', 'image/svg+xml')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/icons/rhodes-island-apple-180.png',
  )
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#111315')
})
