import { test, expect, waitSaved } from './fixture'

test.use({ serviceWorkers: 'block' })
for (const theme of ['rhodes', 'rhine']) {
  test(`${theme}: overview configures duration and preserves a stopwatch through pause, reload and finish`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const login = await page.request.post('/api/auth/login', {
      data: { password: 'prts-e2e-test-password-only' },
    })
    expect(login.ok()).toBe(true)
    const state = await (await page.request.get('/api/state')).json()
    const preferences = state.documents.preferences
    expect(
      (
        await page.request.put('/api/state/preferences', {
          data: {
            value: {
              ...preferences.value,
              motionEnabled: false,
              appearance: { theme, portrait: 'amiya' },
            },
            expectedRevision: preferences.revision,
            mutationId: crypto.randomUUID(),
          },
        })
      ).ok(),
    ).toBe(true)
    await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page).toHaveTitle(/PRTS/)
    const panel = page.getByRole('region', { name: '专注计时', exact: true })
    await expect(panel).toBeVisible()
    const display = panel.getByRole('timer')
    const duration = panel.getByRole('spinbutton', { name: '本轮时长', exact: true })
    await duration.fill('7')
    await panel.getByRole('button', { name: '应用', exact: true }).click()
    await waitSaved(page)
    await expect(display).toHaveText('07:00')
    await expect(page).not.toHaveURL(/settings/)
    await page.reload()
    await expect(display).toHaveText('07:00')
    await expect(duration).toHaveValue('7')
    await panel.getByRole('button', { name: '开始专注', exact: true }).click()
    await expect(duration).toBeDisabled()
    await expect(panel.getByRole('button', { name: '正计时', exact: true })).toBeDisabled()
    await expect(display).not.toHaveText('07:00')
    await panel.getByRole('button', { name: '暂停专注', exact: true }).click()
    await waitSaved(page)
    const countdown = await display.textContent()
    await page.reload()
    await expect(display).toHaveText(countdown!)
    await panel.getByRole('button', { name: '重置专注计时', exact: true }).click()
    await expect(display).toHaveText('07:00')
    await waitSaved(page)
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 })
      await panel.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        false,
      )
      await page.screenshot({
        path: `/tmp/prts-focus-countdown-${theme}-${width}.png`,
        fullPage: true,
      })
    }
    await panel.getByRole('button', { name: '正计时', exact: true }).click()
    await waitSaved(page)
    await expect(display).toHaveText('00:00')
    const finish = panel.getByRole('button', { name: '结束并记录本轮专注', exact: true })
    await expect(finish).toBeDisabled()
    await panel.getByRole('button', { name: '开始专注', exact: true }).click()
    await expect(display).not.toHaveText('00:00')
    await panel.getByRole('button', { name: '暂停专注', exact: true }).click()
    await waitSaved(page)
    const paused = await display.textContent()
    await page.reload()
    await expect(display).toHaveText(paused!)
    await expect(panel.getByRole('button', { name: '正计时', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await panel.getByRole('button', { name: '继续专注', exact: true }).click()
    await waitSaved(page)
    await page.reload()
    await expect(panel.getByRole('button', { name: '暂停专注', exact: true })).toBeVisible()
    await expect(display).not.toHaveText(paused!)
    await finish.click()
    await waitSaved(page)
    await expect(panel.getByRole('button', { name: '再来一轮', exact: true })).toBeVisible()
    await expect(finish).toBeDisabled()
    const result = await display.textContent()
    const readCount = async () =>
      (await (await page.request.get('/api/state')).json()).documents.workspace.value.focusSessions
    expect(await readCount()).toBe(1)
    await page.reload()
    await expect(display).toHaveText(result!)
    expect(await readCount()).toBe(1)
    await panel.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: `/tmp/prts-focus-countup-${theme}-320.png`, fullPage: true })
    await panel.getByRole('button', { name: '重置专注计时', exact: true }).click()
    await expect(display).toHaveText('00:00')
    await waitSaved(page)
    expect(await readCount()).toBe(1)
    await panel.getByRole('button', { name: '倒计时', exact: true }).click()
    await expect(display).toHaveText('07:00')
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('finishing a stopwatch freezes its elapsed time before a slow completion request', async ({
  page,
}) => {
  await page.clock.install()
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const panel = page.getByRole('region', { name: '专注计时', exact: true })
  const display = panel.getByRole('timer')
  await panel.getByRole('button', { name: '正计时', exact: true }).click()
  await waitSaved(page)
  await panel.getByRole('button', { name: '开始专注', exact: true }).click()
  await waitSaved(page)
  await expect(display).not.toHaveText('00:00')
  let release!: () => void
  let reached!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const received = new Promise<void>((resolve) => {
    reached = resolve
  })
  await page.route('**/api/focus/complete', async (route) => {
    reached()
    await gate
    await route.continue()
  })
  await panel.getByRole('button', { name: '结束并记录本轮专注', exact: true }).click()
  try {
    await received
    const stopped = await display.textContent()
    await page.clock.runFor(3000)
    await expect(display).toHaveText(stopped!)
    const state = (await (await page.request.get('/api/state')).json()).documents.focus.value
    expect(state.startedAt).toBeNull()
    release()
    await expect(panel.getByRole('button', { name: '再来一轮', exact: true })).toBeVisible()
    await expect(display).toHaveText(stopped!)
  } finally {
    release()
  }
})
