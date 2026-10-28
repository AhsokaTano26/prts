import { readFile } from 'node:fs/promises'
import { test, expect, waitSaved, type Page } from './fixture'
import { dateKey, addDays } from '../../src/lib/calendar'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' })
const today = dateKey(new Date())
const tomorrow = addDays(today, 1)
async function selectDay(page: Page, day: string) {
  await page.locator(`button[data-date="${day}"]`).click()
}
async function createEvent(page: Page, title: string, allDay = false) {
  await page.getByRole('button', { name: '新建日程', exact: true }).click()
  await page.getByLabel('日程标题', { exact: true }).fill(title)
  if (allDay) await page.getByRole('switch', { name: '全天日程', exact: true }).click()
  await page.getByRole('button', { name: '创建日程', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '新建日程', exact: true })).toHaveCount(0)
  await waitSaved(page)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  await page.goto('/#calendar')
})

test('calendar entry supports date navigation, keyboard selection and an empty day', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { name: '日历日程', exact: true })).toBeVisible({
    timeout: 2000,
  })
  await expect(page.locator('button[data-date]')).toHaveCount(42)
  const original = await page.locator('.calendar-month-title').textContent()
  await page.getByRole('button', { name: '下个月', exact: true }).click()
  await expect(page.locator('.calendar-month-title')).not.toHaveText(original!)
  await expect(page.getByText('这一天，还留有空白。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '今天', exact: true }).click()
  await expect(page.locator(`button[data-date="${today}"]`)).toHaveAttribute('aria-current', 'date')
  await page.locator(`button[data-date="${today}"]`).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator(`button[data-date="${tomorrow}"]`)).toBeFocused()
  await page.getByRole('button', { name: '任务中枢', exact: true }).click()
  await page.goBack()
  await expect(page.getByRole('heading', { name: '日历日程', exact: true })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', { name: '任务中枢.', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.locator('.calendar-month-title')).toBeVisible()
})

test('timed events persist, edit, exclude their midnight end date and delete after confirmation', async ({
  page,
}) => {
  await page.getByRole('button', { name: '新建日程', exact: true }).click()
  await page.getByLabel('日程标题', { exact: true }).fill('跨日讨论')
  await page.getByLabel('开始时间', { exact: true }).fill('23:00')
  await page.getByLabel('结束日期', { exact: true }).fill(tomorrow)
  await page.getByLabel('结束时间', { exact: true }).fill('00:00')
  await page.getByLabel('地点', { exact: true }).fill('线上会议')
  await page.getByRole('button', { name: '创建日程', exact: true }).click()
  const agenda = page.getByRole('region', { name: '当日日程', exact: true })
  await expect(agenda.getByRole('button', { name: /跨日讨论/ })).toBeVisible()
  await waitSaved(page)
  await page.reload()
  await expect(agenda.getByText('线上会议', { exact: true })).toBeVisible()
  await selectDay(page, tomorrow)
  await expect(agenda.getByRole('button', { name: /跨日讨论/ })).toHaveCount(0)
  await selectDay(page, today)
  await agenda.getByRole('button', { name: /跨日讨论/ }).click()
  await page.getByLabel('日程标题', { exact: true }).fill('已调整的讨论')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(agenda.getByRole('button', { name: /已调整的讨论/ })).toBeVisible()
  await agenda.getByRole('button', { name: /已调整的讨论/ }).click()
  await page.getByRole('button', { name: '删除日程', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(agenda.getByRole('button', { name: /已调整的讨论/ })).toHaveCount(0)
})

test('all-day events cover their inclusive date range and appear in global search', async ({
  page,
}) => {
  await page.getByRole('button', { name: '新建日程', exact: true }).click()
  await page.getByLabel('日程标题', { exact: true }).fill('项目出行安排')
  await page.getByRole('switch', { name: '全天日程', exact: true }).click()
  await page.getByLabel('结束日期', { exact: true }).fill(tomorrow)
  await page.getByRole('button', { name: '创建日程', exact: true }).click()
  await selectDay(page, tomorrow)
  await expect(
    page
      .getByRole('region', { name: '当日日程', exact: true })
      .getByRole('button', { name: /项目出行安排/ }),
  ).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('combobox').fill('项目出行安排')
  await page.getByRole('option', { name: /项目出行安排/ }).click()
  await expect(page.getByRole('dialog', { name: '编辑日程', exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: '全天日程', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})

test('calendar task actions share existing task state and deadline editing', async ({ page }) => {
  const tasks = page.getByRole('region', { name: '当日任务', exact: true })
  await tasks.getByRole('button', { name: '完善个人作品集', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill('日历里修改的任务')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await tasks.getByRole('checkbox', { name: '完成任务：日历里修改的任务', exact: true }).click()
  await expect(
    tasks.getByRole('checkbox', { name: '恢复任务：日历里修改的任务', exact: true }),
  ).toHaveAttribute('aria-checked', 'true')
  await waitSaved(page)
  await page.reload()
  await expect(
    tasks.getByRole('checkbox', { name: '恢复任务：日历里修改的任务', exact: true }),
  ).toHaveAttribute('aria-checked', 'true')
})

test('failed calendar saves preserve the dialog and all entered fields', async ({ page }) => {
  await page.route('**/api/state/workspace', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, json: { error: '隔离保存失败' } })
      : route.continue(),
  )
  await page.getByRole('button', { name: '新建日程', exact: true }).click()
  await page.getByLabel('日程标题', { exact: true }).fill('未保存的日程')
  await page.getByLabel('备注', { exact: true }).fill('失败后仍须保留')
  await page.getByRole('button', { name: '创建日程', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建日程', exact: true })
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('日程标题', { exact: true })).toHaveValue('未保存的日程')
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('失败后仍须保留')
})

test('backup export includes events and restoring an older backup explicitly clears them', async ({
  page,
}) => {
  await createEvent(page, '进入备份的日程', true)
  await page.goto('/#settings/data')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  const download = await downloadPromise
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(backup.calendarEvents[0].title).toBe('进入备份的日程')
  delete backup.calendarEvents
  await page.getByLabel('导入工作台备份', { exact: true }).setInputFiles({
    name: 'legacy.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  const dialog = page.getByRole('dialog', { name: '确认导入工作台备份', exact: true })
  await expect(dialog).toContainText('0 项日程')
  await dialog.getByRole('button', { name: '确认替换并导入', exact: true }).click()
  await waitSaved(page)
  await page.goto('/#calendar')
  await expect(
    page
      .getByRole('region', { name: '当日日程', exact: true })
      .getByRole('button', { name: /进入备份的日程/ }),
  ).toHaveCount(0)
})

test('Escape cannot hide a calendar editor while its save is pending or conceal a failed draft', async ({
  page,
}) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/state/workspace', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    await gate
    await route.fulfill({ status: 500, json: { error: '隔离延迟保存失败' } })
  })
  await page.getByRole('button', { name: '新建日程', exact: true }).click()
  await page.getByLabel('日程标题', { exact: true }).fill('请求中的日程')
  await page.getByRole('button', { name: '创建日程', exact: true }).click()
  try {
    await expect(page.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '新建日程', exact: true })).toBeVisible()
  } finally {
    release()
  }
  await expect(
    page.getByRole('dialog', { name: '新建日程', exact: true }).getByRole('alert'),
  ).toBeVisible()
  await expect(page.getByLabel('日程标题', { exact: true })).toHaveValue('请求中的日程')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '新建日程', exact: true })).toHaveCount(0)
})

