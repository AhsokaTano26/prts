import { test, expect, waitSaved, type Page } from './fixture'
import { chooseOption } from './select-helper'

const password = 'prts-e2e-test-password-only'
async function login(page: Page) {
  expect((await page.request.post('/api/auth/login', { data: { password } })).ok()).toBe(true)
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { configured: false, model: '', provider: '' } }),
  )
}
async function createTask(page: Page, title: string) {
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  await page.getByLabel('任务内容', { exact: true }).fill(title)
  await page.getByRole('button', { name: '创建任务', exact: true }).click()
}

test('independent browsers share SQLite tasks, files, chat and preferences', async ({
  page,
  browser,
}) => {
  await login(page)
  await page.goto('/#tasks')
  await createTask(page, 'SQLite 跨设备任务')
  await waitSaved(page)
  await page.getByRole('button', { name: '文件资料库', exact: true }).click()
  await expect(page.getByRole('heading', { name: '为你的资料，留一个位置。' })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({
    name: 'shared.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Shared SQLite bytes'),
  })
  await expect(page.getByText('shared.txt', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'PRTS 助手', exact: true }).click()
  await page.getByRole('button', { name: '查看今日任务', exact: true }).click()
  await expect(page.locator('.chat-message.assistant')).toBeVisible()
  await waitSaved(page)
  await page.getByRole('button', { name: 'AI 对话', exact: true }).click()
  await chooseOption(page, 'AI 性格', '阿米娅 · 温和鼓励')
  await waitSaved(page)
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:8791' })
  try {
    const peer = await other.newPage()
    await login(peer)
    await peer.goto('/#tasks')
    await expect(peer.getByRole('button', { name: 'SQLite 跨设备任务', exact: true })).toBeVisible()
    await peer.getByRole('button', { name: '文件资料库', exact: true }).click()
    await expect(peer.getByText('shared.txt', { exact: true })).toBeVisible()
    const files = (await (await peer.request.get('/api/files')).json()).files
    expect((await peer.request.get(`/api/files/${files[0].id}/content`)).status()).toBe(200)
    expect(await (await peer.request.get(`/api/files/${files[0].id}/content`)).text()).toBe(
      'Shared SQLite bytes',
    )
    await peer.getByRole('button', { name: 'PRTS 助手', exact: true }).click()
    await expect(peer.getByRole('combobox', { name: 'AI 性格' })).toContainText('阿米娅')
    await peer.getByRole('button', { name: '本地指令', exact: true }).click()
    await expect(peer.locator('.chat-message.assistant')).toBeVisible()
    expect(await peer.evaluate(() => localStorage.getItem('prts-workspace-v1'))).toBeNull()
    expect(await peer.evaluate(() => sessionStorage.getItem('prts-chat-v1'))).toBeNull()
    await peer.screenshot({ path: '/tmp/prts-sqlite-shared.png', fullPage: true })
  } finally {
    await other.close()
  }
})

test('failed saves retry once and stale revisions preserve both server data and a downloadable draft', async ({
  page,
}) => {
  await login(page)
  await page.goto('/#tasks')
  let fail = true
  await page.route('**/api/state/workspace', (route) => {
    if (fail) {
      fail = false
      return route.fulfill({ status: 503, json: { error: '模拟保存中断' } })
    }
    return route.continue()
  })
  await createTask(page, '可重试任务')
  await expect(page.getByRole('alert')).toContainText('模拟保存中断')
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await waitSaved(page)
  let saved = (await (await page.request.get('/api/state')).json()).documents.workspace
  expect(
    saved.value.tasks.filter((task: { title: string }) => task.title === '可重试任务'),
  ).toHaveLength(1)
  await page.request.put('/api/state/workspace', {
    data: {
      value: { ...saved.value, settings: { ...saved.value.settings, name: '另一设备保存' } },
      expectedRevision: saved.revision,
      mutationId: crypto.randomUUID(),
    },
  })
  await createTask(page, '冲突时保留的草稿')
  await expect(page.getByRole('alert')).toContainText('另一台设备')
  saved = (await (await page.request.get('/api/state')).json()).documents.workspace
  expect(saved.value.settings.name).toBe('另一设备保存')
  expect(
    saved.value.tasks.some((task: { title: string }) => task.title === '冲突时保留的草稿'),
  ).toBe(false)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载未保存草稿', exact: true }).click()
  expect(await (await download).path()).toBeTruthy()
})

test('browser migration keeps original data and uploads old files and chat idempotently', async ({
  page,
}) => {
  await login(page)
  const legacy = (await (await page.request.get('/api/state')).json()).documents.workspace.value
  legacy.tasks = [
    {
      id: 'legacy-migration-task',
      title: '浏览器迁移任务',
      priority: 'high',
      categoryId: '',
      dueDate: '',
      done: true,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ]
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '欢迎回来，博士。' })).toBeVisible()
  await page.evaluate(async (workspace) => {
    localStorage.setItem('prts-workspace-v1', JSON.stringify(workspace))
    localStorage.setItem(
      'prts-assistant-v1',
      JSON.stringify({ persona: 'amiya', knowledge: 'endfield' }),
    )
    sessionStorage.setItem(
      'prts-chat-v1',
      JSON.stringify([
        { id: 'old-message', role: 'assistant', content: '旧聊天保留', mode: 'local' },
      ]),
    )
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('prts-files-v1', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('files', 'readwrite')
        transaction.objectStore('files').put({
          id: 'old-file',
          name: '旧附件.txt',
          type: 'text/plain',
          size: 6,
          createdAt: '2026-10-01T00:00:00.000Z',
          blob: new Blob(['legacy'], { type: 'text/plain' }),
        })
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    })
  }, legacy)
  await page.request.post('/__test/reset', {
    headers: { 'x-prts-test': 'isolated-browser-test' },
    data: { seed: false, keepSessions: true },
  })
  await page.reload()
  await page.getByRole('button', { name: '迁移浏览器数据并进入', exact: true }).click()
  await expect(page.getByRole('heading', { name: '欢迎回来，博士。' })).toBeVisible()
  await waitSaved(page)
  await expect
    .poll(async () => (await (await page.request.get('/api/files')).json()).files.length)
    .toBe(1)
  expect(await (await page.request.get('/api/files/old-file/content')).text()).toBe('legacy')
  expect((await (await page.request.get('/api/messages')).json()).messages[0].content).toBe(
    '旧聊天保留',
  )
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('prts-workspace-v1')!).tasks[0].title,
    ),
  ).toBe('浏览器迁移任务')
  await page.reload()
  const state = (await (await page.request.get('/api/state')).json()).documents
  expect(state.workspace.value.tasks[0].done).toBe(true)
  expect(state.preferences.value.assistant.persona).toBe('amiya')
  expect((await (await page.request.get('/api/files')).json()).files).toHaveLength(1)
})

