import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from '../server/index.mjs'

const password = 'runtime-logs-test-password-only'

async function fixture(t) {
  const records = []
  const server = createServer({
    env: { PRTS_PASSWORD: password },
    log: (level, event, fields) => records.push({ level, event, ...fields }),
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  return { server, records, base: `http://127.0.0.1:${server.address().port}` }
}

test('requests emit status, duration and a response correlation ID without exposing private inputs', async (t) => {
  const f = await fixture(t)
  const session = await fetch(`${f.base}/api/auth/session?token=private-query-token`, {
    headers: { authorization: 'Bearer private-header-token', cookie: 'private-cookie-token' },
  })
  assert.equal(session.status, 200)
  await session.json()
  const record = f.records.find((record) => record.event === 'http.request')
  assert.ok(record, 'A completed request must emit a runtime log')
  assert.equal(record.level, 'info')
  assert.equal(record.method, 'GET')
  assert.equal(record.path, '/api/auth/session')
  assert.equal(record.status, 200)
  assert.ok(Number.isFinite(record.durationMs) && record.durationMs >= 0)
  assert.match(record.requestId, /^[a-f0-9-]{36}$/)
  assert.equal(session.headers.get('x-request-id'), record.requestId)

  const file = await fetch(`${f.base}/api/files/private-filename-token/content`)
  assert.equal(file.status, 401)
  await file.json()
  assert.ok(
    f.records.some((record) => record.path === '/api/files/:id/content' && record.status === 401),
  )
  const login = await fetch(`${f.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, message: 'private-chat-token', apiKey: 'private-api-token' }),
  })
  assert.equal(login.status, 200)
  await login.json()
  const unknown = await fetch(`${f.base}/api/private-path-token`)
  await unknown.text()
  assert.ok(f.records.some((record) => record.path === '/api/*'))
  assert.doesNotMatch(JSON.stringify(f.records), /private-.*?-token|runtime-logs-test-password/)
})

test('unexpected server errors emit diagnostic type and code with the same request ID but no raw exception', async (t) => {
  const f = await fixture(t)
  const original = f.server.database.prepare
  f.server.database.prepare = () => {
    throw Object.assign(
      new Error('private-exception-token https://service.example/?key=private-url-token'),
      { code: 'EACCES' },
    )
  }
  let response
  try {
    response = await fetch(`${f.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    assert.equal(response.status, 500)
    assert.doesNotMatch(await response.text(), /private-|EACCES/)
  } finally {
    f.server.database.prepare = original
  }
  const failure = f.records.find((record) => record.event === 'http.error')
  assert.ok(failure, 'Unexpected exceptions must reach the runtime error log')
  assert.equal(failure.level, 'error')
  assert.equal(failure.errorType, 'Error')
  assert.equal(failure.errorCode, 'EACCES')
  assert.equal(failure.requestId, response.headers.get('x-request-id'))
  assert.ok(f.records.some((record) => record.event === 'http.request' && record.status === 500))
  assert.doesNotMatch(JSON.stringify(f.records), /private-|service\.example/)
})

test('server lifecycle logs every start and stop even when no password is generated', async (t) => {
  const f = await fixture(t)
  assert.ok(
    f.records.some(
      (record) => record.event === 'server.started' && record.port === f.server.address().port,
    ),
  )
  await new Promise((resolve) => f.server.close(resolve))
  assert.ok(f.records.some((record) => record.event === 'server.stopped'))
})