test('both calendar themes remain usable on desktop, tablet and small phones without browser errors', async ({
  page,
}) => {
  // Appearance previews use downloaded game assets, outside this calendar fixture.
  await page.route(/\/assets\/(amiya|priestess|kaltsit)\.png$/, (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (entry) => {
    if (entry.type() === 'error') errors.push(entry.text())
  })
  await createEvent(page, '项目设计评审')
  await createEvent(page, '资料归档与阶段复盘', true)
  await expect(page.locator('.toast')).toHaveCount(0)
  for (const theme of ['rhodes', 'rhine']) {
    await page.setViewportSize({ width: 1440, height: 900 })
    if (theme === 'rhine') {
      await page.goto('/#settings/appearance')
      await page.getByRole('radio', { name: '明日方舟：莱茵生命', exact: true }).check()
      await page.getByRole('button', { name: '保存外观', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await waitSaved(page)
      await page.goto('/#calendar')
      await expect(page.locator('.toast')).toHaveCount(0)
    }
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [768, 1024],
      [390, 844],
      [320, 640],
    ]) {
      await page.setViewportSize({ width, height })
      await page.locator('.main-content').evaluate((el) => el.scrollTo(0, 0))
      await expect(page).toHaveTitle(/PRTS/)
      await expect(page.getByRole('heading', { name: '日历日程', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      expect(
        await page.locator('.main-content').evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      ).toBe(false)
      await expect(page.locator('vite-error-overlay')).toHaveCount(0)
      await page.screenshot({ path: `/tmp/prts-calendar-${theme}-${width}.png` })
    }
    await page.getByRole('button', { name: '新建日程', exact: true }).click()
    await page.getByLabel('日程标题', { exact: true }).fill('手机上的安排')
    const dialog = page.getByRole('dialog', { name: '新建日程', exact: true })
    expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false)
    const startDateBox = await page.getByLabel('开始日期', { exact: true }).boundingBox()
    const endDateBox = await page.getByLabel('结束日期', { exact: true }).boundingBox()
    expect(endDateBox!.y).toBeGreaterThan(startDateBox!.y + startDateBox!.height)
    await page.screenshot({ path: `/tmp/prts-calendar-${theme}-dialog-320.png` })
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '打开导航', exact: true }).click()
    await page
      .locator('.sidebar')
      .getByRole('button', { name: '系统设置', exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      page.locator('.sidebar').getByRole('button', { name: '系统设置', exact: true }),
    ).toBeInViewport()
    await page.getByRole('button', { name: '关闭导航', exact: true }).last().click()
  }
  expect(errors).toEqual([])
})
