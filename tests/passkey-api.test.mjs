import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from '../server/index.mjs'
import { softwarePasskey } from './support/webauthn.mjs'

async function app(t) {
  const server = createServer({ env: { PRTS_PASSWORD: 'api-passkey-test-password' } })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const base = `http://localhost:${server.address().port}`
  const origin = `http://localhost:${server.address().port}`
  const jar = new Map()
  async function call(
    path,
    payload,
    method = payload === undefined ? 'GET' : 'POST',
    headers = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        host: new URL(origin).host,
        origin,
        cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '),
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    })
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(';')[0].split('=')
      if (value) jar.set(name, value)
      else jar.delete(name)
    }
    return response
  }
  return { call, origin, jar, server }
}

test('Passkey HTTP registration, auto-discovery, authentication and deletion keep existing sessions and origin rules', async (t) => {
  const f = await app(t)
  assert.equal((await f.call('/api/auth/passkeys')).status, 401)
  assert.equal(
    (
      await f.call('/api/auth/passkeys/registration/options', {
        currentPassword: 'api-passkey-test-password',
      })
    ).status,
    401,
  )
  assert.equal(
    (await f.call('/api/auth/login', { password: 'api-passkey-test-password' })).status,
    200,
  )
  const creation = await f.call('/api/auth/passkeys/registration/options', {
    name: 'API test',
    currentPassword: 'api-passkey-test-password',
  })
  assert.equal(creation.status, 200)
  assert.match(creation.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict/)
  const options = await creation.json()
  assert.equal(options.authenticatorSelection.userVerification, 'required')
  assert.equal(options.authenticatorSelection.residentKey, 'required')
  const key = softwarePasskey()
  assert.equal(
    (
      await f.call(
        '/api/auth/passkeys/registration/verify',
        key.registration(options, { origin: f.origin }),
      )
    ).status,
    200,
  )
  const list = await (await f.call('/api/auth/passkeys')).json()
  assert.equal(list.credentials.length, 1)
  assert.equal((await (await f.call('/api/auth/session')).json()).passkeyAvailable, true)
  assert.equal(
    (
      await f.call('/api/auth/passkeys/authentication/options', {}, 'POST', {
        origin: 'https://evil.example',
      })
    ).status,
    403,
  )
  await f.call('/api/auth/logout', {})
  const challenge = await (await f.call('/api/auth/passkeys/authentication/options', {})).json()
  const response = await f.call(
    '/api/auth/passkeys/authentication/verify',
    key.assertion(challenge, { origin: f.origin }),
  )
  assert.equal(response.status, 200)
  assert.equal((await response.json()).authenticated, true)
  assert.equal((await f.call('/api/state')).status, 200)
  const removed = await f.call(
    `/api/auth/passkeys/${list.credentials[0].id}`,
    { currentPassword: 'api-passkey-test-password' },
    'DELETE',
  )
  assert.equal(removed.status, 200)
  assert.equal((await f.call('/api/state')).status, 401)
  assert.equal((await (await f.call('/api/auth/session')).json()).passkeyAvailable, undefined)
})