test('database bootstrap failure never creates or overwrites data', async ({ page }) => {
  await login(page)
  let writes = 0
  await page.route('**/api/state**', (route) => {
    if (route.request().method() !== 'GET') writes++
    return route.fulfill({ status: 503, json: { error: '模拟数据库不可用' } })
  })
  await page.goto('/')
  await expect(page.getByText('模拟数据库不可用', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建任务', exact: true })).toHaveCount(0)
  expect(writes).toBe(0)
})

test('locking retains a failed draft for explicit recovery after login', async ({ page }) => {
  await login(page)
  await page.goto('/#tasks')
  await page.route('**/api/state/workspace', (route) =>
    route.fulfill({ status: 503, json: { error: '临时保存失败' } }),
  )
  await createTask(page, '锁定后恢复的草稿')
  await expect(page.getByRole('alert')).toContainText('临时保存失败')
  await page.getByRole('button', { name: '锁定终端', exact: true }).click()
  await expect(page.getByRole('heading', { name: '终端访问验证', exact: true })).toBeVisible()
  await page.unroute('**/api/state/workspace')
  await page.getByLabel('访问密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '验证并进入', exact: true }).click()
  await page.getByRole('button', { name: '恢复上次草稿', exact: true }).click()
  await waitSaved(page)
  await expect(page.getByRole('button', { name: '锁定后恢复的草稿', exact: true })).toBeVisible()
  expect(
    (await (await page.request.get('/api/state')).json()).documents.workspace.value.tasks.some(
      (task: { title: string }) => task.title === '锁定后恢复的草稿',
    ),
  ).toBe(true)
})

test('consecutive focus sessions get new ids and each completes once', async ({ page }) => {
  await login(page)
  await page.goto('/')
  const initialCount = (await (await page.request.get('/api/state')).json()).documents.workspace
    .value.focusSessions
  let lastId = ''
  for (let round = 1; round <= 2; round++) {
    await page.getByRole('button', { name: /^(开始专注|再来一轮)$/ }).click()
    await waitSaved(page)
    const focus = (await (await page.request.get('/api/state')).json()).documents.focus
    expect(focus.value.sessionId).not.toBe(lastId)
    lastId = focus.value.sessionId
    expect(
      (
        await page.request.put('/api/state/focus', {
          data: {
            value: { ...focus.value, endAt: Date.now() - 1000 },
            expectedRevision: focus.revision,
            mutationId: crypto.randomUUID(),
          },
        })
      ).ok(),
    ).toBe(true)
    await page.reload()
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/state')).json()).documents.workspace.value
            .focusSessions,
      )
      .toBe(initialCount + round)
    await expect(page.getByRole('button', { name: '再来一轮', exact: true })).toBeVisible()
  }
})

test('empty image resources show a placeholder and download only after a manual click', async ({
  page,
}) => {
  await login(page)
  let starts = 0
  let state = {
    ready: false,
    state: 'idle',
    phase: null,
    completedFiles: 0,
    totalFiles: 0,
    completedBytes: 0,
    totalBytes: 0,
    release: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null,
  } as Record<string, unknown>
  await page.route('**/api/assets/sync', async (route) => {
    if (route.request().method() === 'POST') {
      starts++
      state =
        starts === 1
          ? { ...state, state: 'failed', error: '模拟下载失败，已有图片保留' }
          : {
              ...state,
              ready: true,
              state: 'succeeded',
              completedFiles: 186,
              totalFiles: 186,
              result: 'installed',
              error: null,
            }
    }
    await route.fulfill({ json: state })
  })
  await page.route('**/assets/amiya.png', (route) => route.fulfill({ status: 404 }))
  await page.goto('/')
  await page.getByRole('button', { name: '前往资源管理', exact: true }).click()
  await expect(page).toHaveURL(/#settings\/resources$/)
  await expect(
    page
      .getByRole('navigation', { name: '设置分类', exact: true })
      .getByRole('link', { name: '资源管理', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: '首次下载图片', exact: true })).toBeEnabled()
  expect(starts).toBe(0)
  await page.getByRole('button', { name: '首次下载图片', exact: true }).click()
  await expect(page.getByText('模拟下载失败，已有图片保留', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '首次下载图片', exact: true }).click()
  await expect(page.getByRole('button', { name: '检查并更新图片', exact: true })).toBeEnabled()
  expect(starts).toBe(2)
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
    if (width < 768) await expect(page.locator('.sidebar')).toHaveCSS('visibility', 'hidden')
    await page.getByRole('button', { name: '检查并更新图片', exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `/tmp/prts-storage-settings-${width}.png`, fullPage: true })
  }
})
