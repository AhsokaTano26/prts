import { test, expect, type Page } from './fixture'

declare global {
  interface Window {
    motionEvidence: { animations: string[] }[]
    motionNativeStart?: Document['startViewTransition']
  }
}

async function openWorkspace(page: Page, theme = 'rhodes') {
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
          value: { ...preferences.value, appearance: { theme, portrait: 'amiya' } },
          expectedRevision: preferences.revision,
          mutationId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.goto('/#overview')
  await expect(page.locator('.overview')).toBeVisible()
}

async function observeTransitions(page: Page, pause = false) {
  await page.evaluate((pause) => {
    window.motionEvidence = []
    const original = (window.motionNativeStart ||= document.startViewTransition.bind(document))
    document.startViewTransition = (update: ViewTransitionUpdateCallback) => {
      const transition = original(update)
      void transition.ready
        .then(() => {
          const animations = document
            .getAnimations()
            .filter(
              (animation) =>
                animation instanceof CSSAnimation && animation.animationName.startsWith('prts-'),
            )
          window.motionEvidence.push({
            animations: animations.map((animation) => (animation as CSSAnimation).animationName),
          })
          if (pause)
            for (const animation of animations) {
              animation.pause()
              animation.currentTime = Math.min(
                180,
                Number(animation.effect?.getTiming().duration || 0),
              )
            }
        })
        .catch(() => {})
      return transition
    }
  }, pause)
}

