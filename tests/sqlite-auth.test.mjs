import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createServer } from '../server/index.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'

const PASSWORD = 'sqlite-auth-test-password'

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-sqlite-auth-'))
  const running = new Set()
  t.after(async () => {
    await Promise.all([...running].map((server) => stop(server)))
    await rm(root, { recursive: true, force: true })
  })
  async function stop(server) {
    if (!running.delete(server)) return
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  async function start(password = PASSWORD, now = Date.now) {
    const server = createServer({
      env: { PRTS_PASSWORD: password },
      databasePath: path.join(root, 'prts.sqlite'),
      corpusDir: path.join(root, 'empty-corpus'),
      now,
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    running.add(server)
    return { server, base: `http://127.0.0.1:${server.address().port}`, stop: () => stop(server) }
  }
  return { start }
}

async function login(app, password = PASSWORD) {
  const response = await fetch(`${app.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  const value = await response.json()
  return { response, value, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}

function call(app, endpoint, { cookie, ...options } = {}) {
  return fetch(`${app.base}${endpoint}`, {
    ...options,
    headers: { ...(cookie ? { cookie } : {}), ...options.headers },
  })
}

test('SQLite login sessions and private state survive a complete server restart', async (t) => {
  const { start } = await setup(t)
  let app = await start()
  const authenticated = await login(app)
  assert.equal(authenticated.response.status, 200)
  assert.match(authenticated.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
  const cookie = authenticated.cookie
  const workspace = createInitialWorkspace()
  workspace.settings.name = '服务器持久化博士'
  const saved = await call(app, '/api/state/workspace', {
    cookie,
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: app.base },
    body: JSON.stringify({ value: workspace, expectedRevision: 0, mutationId: 'initial-save' }),
  })
  assert.equal(saved.status, 200)
  await saved.json()
  const storedSessions = app.server.database.prepare('SELECT key,value FROM auth_sessions').all()
  assert.equal(storedSessions.length, 1)
  assert.equal(JSON.stringify(storedSessions).includes(cookie.split('=')[1]), false)
  await app.stop()
  app = await start()
  const session = await call(app, '/api/auth/session', { cookie })
  assert.equal((await session.json()).authenticated, true)
  const result = await call(app, '/api/state', { cookie })
  assert.equal(result.status, 200)
  const state = await result.json()
  assert.equal(state.documents.workspace.value.settings.name, workspace.settings.name)
  assert.equal(state.documents.workspace.revision, 1)
})

test('password changes invalidate stored sessions, and logout revocation survives restart', async (t) => {
  const { start } = await setup(t)
  let app = await start()
  const old = await login(app)
  const newPassword = 'different-sqlite-auth-test-password'
  const changed = await call(app, '/api/auth/password', {
    cookie: old.cookie,
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: app.base },
    body: JSON.stringify({ currentPassword: PASSWORD, newPassword }),
  })
  assert.equal(changed.status, 200)
  assert.match(changed.headers.get('set-cookie'), /Max-Age=0/)
  assert.deepEqual(await changed.json(), { authenticated: false })
  await app.stop()
  app = await start(PASSWORD)
  assert.equal(
    (await (await call(app, '/api/auth/session', { cookie: old.cookie })).json()).authenticated,
    false,
  )
  assert.equal((await call(app, '/api/state', { cookie: old.cookie })).status, 401)
  const current = await login(app, newPassword)
  assert.equal(current.response.status, 200)
  const logout = await call(app, '/api/auth/logout', { cookie: current.cookie, method: 'POST' })
  assert.equal(logout.status, 200)
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/)
  await logout.json()
  await app.stop()
  app = await start('another-environment-password-is-ignored')
  assert.equal(
    (await (await call(app, '/api/auth/session', { cookie: current.cookie })).json()).authenticated,
    false,
  )
  assert.equal((await call(app, '/api/state', { cookie: current.cookie })).status, 401)
})

test('failed login rate limits persist across restarts and expire after their window', async (t) => {
  const { start } = await setup(t)
  let now = Date.now()
  let app = await start(PASSWORD, () => now)
  for (let index = 0; index < 3; index++)
    assert.equal((await login(app, 'wrong-password')).response.status, 401)
  await app.stop()
  app = await start(PASSWORD, () => now)
  for (let index = 0; index < 2; index++)
    assert.equal((await login(app, 'wrong-password')).response.status, 401)
  const limited = await login(app)
  assert.equal(limited.response.status, 429)
  assert.equal(limited.response.headers.get('retry-after'), '600')
  await app.stop()
  app = await start(PASSWORD, () => now)
  assert.equal((await login(app)).response.status, 429)
  now += 10 * 60 * 1000 + 1
  assert.equal((await login(app)).response.status, 200)
})

test('private storage routes reject unauthenticated requests and cross-origin mutations', async (t) => {
  const { start } = await setup(t)
  const app = await start()
  for (const [endpoint, method] of [
    ['/api/state', 'GET'],
    ['/api/state/workspace', 'PUT'],
    ['/api/files', 'GET'],
    ['/api/files', 'POST'],
    ['/api/files/any-file', 'DELETE'],
    ['/api/files/any-file/content', 'GET'],
    ['/api/messages', 'GET'],
    ['/api/messages', 'POST'],
    ['/api/focus/complete', 'POST'],
  ]) {
    const response = await call(app, endpoint, { method })
    assert.equal(response.status, 401, `${method} ${endpoint}`)
    await response.json()
  }
  const { cookie } = await login(app)
  for (const [endpoint, method] of [
    ['/api/state/workspace', 'PUT'],
    ['/api/files/any-file', 'DELETE'],
    ['/api/messages', 'DELETE'],
    ['/api/auth/logout', 'POST'],
  ]) {
    const response = await call(app, endpoint, {
      cookie,
      method,
      headers: { origin: 'https://unrelated.example' },
    })
    assert.equal(response.status, 403, `${method} ${endpoint}`)
    await response.json()
  }
  const state = await (await call(app, '/api/state', { cookie })).json()
  assert.equal(state.documents.workspace, null)
  assert.equal(
    (await (await call(app, '/api/auth/session', { cookie })).json()).authenticated,
    true,
  )
})
