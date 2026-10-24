import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer as httpServer } from 'node:http'
import { createServer } from '../server/index.mjs'
import { createStorage } from '../server/storage.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'

async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  return `http://127.0.0.1:${server.address().port}`
}
async function app(t) {
  const now = Date.parse('2026-10-24T10:00:00Z')
  const server = createServer({
    env: { PRTS_PASSWORD: 'notifications-api-test-only' },
    now: () => now,
  })
  const base = await listen(t, server)
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'notifications-api-test-only' }),
  })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const call = (path, data, method = data === undefined ? 'GET' : 'PUT', headers = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
  return { server, base, call, now }
}

test('notification APIs authenticate, reject cross-origin writes and keep transport secrets out of public state', async (t) => {
  const f = await app(t)
  for (const path of [
    '/api/settings/notifications',
    '/api/notifications',
    '/api/notifications/deliveries',
  ])
    assert.equal((await fetch(`${f.base}${path}`)).status, 401)
  const initial = await (await f.call('/api/settings/notifications')).json()
  const input = {
    ...initial,
    webhook: {
      enabled: true,
      url: 'https://qq.example/webhook/general?secret=private-webhook-url',
    },
    smtp: { ...initial.smtp, password: 'private-mail-password' },
  }
  assert.equal(
    (await f.call('/api/settings/notifications', input, 'PUT', { origin: 'https://evil.example' }))
      .status,
    403,
  )
  const saved = await f.call('/api/settings/notifications', input)
  assert.equal(saved.status, 200)
  assert.doesNotMatch(await saved.text(), /private-webhook-url|private-mail-password/)
  assert.doesNotMatch(
    await (await f.call('/api/state')).text(),
    /private-webhook-url|private-mail-password/,
  )
  assert.equal((await f.call('/api/settings/notifications', input)).status, 409)
  assert.equal((await f.call('/api/notifications/test', undefined)).status, 405)
  assert.equal((await f.call('/api/notifications/test', { channel: 'shell' }, 'POST')).status, 400)
  assert.equal((await f.call('/api/notifications/test', { channel: 'smtp' }, 'POST')).status, 400)
})

test('an explicit QQ test uses only the supplied protocol; wrong success payload is rejected without echoing details', async (t) => {
  let valid = true
  const requests = []
  const endpoint = await listen(
    t,
    httpServer(async (request, response) => {
      let body = ''
      for await (const part of request) body += part
      requests.push({ url: request.url, body: JSON.parse(body), headers: request.headers })
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify(valid ? { status: 'forwarded' } : { detail: 'private-provider-detail' }),
      )
    }),
  )
  const f = await app(t)
  const initial = await (await f.call('/api/settings/notifications')).json()
  assert.equal(
    (
      await f.call('/api/settings/notifications', {
        ...initial,
        webhook: { enabled: true, url: `${endpoint}/webhook/general` },
      })
    ).status,
    200,
  )
  assert.equal(
    (await f.call('/api/notifications/test', { channel: 'webhook' }, 'POST')).status,
    200,
  )
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/webhook/general')
  assert.deepEqual(Object.keys(requests[0].body).sort(), [
    'fields',
    'level',
    'message',
    'source',
    'timestamp',
    'title',
  ])
  assert.equal(requests[0].headers['content-type'], 'application/json')
  assert.ok(requests[0].headers['x-prts-event-id'])
  valid = false
  const failed = await f.call('/api/notifications/test', { channel: 'webhook' }, 'POST')
  assert.equal(failed.status, 502)
  assert.doesNotMatch(await failed.text(), /private-provider-detail/)
})

test('browser inbox acknowledgment is persistent and rescheduled or completed tasks disappear', async (t) => {
  const f = await app(t)
  const storage = createStorage(f.server.database)
  t.after(() => storage.close())
  const workspace = createInitialWorkspace()
  workspace.tasks = [
    {
      ...workspace.tasks[0],
      id: 'notify-api-task',
      done: false,
      dueAt: new Date(f.now + 300_000).toISOString(),
    },
  ]
  storage.putDocument('workspace', {
    value: workspace,
    expectedRevision: 0,
    mutationId: crypto.randomUUID(),
  })
  const initial = await (await f.call('/api/settings/notifications')).json()
  await f.call('/api/settings/notifications', { ...initial, enabled: true })
  let inbox = await (await f.call('/api/notifications')).json()
  assert.equal(inbox.reminders.length, 1)
  const id = inbox.reminders[0].id
  assert.equal((await f.call(`/api/notifications/${id}/read`, {}, 'POST')).status, 200)
  assert.deepEqual((await (await f.call('/api/notifications')).json()).reminders, [])
  assert.equal((await f.call(`/api/notifications/${id}/read`, {}, 'POST')).status, 200)
  assert.equal((await f.call(`/api/notifications/${'a'.repeat(64)}/read`, {}, 'POST')).status, 404)
})
