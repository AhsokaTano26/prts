import assert from 'node:assert/strict'
import { request } from 'node:http'
import { test } from 'node:test'
import { createServer } from '../server/index.mjs'
import { createAuth } from '../server/auth.mjs'

const PASSWORD = 'test-only-distinct-workspace-password'
const START = Date.UTC(2026, 9, 23, 12)

async function app(t, options = {}) {
  const server = createServer({ env: { PRTS_PASSWORD: PASSWORD }, ...options })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  return `http://127.0.0.1:${server.address().port}`
}

function post(base, pathname, payload, headers = {}) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  })
}

async function login(base, headers = {}) {
  const response = await post(base, '/api/auth/login', { password: PASSWORD }, headers)
  assert.equal(response.status, 200)
  return {
    cookie: response.headers.get('set-cookie').split(';')[0],
    header: response.headers.get('set-cookie'),
    state: await response.json(),
  }
}

test('all workspace APIs reject unauthenticated requests without leaking configuration', async (t) => {
  const base = await app(t, {
    env: { PRTS_PASSWORD: PASSWORD, OPENAI_MODEL: 'private-model-name' },
  })
  for (const pathname of [
    '/api/health',
    '/api/chat',
    '/api',
    '/api/missing',
    '/api/auth/unknown',
  ]) {
    const response = await fetch(`${base}${pathname}`)
    assert.equal(response.status, 401, pathname)
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.doesNotMatch(await response.text(), /private-model-name|test-only/)
  }
  const chat = await post(base, '/api/chat', { messages: [{ role: 'user', content: 'hello' }] })
  assert.equal(chat.status, 401)
  const session = await fetch(`${base}/api/auth/session`)
  assert.equal(session.status, 200)
  assert.equal(session.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await session.json(), { configured: true, authenticated: false })
})

test('an absent or whitespace-only workspace password fails closed', async (t) => {
  for (const env of [{}, { PRTS_PASSWORD: '   ' }]) {
    const base = await app(t, { env })
    assert.deepEqual(await (await fetch(`${base}/api/auth/session`)).json(), {
      configured: false,
      authenticated: false,
    })
    const response = await post(base, '/api/auth/login', { password: PASSWORD })
    assert.equal(response.status, 503)
    assert.match((await response.json()).error, /PRTS_PASSWORD/)
    assert.equal((await fetch(`${base}/api/health`)).status, 503)
  }
})

test('wrong and malformed credentials never create a session or echo secrets', async (t) => {
  const base = await app(t)
  for (const payload of [
    { password: 'wrong-secret' },
    {},
    { password: 123 },
    { password: 'x'.repeat(1025) },
  ]) {
    const response = await post(base, '/api/auth/login', payload)
    assert.ok([400, 401].includes(response.status))
    assert.equal(response.headers.get('set-cookie'), null)
    assert.doesNotMatch(await response.text(), /wrong-secret|test-only-distinct/)
  }
  assert.deepEqual(await (await fetch(`${base}/api/auth/session`)).json(), {
    configured: true,
    authenticated: false,
  })
})

test('correct credentials issue a private cookie and unlock protected APIs', async (t) => {
  const base = await app(t, { now: () => START })
  const { cookie, header, state } = await login(base)
  assert.deepEqual(state, { configured: true, authenticated: true, expiresAt: START + 43_200_000 })
  assert.match(header, /; HttpOnly(?:;|$)/)
  assert.match(header, /; SameSite=Strict(?:;|$)/)
  assert.match(header, /; Path=\/(?:;|$)/)
  assert.match(header, /; Max-Age=43200(?:;|$)/)
  assert.doesNotMatch(header, /Domain=|test-only-distinct|; Secure/)
  assert.equal(cookie.split('=')[1].length >= 43, true)
  const headers = { cookie }
  assert.deepEqual(await (await fetch(`${base}/api/auth/session`, { headers })).json(), state)
  assert.equal((await fetch(`${base}/api/health`, { headers })).status, 200)
})

test('Secure cookies can be enabled for HTTPS deployments', async (t) => {
  const base = await app(t, { env: { PRTS_PASSWORD: PASSWORD, PRTS_COOKIE_SECURE: 'true' } })
  const { header } = await login(base, { origin: base.replace('http:', 'https:') })
  assert.match(header, /; Secure(?:;|$)/)
})

test('forged, malformed and duplicated session cookies do not authenticate', async (t) => {
  const base = await app(t)
  const { cookie } = await login(base)
  const name = cookie.split('=')[0]
  for (const candidate of [
    `${name}=${'A'.repeat(43)}`,
    `${name}=%broken`,
    `${cookie}; ${name}=forged`,
    `${name}=forged; ${cookie}`,
  ]) {
    const response = await fetch(`${base}/api/health`, { headers: { cookie: candidate } })
    assert.equal(response.status, 401)
  }
})

test('session expiry is fixed at login and cannot be extended by activity', async (t) => {
  let time = START
  const base = await app(t, { now: () => time })
  const { cookie, state } = await login(base)
  const headers = { cookie }
  time += 43_199_999
  assert.equal((await fetch(`${base}/api/health`, { headers })).status, 200)
  assert.deepEqual(await (await fetch(`${base}/api/auth/session`, { headers })).json(), state)
  time += 1
  assert.equal((await fetch(`${base}/api/health`, { headers })).status, 401)
  assert.deepEqual(await (await fetch(`${base}/api/auth/session`, { headers })).json(), {
    configured: true,
    authenticated: false,
  })
})

