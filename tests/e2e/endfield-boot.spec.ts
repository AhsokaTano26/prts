import { test, expect, type Page } from './fixture'

test.use({ serviceWorkers: 'block', reducedMotion: 'no-preference' })

async function prepare(page: Page, freezeClock = true) {
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  const state = await (await page.request.get('/api/state')).json()
  const preferences = state.documents.preferences
  expect(
    (
      await page.request.put('/api/state/preferences', {
        data: {
          value: {
            ...preferences.value,
            motionEnabled: true,
            appearance: { theme: 'endfield', portrait: 'amiya' },
          },
          expectedRevision: preferences.revision,
          mutationId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.goto('/#settings/general')
  await expect(page.getByRole('heading', { name: '常规偏好', exact: true })).toBeVisible()
  if (freezeClock) {
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
  }
}

async function seek(page: Page, seconds: number) {
  await page.locator('.endfield-boot-film').evaluate(async (video: HTMLVideoElement, time) => {
    video.pause()
    const sought = new Promise<void>((resolve) =>
      video.addEventListener('seeked', () => resolve(), { once: true }),
    )
    video.currentTime = time
    await sought
  }, seconds)
  await page.locator('.endfield-boot-backdrop').evaluate((element, time) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      animation.pause()
      animation.currentTime = time * 1000
    }
  }, seconds)
}

for (const width of [1440, 320]) {
  test(`Endfield uses the original film at a smaller scale over engineering detail at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 900 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await prepare(page)
    await page.getByRole('button', { name: '重播启动动画', exact: true }).click()
    const boot = page.locator('.boot-sequence--endfield')
    const film = boot.locator('video')
    await expect(film).toHaveAttribute('src', '/branding/endfield-opening.mp4')
    await expect(boot).toHaveAttribute('data-artwork', 'ready')
    await film.evaluate((video: HTMLVideoElement) => video.pause())
    expect(
      await film.evaluate((video: HTMLVideoElement) => ({
        muted: video.muted,
        inline: video.playsInline,
        controls: video.controls,
        loop: video.loop,
      })),
    ).toEqual({ muted: true, inline: true, controls: false, loop: false })
    expect(await film.evaluate((video: HTMLVideoElement) => video.playbackRate)).toBe(1.5)
    const bounds = await film.boundingBox()
    // The reference's final title occupies ~14% of the full recording width.
    expect(bounds!.width).toBeLessThanOrEqual(width === 320 ? 480 : 880)
    expect(Math.abs(bounds!.x + bounds!.width / 2 - width / 2)).toBeLessThan(width * 0.05)
    await expect(boot.locator('.endfield-boot-backdrop')).toBeVisible()
    await expect(boot.locator('.endfield-boot-contours')).toBeVisible()
    for (const [name, seconds] of [
      ['company', 0.2],
      ['assembly', 1.1],
      ['title', 2.1],
    ] as const) {
      await seek(page, seconds)
      expect(await film.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(
        seconds,
        2,
      )
      await page.screenshot({ path: `/tmp/prts-endfield-opening-${name}-${width}.png` })
    }
    expect(await boot.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false)
    await page.keyboard.press('Escape')
    await expect(boot).toHaveCount(0)
    await page.clock.runFor(32)
    await expect(page.getByRole('button', { name: '重播启动动画', exact: true })).toBeFocused()
    expect(errors).toEqual([])
  })
}

test('Endfield completes actual playback, restores focus and respects reduced motion on replay', async ({
  page,
}) => {
  await prepare(page, false)
  const replay = page.getByRole('button', { name: '重播启动动画', exact: true })
  await replay.click()
  const boot = page.locator('.boot-sequence--endfield')
  await expect(boot).toHaveAttribute('data-artwork', 'ready')
  const started = Date.now()
  await expect(boot.getByRole('button', { name: '跳过启动', exact: true })).toBeFocused()
  await expect(boot).toHaveAttribute('data-phase', 'prepare')
  await expect(boot).toHaveAttribute('data-phase', 'ready')
  await expect(boot).toHaveCount(0)
  expect(Date.now() - started).toBeLessThan(2300)
  await expect(replay).toBeFocused()
  await replay.click()
  await expect(boot).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(boot).toHaveCount(0)
  await expect(replay).toBeFocused()
})

test('Endfield waits for a cold film and starts from the beginning when it arrives', async ({
  page,
}) => {
  await prepare(page)
  let release!: () => void
  let reached!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const received = new Promise<void>((resolve) => {
    reached = resolve
  })
  await page.route('**/branding/endfield-opening.mp4', async (route) => {
    reached()
    await gate
    await route.continue().catch(() => {})
  })
  try {
    await page.getByRole('button', { name: '重播启动动画', exact: true }).click()
    await received
    const boot = page.locator('.boot-sequence--endfield')
    await page.clock.runFor(700)
    await expect(boot).toHaveAttribute('data-phase', 'load')
    await expect(boot).toHaveAttribute('data-artwork', 'waiting')
    release()
    await expect(boot).toHaveAttribute('data-artwork', 'ready')
    const time = await boot.locator('video').evaluate((video: HTMLVideoElement) => {
      video.pause()
      return video.currentTime
    })
    expect(time).toBeLessThan(0.5)
    await page.keyboard.press('Escape')
    await expect(boot).toHaveCount(0)
  } finally {
    release()
  }
})

for (const exit of ['timeout', 'skip'] as const) {
  test(`Endfield releases the workspace on a stalled download via ${exit}`, async ({ page }) => {
    await prepare(page)
    let release!: () => void
    let reached!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const received = new Promise<void>((resolve) => {
      reached = resolve
    })
    await page.route('**/branding/endfield-opening.mp4', async (route) => {
      reached()
      await gate
      await route.continue().catch(() => {})
    })
    const replay = page.getByRole('button', { name: '重播启动动画', exact: true })
    try {
      await replay.click()
      await received
      const boot = page.locator('.boot-sequence--endfield')
      if (exit === 'skip') await boot.getByRole('button', { name: '跳过启动', exact: true }).click()
      else await page.clock.runFor(1200)
      await expect(boot).toHaveCount(0)
      await page.clock.runFor(32)
      await expect(replay).toBeFocused()
      await expect(page.locator('.app-shell')).not.toHaveAttribute('inert')
      release()
      await page.clock.runFor(5000)
      await expect(boot).toHaveCount(0)
    } finally {
      release()
    }
  })
}

test('Endfield falls through when playback is rejected or stalls mid-sequence', async ({
  page,
}) => {
  await prepare(page)
  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = () =>
      Promise.reject(new DOMException('blocked', 'NotAllowedError'))
  })
  const replay = page.getByRole('button', { name: '重播启动动画', exact: true })
  await replay.click()
  await expect(page.locator('.boot-sequence--endfield')).toHaveCount(0)
  await page.clock.runFor(32)
  await expect(replay).toBeFocused()
  await page.reload()
  await expect(replay).toBeVisible()
  await replay.click()
  const boot = page.locator('.boot-sequence--endfield')
  await expect(boot).toHaveAttribute('data-artwork', 'ready')
  await boot.locator('video').evaluate((video: HTMLVideoElement) => video.pause())
  await page.clock.runFor(4000)
  await expect(boot).toHaveCount(0)
})
