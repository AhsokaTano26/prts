import { test as base, expect, type Page } from '@playwright/test'
export { expect }
export type { Page }
export const test = base.extend<{ isolatedDatabase: void }>({
  isolatedDatabase: [
    async ({ request }, use) => {
      const response = await request.post('/__test/reset', {
        headers: { 'x-prts-test': 'isolated-browser-test' },
        data: {},
      })
      expect(response.ok()).toBe(true)
      await use()
    },
    { auto: true },
  ],
})

export async function waitSaved(page: Page) {
  if (await page.locator('.statusbar').count())
    await expect(page.locator('.statusbar')).toContainText('SQLite · 已保存到服务器')
  await expect(page.getByText('正在保存对话…', { exact: true })).toHaveCount(0)
}
