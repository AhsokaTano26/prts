import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer } from '../server/index.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'

const endpoint = '/api/calendar/subscription'
const feedPath = (token) =>
  `/api/calendar/feed.ics${token === undefined ? '' : `?token=${encodeURIComponent(token)}`}`
async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-subscription-test-'))
  const running = new Set(),
    logs = []
  const stop = async (app) => {
    if (!running.delete(app.server)) return
    app.server.closeAllConnections()
    await new Promise((resolve) => app.server.close(resolve))
  }
  t.after(async () => {
    for (const server of [...running]) await stop({ server })
    await rm(root, { recursive: true, force: true })
  })
  async function start() {
    const server = createServer({
      env: { PRTS_PASSWORD: 'subscription-test-only' },
      databasePath: path.join(root, 'db.sqlite'),
      assetsDir: path.join(root, 'assets'),
      uploadsDir: path.join(root, 'uploads'),
      corpusDir: path.join(root, 'corpus'),
      log: (level, event, fields) => logs.push({ level, event, ...fields }),
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    running.add(server)
    const base = `http://127.0.0.1:${server.address().port}`
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'subscription-test-only' }),
    })
    assert.equal(response.status, 200)
    await response.json()
    return { server, base, cookie: response.headers.get('set-cookie').split(';')[0] }
  }
  const call = (app, route, { authenticated = false, body, ...options } = {}) =>
    fetch(`${app.base}${route}`, {
      ...options,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        ...(authenticated ? { cookie: app.cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
    })
  const config = async (app) => {
    const response = await call(app, endpoint, { authenticated: true })
    assert.equal(response.status, 200)
    return response.json()
  }
  const update = async (app, action, revision) => {
    const response = await call(app, endpoint, {
      authenticated: true,
      method: 'POST',
      body: { action, revision },
    })
    assert.equal(response.status, 200)
    return response.json()
  }
  return { start, stop, logs, call, config, update }
}

test('subscription configuration is private and feeds require a valid token, not a login cookie', async (t) => {
  const { start, call, config, update, logs } = await setup(t)
  const app = await start()
  assert.equal((await call(app, endpoint)).status, 401)
  assert.equal(
    (await call(app, endpoint, { method: 'POST', body: { action: 'enable', revision: 1 } })).status,
    401,
  )
  assert.deepEqual(await config(app), { enabled: false, token: null, revision: 1 })
  assert.equal(
    (
      await call(app, endpoint, {
        authenticated: true,
        method: 'POST',
        headers: { origin: 'https://other.invalid' },
        body: { action: 'enable', revision: 1 },
      })
    ).status,
    403,
  )
  for (const body of [
    { action: 'unknown', revision: 1 },
    { action: 'enable' },
    { action: 'enable', revision: '1' },
  ])
    assert.equal(
      (await call(app, endpoint, { authenticated: true, method: 'POST', body })).status,
      400,
    )
  const enabled = await update(app, 'enable', 1)
  assert.match(enabled.token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(enabled.enabled, true)
  const response = await call(app, feedPath(enabled.token))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^text\/calendar; charset=utf-8$/)
  assert.match(response.headers.get('cache-control'), /no-store/)
  assert.match(await response.text(), /^BEGIN:VCALENDAR\r\n/)
  const head = await call(app, feedPath(enabled.token), { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.ok(Number(head.headers.get('content-length')) > 0)
  assert.equal(await head.text(), '')
  for (const route of [
    feedPath(),
    feedPath('bad'),
    `${feedPath(enabled.token)}&token=${enabled.token}`,
  ])
    assert.equal((await call(app, route, { authenticated: true })).status, 404)
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const rejected = await call(app, feedPath(enabled.token), { method })
    assert.equal(rejected.status, 405)
    assert.equal(rejected.headers.get('allow'), 'GET, HEAD')
  }
  assert.equal((await call(app, endpoint, { authenticated: true, method: 'PUT' })).status, 405)
  const rawLogs = JSON.stringify(logs)
  assert.equal(rawLogs.includes(enabled.token), false)
  assert.equal(rawLogs.includes('token='), false)
  assert.ok(logs.some((entry) => entry.path === '/api/calendar/feed.ics'))
})

test('resets, disabling, completed tasks and workspace edits change the live feed without leaking secrets', async (t) => {
  const { start, call, config, update } = await setup(t)
  const app = await start()
  const workspace = createInitialWorkspace()
  const stamp = new Date().toISOString()
  workspace.settings.name = 'DO NOT EXPORT WORKSPACE NAME'
  workspace.calendarEvents = [
    {
      id: 'event',
      title: '会面',
      description: '提前准备',
      location: '会议室',
      createdAt: stamp,
      updatedAt: stamp,
      allDay: false,
      startAt: '2026-10-27T09:00:00Z',
      endAt: '2026-10-27T10:00:00Z',
    },
  ]
  workspace.tasks = [
    {
      id: 'task',
      title: '提交结果',
      done: false,
      dueDate: '2026-10-28',
      priority: 'high',
      categoryId: '',
      createdAt: stamp,
    },
    {
      id: 'done',
      title: '已完成不输出',
      done: true,
      dueDate: '2026-10-28',
      priority: 'low',
      categoryId: '',
      createdAt: stamp,
    },
  ]
  async function save(revision) {
    const saved = await call(app, '/api/state/workspace', {
      authenticated: true,
      method: 'PUT',
      body: { value: workspace, expectedRevision: revision, mutationId: crypto.randomUUID() },
    })
    assert.equal(saved.status, 200)
    return saved.json()
  }
  await save(0)
  let state = await update(app, 'enable', 1)
  const firstToken = state.token
  const original = await (await call(app, feedPath(firstToken))).text()
  assert.match(original, /SUMMARY:会面/)
  assert.match(original, /SUMMARY:截止 · 提交结果/)
  assert.doesNotMatch(original, /DO NOT EXPORT|已完成不输出/)
  const uid = /UID:([^\r\n]+)/.exec(original)[1]
  assert.deepEqual(await update(app, 'enable', state.revision), state)
  state = await update(app, 'reset', state.revision)
  assert.notEqual(state.token, firstToken)
  assert.equal((await call(app, feedPath(firstToken))).status, 404)
  assert.equal(/UID:([^\r\n]+)/.exec(await (await call(app, feedPath(state.token))).text())[1], uid)
  assert.equal(
    (
      await call(app, endpoint, {
        authenticated: true,
        method: 'POST',
        body: { action: 'disable', revision: 1 },
      })
    ).status,
    409,
  )
  workspace.calendarEvents[0].title = '会面改期'
  workspace.tasks[0].done = true
  await save(1)
  const changed = await (await call(app, feedPath(state.token))).text()
  assert.match(changed, /SUMMARY:会面改期/)
  assert.match(changed, /SEQUENCE:2\r\n/)
  assert.doesNotMatch(changed, /截止 · 提交结果/)
  assert.equal(/UID:([^\r\n]+)/.exec(changed)[1], uid)
  const exported = JSON.stringify(
    await (await call(app, '/api/state', { authenticated: true })).json(),
  )
  assert.equal(exported.includes(state.token), false)
  const previous = state.token
  state = await update(app, 'disable', state.revision)
  assert.equal(state.token, null)
  assert.equal((await call(app, feedPath(previous))).status, 404)
  state = await update(app, 'enable', state.revision)
  assert.notEqual(state.token, previous)
  assert.deepEqual(await config(app), state)
  workspace.calendarEvents[0].title = '从备份恢复的会面'
  const restored = await call(app, '/api/state/import', {
    authenticated: true,
    method: 'POST',
    body: {
      documents: {
        workspace,
        preferences: {
          motionEnabled: true,
          assistant: { persona: 'prts', knowledge: 'all' },
          assistantMode: 'local',
        },
      },
      expectedRevisions: { workspace: 2, preferences: 0, focus: 0 },
      mutationId: crypto.randomUUID(),
    },
  })
  assert.equal(restored.status, 200)
  await restored.json()
  assert.deepEqual(await config(app), state)
  const importedFeed = await (await call(app, feedPath(state.token))).text()
  assert.match(importedFeed, /从备份恢复的会面/)
  assert.equal(/UID:([^\r\n]+)/.exec(importedFeed)[1], uid)
})

test('the subscription address and event identities survive a full SQLite server restart', async (t) => {
  const { start, stop, call, config, update } = await setup(t)
  let app = await start()
  const workspace = createInitialWorkspace()
  workspace.calendarEvents = [
    {
      id: 'persistent',
      title: '持久订阅',
      description: '',
      location: '',
      allDay: true,
      startDate: '2026-10-27',
      endDate: '2026-10-28',
      createdAt: '2026-10-27T00:00:00Z',
      updatedAt: '2026-10-27T00:00:00Z',
    },
  ]
  const saved = await call(app, '/api/state/workspace', {
    authenticated: true,
    method: 'PUT',
    body: { value: workspace, expectedRevision: 0, mutationId: crypto.randomUUID() },
  })
  assert.equal(saved.status, 200)
  await saved.json()
  const first = await update(app, 'enable', 1)
  const initialFeed = await (await call(app, feedPath(first.token))).text()
  assert.match(initialFeed, /UID:/)
  await stop(app)
  app = await start()
  assert.deepEqual(await config(app), first)
  assert.equal(await (await call(app, feedPath(first.token))).text(), initialFeed)
})