for (const theme of ['rhodes', 'rhine']) {
  for (const width of [1440, 390]) {
    test(`${theme} page transition includes the outgoing and incoming view at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await openWorkspace(page, theme)
      await observeTransitions(page, true)
      if (width < 760) await page.getByRole('button', { name: '打开导航', exact: true }).click()
      await page.getByRole('button', { name: /^任务中枢/ }).click()
      await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible()
      await expect.poll(() => page.evaluate(() => window.motionEvidence.length)).toBe(1)
      const evidence = await page.evaluate(() => window.motionEvidence[0].animations)
      expect(evidence.some((name) => name.includes('page-out'))).toBe(true)
      expect(evidence.some((name) => name.includes(`${theme}-page-in`))).toBe(true)
      if (width < 760) await expect(page.locator('.sidebar')).not.toBeVisible()
      await page.screenshot({ path: `/tmp/prts-motion-${theme}-${width}.png` })
      await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()))
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
    })
  }
}

test('rapid navigation and history finish on the latest page without a stale update', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openWorkspace(page)
  await page.evaluate(async () => {
    for (const route of ['tasks', 'notes', 'files', 'assistant', 'tasks']) {
      location.hash = route
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  })
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.transition))
    .toBeUndefined()
  await page.goBack()
  await expect(page.getByRole('heading', { name: /^PRTS 助手/ })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible()
  expect(errors).toEqual([])
})

test('settings category transitions preserve drafts and keyboard navigation stays immediate', async ({
  page,
}) => {
  await openWorkspace(page)
  await page.goto('/#settings/general')
  await page.getByLabel('博士代号', { exact: true }).fill('动效草稿')
  await observeTransitions(page)
  await page.getByRole('link', { name: '外观主题', exact: true }).click()
  await expect(page.getByRole('heading', { name: '外观主题', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.motionEvidence.length)).toBe(1)
  await page.getByRole('link', { name: '常规偏好', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('博士代号', { exact: true })).toHaveValue('动效草稿')
  expect(await page.evaluate(() => window.motionEvidence.length)).toBe(1)
})

test('reduced motion bypasses capture and an unsupported browser still navigates', async ({
  page,
}) => {
  await openWorkspace(page)
  await observeTransitions(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: /^任务中枢/ }).click()
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible()
  expect(await page.evaluate(() => window.motionEvidence.length)).toBe(0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() =>
    Object.defineProperty(document, 'startViewTransition', {
      value: undefined,
      configurable: true,
    }),
  )
  await page.getByRole('button', { name: '个人档案', exact: true }).click()
  await expect(page.getByRole('heading', { name: '个人档案', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^任务中枢/ }).click()
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible()
})

test('task and file filters animate their content while search stays immediate', async ({
  page,
}) => {
  await openWorkspace(page)
  await page.getByRole('button', { name: /^任务中枢/ }).click()
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.transition))
    .toBeUndefined()
  await observeTransitions(page)
  await page.getByRole('button', { name: /^已完成/ }).click()
  await expect.poll(() => page.evaluate(() => window.motionEvidence.length)).toBe(1)
  expect(await page.evaluate(() => window.motionEvidence[0].animations)).toContain(
    'prts-content-in',
  )
  await page.getByRole('textbox', { name: '搜索任务', exact: true }).fill('不存在的任务')
  await expect(
    page.getByText('没有找到符合筛选条件的任务，请调整关键词、状态或优先级。'),
  ).toBeVisible()
  expect(await page.evaluate(() => window.motionEvidence.length)).toBe(1)
  await page.getByRole('button', { name: '文件资料库', exact: true }).click()
  await expect(page.getByRole('heading', { name: '文件资料库', exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.transition))
    .toBeUndefined()
  await observeTransitions(page)
  await page.getByRole('button', { name: '图片', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.motionEvidence.length)).toBe(1)
})

test('the saved motion preference bypasses capture and survives a reload', async ({ page }) => {
  await openWorkspace(page)
  await page.goto('/#settings/general')
  await page.getByRole('checkbox', { name: /终端动态效果/ }).uncheck()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await expect(page.locator('.statusbar')).toContainText('SQLite · 已保存到服务器')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await observeTransitions(page)
  await page.getByRole('button', { name: /^任务中枢/ }).click()
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toBeVisible()
  expect(await page.evaluate(() => window.motionEvidence.length)).toBe(0)
})

test('locking during a transition removes snapshots and pending navigation', async ({ page }) => {
  await openWorkspace(page)
  await observeTransitions(page, true)
  await page.getByRole('button', { name: /^任务中枢/ }).click()
  await expect.poll(() => page.evaluate(() => window.motionEvidence.length)).toBe(1)
  await page.getByRole('button', { name: '锁定终端', exact: true }).click()
  await expect(page.getByLabel('访问密码', { exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.transition))
    .toBeUndefined()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation instanceof CSSAnimation && animation.animationName.includes('page-in'),
            ).length,
      ),
    )
    .toBe(0)
})

test('a delayed capture cannot replay an obsolete page after navigating back', async ({ page }) => {
  await openWorkspace(page)
  await page.evaluate(() => {
    document.startViewTransition = (update: ViewTransitionUpdateCallback) => {
      const updated = new Promise<void>((resolve) =>
        setTimeout(() => {
          void update()
          resolve()
        }, 100),
      )
      return {
        ready: updated,
        finished: updated,
        updateCallbackDone: updated,
        skipTransition() {},
      } as ViewTransition
    }
    location.hash = 'tasks'
  })
  await page.waitForTimeout(25)
  await page.evaluate(() => {
    location.hash = 'overview'
  })
  await page.waitForTimeout(180)
  await expect(page.locator('.overview')).toBeVisible()
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.transition))
    .toBeUndefined()
})

test('returning to settings cancels a pending page transition without losing its category', async ({
  page,
}) => {
  await openWorkspace(page)
  await page.goto('/#settings/general')
  await page.getByLabel('博士代号', { exact: true }).fill('保留设置草稿')
  await page.evaluate(() => {
    document.startViewTransition = (update: ViewTransitionUpdateCallback) => {
      const updated = new Promise<void>((resolve) =>
        setTimeout(() => {
          void update()
          resolve()
        }, 100),
      )
      return {
        ready: updated,
        finished: updated,
        updateCallbackDone: updated,
        skipTransition() {},
      } as ViewTransition
    }
    location.hash = 'tasks'
  })
  await page.waitForTimeout(25)
  await page.evaluate(() => {
    location.hash = 'settings/general'
  })
  await page.waitForTimeout(180)
  await expect(page.getByLabel('博士代号', { exact: true })).toHaveValue('保留设置草稿')
  await expect(page.getByRole('heading', { name: /^任务中枢/ })).toHaveCount(0)
})

test('rapid task filters keep the latest selection and combine independent criteria', async ({
  page,
}) => {
  await openWorkspace(page)
  await page.goto('/#tasks')
  await page.evaluate(() => {
    document.startViewTransition = (update: ViewTransitionUpdateCallback) => {
      const updated = new Promise<void>((resolve) =>
        setTimeout(() => {
          void update()
          resolve()
        }, 100),
      )
      return {
        ready: updated,
        finished: updated,
        updateCallbackDone: updated,
        skipTransition() {},
      } as ViewTransition
    }
  })
  const all = page.getByRole('button', { name: /^全部任务/ })
  const done = page.getByRole('button', { name: /^已完成/ })
  await done.dispatchEvent('click')
  await all.dispatchEvent('click')
  await page.waitForTimeout(180)
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  await page
    .getByRole('group', { name: '选择任务分类' })
    .getByRole('button', { name: /^工作/ })
    .dispatchEvent('click')
  await done.dispatchEvent('click')
  await page.waitForTimeout(180)
  await expect(
    page.getByRole('group', { name: '选择任务分类' }).getByRole('button', { name: /^工作/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(done).toHaveAttribute('aria-pressed', 'true')
})

test('rapid file filters honor a return to all files before capture commits', async ({ page }) => {
  await openWorkspace(page)
  await page.goto('/#files')
  await expect(page.locator('.files-library')).toHaveAttribute('aria-busy', 'false')
  await page.evaluate(() => {
    document.startViewTransition = (update: ViewTransitionUpdateCallback) => {
      const updated = new Promise<void>((resolve) =>
        setTimeout(() => {
          void update()
          resolve()
        }, 100),
      )
      return {
        ready: updated,
        finished: updated,
        updateCallbackDone: updated,
        skipTransition() {},
      } as ViewTransition
    }
  })
  await page.getByRole('button', { name: '图片', exact: true }).dispatchEvent('click')
  await page.getByRole('button', { name: /^全部文件/ }).dispatchEvent('click')
  await page.waitForTimeout(180)
  await expect(page.getByRole('button', { name: /^全部文件/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