test('logout revokes the server session and expires the browser cookie', async (t) => {
  const base = await app(t)
  const { cookie } = await login(base)
  const response = await post(base, '/api/auth/logout', {}, { cookie })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { authenticated: false })
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
  assert.equal((await fetch(`${base}/api/health`, { headers: { cookie } })).status, 401)
  assert.equal((await post(base, '/api/auth/logout', {})).status, 200)
})

test('logging in again rotates and revokes the previous session token', async (t) => {
  const base = await app(t)
  const first = await login(base)
  const second = await login(base, { cookie: first.cookie })
  assert.notEqual(second.cookie, first.cookie)
  assert.equal(
    (await fetch(`${base}/api/health`, { headers: { cookie: first.cookie } })).status,
    401,
  )
  assert.equal(
    (await fetch(`${base}/api/health`, { headers: { cookie: second.cookie } })).status,
    200,
  )
})

test('a fresh server cannot use sessions issued by an earlier server', async (t) => {
  const original = await app(t)
  const { cookie } = await login(original)
  const restarted = await app(t)
  assert.equal((await fetch(`${restarted}/api/health`, { headers: { cookie } })).status, 401)
})

test('cross-origin POST requests are rejected before login or authenticated mutations', async (t) => {
  const base = await app(t)
  for (const origin of [
    'https://attacker.example',
    'null',
    base.replace('http:', 'https:'),
    `${base}/path`,
  ]) {
    const response = await post(base, '/api/auth/login', { password: PASSWORD }, { origin })
    assert.equal(response.status, 403, origin)
    assert.equal(response.headers.get('set-cookie'), null)
  }
  const { cookie } = await login(base, { origin: base })
  for (const pathname of ['/api/auth/logout', '/api/chat', '/api/missing']) {
    const response = await post(base, pathname, {}, { cookie, origin: 'https://attacker.example' })
    assert.equal(response.status, 403, pathname)
  }
  assert.equal((await fetch(`${base}/api/health`, { headers: { cookie } })).status, 200)
})

test('same-origin login accepts the external Host preserved by a development proxy', async (t) => {
  const base = await app(t)
  // Node fetch overrides Host, so exercise a real proxy's preserved authority via node:http.
  const response = await new Promise((resolve, reject) => {
    const req = request(
      `${base}/api/auth/login`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: '127.0.0.1:5173',
          origin: 'http://127.0.0.1:5173',
        },
      },
      (res) => {
        res.resume()
        res.on('end', () =>
          resolve({ status: res.statusCode, cookie: res.headers['set-cookie']?.[0] }),
        )
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify({ password: PASSWORD }))
  })
  assert.equal(response.status, 200)
  const cookie = response.cookie.split(';')[0]
  assert.equal((await fetch(`${base}/api/health`, { headers: { cookie } })).status, 200)
})

test('repeated failures are rate limited by socket address despite spoofed forwarded IPs', async (t) => {
  let time = START
  const base = await app(t, { now: () => time })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await post(
      base,
      '/api/auth/login',
      { password: 'wrong' },
      {
        'x-forwarded-for': `198.51.100.${attempt + 1}`,
      },
    )
    assert.equal(response.status, 401)
  }
  const limited = await post(
    base,
    '/api/auth/login',
    { password: PASSWORD },
    {
      'x-forwarded-for': '203.0.113.99',
    },
  )
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
  time += 600_000
  const { cookie } = await login(base)
  assert.equal((await fetch(`${base}/api/health`, { headers: { cookie } })).status, 200)
})

test('parallel login failures cannot bypass the failed-attempt allowance', async (t) => {
  const base = await app(t)
  const responses = await Promise.all(
    Array.from({ length: 12 }, () => post(base, '/api/auth/login', { password: 'wrong' })),
  )
  assert.ok(responses.filter((response) => response.status === 401).length <= 5)
  assert.ok(responses.filter((response) => response.status === 429).length >= 7)
  assert.ok(responses.every((response) => [401, 429].includes(response.status)))
})

test('authentication endpoints reject unsupported methods', async (t) => {
  const base = await app(t)
  for (const pathname of ['/api/auth/login', '/api/auth/logout']) {
    const response = await fetch(`${base}${pathname}`)
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'POST')
  }
  const response = await post(base, '/api/auth/session', {})
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET')
})

test('slow login bodies do not occupy the global password verification slots', async () => {
  const auth = createAuth({ env: { PRTS_PASSWORD: PASSWORD } })
  const releases = []
  const pending = Array.from({ length: 4 }, () =>
    auth
      .login(
        { headers: {}, socket: { remoteAddress: '198.51.100.1' } },
        () => new Promise((resolve) => releases.push(resolve)),
      )
      .catch((error) => error),
  )
  try {
    const result = await auth.login(
      { headers: {}, socket: { remoteAddress: '198.51.100.2' } },
      async () => ({ password: PASSWORD }),
    )
    assert.equal(result.state.authenticated, true)
  } finally {
    for (const release of releases) release({ password: 'wrong' })
    await Promise.all(pending)
  }
})
