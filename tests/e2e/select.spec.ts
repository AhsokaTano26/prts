import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const password = process.env.PRTS_PASSWORD
  if (!password) throw new Error('请配置 PRTS_PASSWORD 后运行 Edge 验收。')
  expect((await page.request.post('/api/auth/login', { data: { password } })).ok()).toBe(true)
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { configured: true, model: 'mock', provider: 'Test' } }),
  )
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
})

test('styled assistant selects support keyboard selection, dismissal and persistence', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#assistant')
  await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
  const persona = page.getByRole('combobox', { name: 'AI 性格', exact: true })
  await persona.click()
  await expect(persona).toHaveAttribute('aria-expanded', 'true')
  const options = page.getByRole('listbox')
  await expect(options).toBeVisible()
  await expect(options.getByRole('option')).toHaveCount(3)
  expect(await options.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    'rgb(255, 255, 255)',
  )
  await page.screenshot({
    path: '/tmp/prts-select-1440.png',
    fullPage: true,
    animations: 'disabled',
  })
  await persona.click()
  await expect(persona).toHaveAttribute('aria-expanded', 'false')
  await persona.click()
  await persona.press('End')
  await persona.press('Enter')
  await expect(persona).toContainText('凯尔希')
  await expect(persona).toHaveAttribute('aria-expanded', 'false')
  await expect(persona).toBeFocused()
  await page.reload()
  await expect(persona).toContainText('凯尔希')
  await persona.press('Space')
  await expect(options).toBeVisible()
  await persona.press('Home')
  await persona.press('Enter')
  await expect(persona).toContainText('PRTS')
  await persona.press('ArrowDown')
  await persona.press('End')
  await persona.press('Escape')
  await expect(persona).toContainText('PRTS')
  await expect(persona).toHaveAttribute('aria-expanded', 'false')
  await persona.click()
  await page.getByRole('heading', { name: 'PRTS 助手.' }).click()
  await expect(persona).toHaveAttribute('aria-expanded', 'false')
  await persona.click()
  await persona.press('Tab')
  await expect(persona).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('combobox', { name: '参考语料', exact: true })).toBeFocused()
  expect(errors).toEqual([])
})

test('select options stay visible and usable inside a task dialog at narrow widths', async ({
  page,
}) => {
  await page.goto('/#tasks')
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const priority = dialog.getByRole('combobox', { name: '优先级', exact: true })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await priority.click()
    const list = page.getByRole('listbox')
    await expect(list).toBeVisible()
    const box = await list.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    await page.screenshot({
      path: `/tmp/prts-select-dialog-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('option', { name: '高优先级', exact: true }).click()
    await expect(priority).toContainText('高优先级')
    await expect(dialog).toBeVisible()
    await expect(priority).toBeFocused()
    await priority.click()
    await priority.press('Escape')
    await expect(priority).toHaveAttribute('aria-expanded', 'false')
    await expect(dialog).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  }
})
