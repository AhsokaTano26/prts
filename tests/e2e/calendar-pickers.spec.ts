import { test, expect, waitSaved } from './fixture'
import { dateKey, addDays } from '../../src/lib/calendar'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' })
const today = dateKey(new Date())

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.request.post('/api/auth/login', {
    data: { password: 'prts-e2e-test-password-only' },
  })
  await page.goto('/#calendar')
  await page.getByRole('button', { name: '新建日程', exact: true }).click()
})

test('custom calendar and time panels support keyboard selection, dismissal and persistence', async ({
  page,
}) => {
  const editor = page.getByRole('dialog', { name: '新建日程', exact: true })
  await expect(
    editor.locator('input[type=date], input[type=time], input[type=checkbox], select'),
  ).toHaveCount(0)
  await page.getByLabel('日程标题', { exact: true }).fill('自定义选择器安排')
  await page.getByRole('button', { name: '选择开始日期', exact: true }).click()
  const dates = page.getByRole('dialog', { name: '选择开始日期', exact: true })
  await expect(dates).toBeVisible()
  await expect(dates.getByRole('gridcell', { name: today, exact: true })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(dates.getByRole('gridcell', { name: addDays(today, 1), exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('开始日期', { exact: true })).toHaveValue(addDays(today, 1))
  await expect(dates).not.toBeVisible()
  await expect(page.getByRole('button', { name: '选择开始日期', exact: true })).toBeFocused()
  await page.getByLabel('开始日期', { exact: true }).fill(today)
  await page.getByRole('button', { name: '选择结束日期', exact: true }).click()
  const endDates = page.getByRole('dialog', { name: '选择结束日期', exact: true })
  await expect(
    endDates.getByRole('gridcell', { name: addDays(today, -1), exact: true }),
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(editor).toBeVisible()
  await expect(endDates).not.toBeVisible()
  await page.getByRole('button', { name: '选择开始时间', exact: true }).click()
  const times = page.getByRole('dialog', { name: '选择开始时间', exact: true })
  await times
    .getByRole('listbox', { name: '小时', exact: true })
    .getByRole('option', { name: '08', exact: true })
    .click()
  await times
    .getByRole('listbox', { name: '分钟', exact: true })
    .getByRole('option', { name: '17', exact: true })
    .click()
  await times.getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('08:17')
  await page.getByRole('switch', { name: '全天日程', exact: true }).click()
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveCount(0)
  await page.getByRole('switch', { name: '全天日程', exact: true }).press('Space')
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('08:17')
  await page.getByRole('button', { name: '创建日程', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await waitSaved(page)
  await page.reload()
  await page
    .getByRole('region', { name: '当日日程', exact: true })
    .getByRole('button', { name: /自定义选择器安排/ })
    .click()
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('08:17')
})

test('date panel handles leap days, year limits, manual input and task deadline clearing', async ({
  page,
}) => {
  await page.getByLabel('开始日期', { exact: true }).fill('2028-02-29')
  await page.getByRole('button', { name: '选择开始日期', exact: true }).click()
  const dates = page.getByRole('dialog', { name: '选择开始日期', exact: true })
  await expect(dates.getByRole('gridcell', { name: '2028-02-29', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await dates.getByLabel('年份', { exact: true }).focus()
  await dates.getByLabel('年份', { exact: true }).press('Tab')
  await expect(dates.getByRole('button', { name: '下个月', exact: true })).toBeFocused()
  await dates.getByRole('button', { name: '下个月', exact: true }).click()
  await expect(dates.getByLabel('年份', { exact: true })).toHaveValue('2028')
  await dates.getByLabel('年份', { exact: true }).fill('2024')
  await dates.getByLabel('年份', { exact: true }).press('Tab')
  await expect(dates.getByRole('button', { name: '下个月', exact: true })).toBeFocused()
  await expect(dates.getByRole('gridcell', { name: '2024-03-01', exact: true })).toBeVisible()
  await dates.getByLabel('年份', { exact: true }).fill('0001')
  await dates.getByLabel('年份', { exact: true }).press('Enter')
  await expect(dates.getByRole('gridcell', { name: '0001-03-01', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByLabel('开始日期', { exact: true }).fill('9999-12-31')
  await page.getByRole('button', { name: '选择开始日期', exact: true }).click()
  await expect(dates.getByRole('button', { name: '下个月', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await page
    .getByRole('dialog', { name: '新建日程', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click()
  await page
    .getByRole('region', { name: '当日任务', exact: true })
    .getByRole('button', { name: '完善个人作品集', exact: true })
    .click()
  const task = page.getByRole('dialog', { name: '编辑任务', exact: true })
  await expect(task.locator('input[type=date], input[type=time], select')).toHaveCount(0)
  await page.getByRole('button', { name: '选择截止日期', exact: true }).click()
  await page
    .getByRole('dialog', { name: '选择截止日期', exact: true })
    .getByRole('button', { name: '清除日期', exact: true })
    .click()
  await expect(page.getByLabel('截止日期', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await waitSaved(page)
  const state = await (await page.request.get('/api/state')).json()
  expect(
    state.documents.workspace.value.tasks.find(
      (task: { title: string }) => task.title === '完善个人作品集',
    ).dueDate,
  ).toBe('')
})

test('custom fields show inline validation and preserve invalid drafts without writing events', async ({
  page,
}) => {
  const editor = page.getByRole('dialog', { name: '新建日程', exact: true })
  await page.getByLabel('日程标题', { exact: true }).fill('检查输入校验')
  await page.getByLabel('开始日期', { exact: true }).fill('2026-02-30')
  await page.getByRole('button', { name: '创建日程', exact: true }).click()
  await expect(page.getByLabel('开始日期', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('开始日期', { exact: true })).toBeFocused()
  await expect(
    editor.getByText('请输入有效日期，格式为 YYYY-MM-DD。', { exact: true }),
  ).toBeVisible()
  await page.getByLabel('开始日期', { exact: true }).fill(today)
  await page.getByLabel('开始时间', { exact: true }).fill('25:00')
  await page.getByRole('button', { name: '创建日程', exact: true }).click()
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(
    editor.getByText('请输入有效的 24 小时时间，格式为 HH:mm。', { exact: true }),
  ).toBeVisible()
  await expect(editor).toBeVisible()
  const state = await (await page.request.get('/api/state')).json()
  expect(state.documents.workspace.value.calendarEvents).toEqual([])
})

test('custom panels fit both themes on desktop and small mobile without closing the editor', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const theme of ['rhodes', 'rhine']) {
    await page
      .locator('html')
      .evaluate((element, value) => element.setAttribute('data-theme', value), theme)
    for (const [width, height] of [
      [1440, 900],
      [768, 1024],
      [390, 844],
      [320, 640],
    ]) {
      await page.setViewportSize({ width, height })
      for (const field of ['开始日期', '开始时间']) {
        await page.getByRole('button', { name: `选择${field}`, exact: true }).click()
        const panel = page.getByRole('dialog', { name: `选择${field}`, exact: true })
        await expect(panel).toBeVisible()
        // Popover toggle and viewport resize events position the panel asynchronously.
        await expect(async () => {
          const box = (await panel.boundingBox())!
          expect(box.x).toBeGreaterThanOrEqual(7)
          expect(box.x + box.width).toBeLessThanOrEqual(width - 7)
          expect(box.y).toBeGreaterThanOrEqual(7)
          expect(box.y + box.height).toBeLessThanOrEqual(height - 7)
        }).toPass({ timeout: 2000 })
        if (field === '开始日期') {
          await expect(panel.getByRole('button', { name: '今天', exact: true })).toBeInViewport()
        } else {
          for (const list of await panel.getByRole('listbox').all()) {
            const selected = list.getByRole('option', { selected: true })
            await expect(selected).toBeInViewport()
            const selectedBox = (await selected.boundingBox())!
            const listBox = (await list.boundingBox())!
            expect(selectedBox.y).toBeGreaterThanOrEqual(listBox.y)
            expect(selectedBox.y + selectedBox.height).toBeLessThanOrEqual(
              listBox.y + listBox.height,
            )
          }
        }
        expect(
          await panel.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
        ).toBe(false)
        await expect(page.locator('vite-error-overlay')).toHaveCount(0)
        await expect(page).toHaveTitle(/PRTS/)
        await page.screenshot({
          path: `/tmp/prts-pickers-${theme}-${width}-${field === '开始日期' ? 'date' : 'time'}.png`,
        })
        await page.keyboard.press('Escape')
        await expect(panel).not.toBeVisible()
        await expect(page.getByRole('dialog', { name: '新建日程', exact: true })).toBeVisible()
      }
    }
  }
  expect(errors).toEqual([])
})
