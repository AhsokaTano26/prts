import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatabase } from '../server/database.mjs'
import { createAuth } from '../server/auth.mjs'
import { createPasskeys } from '../server/passkeys.mjs'
import { softwarePasskey } from './support/webauthn.mjs'

const password = 'passkey-test-password-only'
async function fixture(t) {
  const db = createDatabase()
  t.after(() => db.close())
  let now = Date.now()
  const auth = createAuth({ database: db, env: { PRTS_PASSWORD: password }, now: () => now })
  const passkeys = createPasskeys(db, auth, { now: () => now })
  const request = { headers: { host: 'localhost:8791' }, socket: { remoteAddress: '127.0.0.1' } }
  const session = await auth.login(request, async () => ({ password }))
  const logged = {
    ...request,
    headers: { ...request.headers, cookie: session.cookie.split(';')[0] },
  }
  const ceremony = (request, cookie) => ({
    ...request,
    headers: {
      ...request.headers,
      cookie: [request.headers.cookie, cookie.split(';')[0]].filter(Boolean).join('; '),
    },
  })
  async function register(key = softwarePasskey(), name = '测试设备') {
    const result = await passkeys.registrationOptions(logged, { currentPassword: password, name })
    const response = key.registration(result.options)
    const saved = await passkeys.verifyRegistration(ceremony(logged, result.cookie), response)
    return { key, saved, options: result.options }
  }
  return {
    db,
    auth,
    passkeys,
    request,
    logged,
    ceremony,
    register,
    get now() {
      return now
    },
    set now(value) {
      now = value
    },
  }
}

test('real registration and signed authentication use SQLite public keys, ordinary sessions and one-use challenges', async (t) => {
  const f = await fixture(t)
  const { key } = await f.register()
  assert.equal(f.passkeys.status(f.request).available, true)
  const list = f.passkeys.list(f.logged)
  assert.equal(list.credentials.length, 1)
  assert.doesNotMatch(JSON.stringify(list), /public_key|publicKey|private|challenge/)
  const challenge = await f.passkeys.authenticationOptions(f.request)
  assert.equal(challenge.options.userVerification, 'required')
  const request = f.ceremony(f.request, challenge.cookie)
  const assertion = key.assertion(challenge.options)
  const result = await f.passkeys.verifyAuthentication(request, assertion)
  assert.equal(result.state.authenticated, true)
  assert.equal(
    f.auth.state({
      ...f.request,
      headers: { ...f.request.headers, cookie: result.cookie.split(';')[0] },
    }).authenticated,
    true,
  )
  await assert.rejects(f.passkeys.verifyAuthentication(request, assertion), { status: 400 })
  assert.equal(f.db.prepare('SELECT counter FROM prts_passkeys').get().counter, 1)
})

test('wrong origins, RP IDs, UV, signatures, handles and browser cookies cannot authenticate', async (t) => {
  const f = await fixture(t)
  const { key } = await f.register()
  for (const changes of [
    { origin: 'https://evil.example' },
    { rpID: 'evil.example' },
    { uv: false },
    { userHandle: 'd3Jvbmc' },
  ]) {
    const challenge = await f.passkeys.authenticationOptions(f.request)
    await assert.rejects(
      f.passkeys.verifyAuthentication(
        f.ceremony(f.request, challenge.cookie),
        key.assertion(challenge.options, changes),
      ),
      { status: 401 },
    )
  }
  // Test the remaining rejection paths in a fresh rate-limit window.
  f.now += 10 * 60_000 + 1
  const challenge = await f.passkeys.authenticationOptions(f.request)
  await assert.rejects(
    f.passkeys.verifyAuthentication(f.request, key.assertion(challenge.options)),
    { status: 400 },
  )
  const correct = f.ceremony(f.request, challenge.cookie)
  const assertion = key.assertion(challenge.options)
  assertion.response.signature = 'YmFk'
  await assert.rejects(f.passkeys.verifyAuthentication(correct, assertion), { status: 401 })
})

test('registration needs a current password and original session, and management survives a new module instance', async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.passkeys.registrationOptions(f.request, { currentPassword: password }), {
    status: 401,
  })
  await assert.rejects(f.passkeys.registrationOptions(f.logged, { currentPassword: 'wrong' }), {
    status: 400,
  })
  const { saved } = await f.register()
  const restarted = createPasskeys(f.db, f.auth, { now: () => f.now })
  assert.equal(restarted.list(f.logged).credentials.length, 1)
  await assert.rejects(restarted.remove(f.logged, saved.id, { currentPassword: 'wrong' }), {
    status: 400,
  })
  await restarted.remove(f.logged, saved.id, { currentPassword: password })
  assert.equal(f.auth.state(f.logged).authenticated, false)
  assert.equal(restarted.status(f.request).available, false)
})

test('expired challenges are rejected and synced credentials with zero counters remain usable', async (t) => {
  const f = await fixture(t)
  const { key } = await f.register(softwarePasskey({ synced: true }))
  const expired = await f.passkeys.authenticationOptions(f.request)
  f.now += 300_001
  await assert.rejects(
    f.passkeys.verifyAuthentication(
      f.ceremony(f.request, expired.cookie),
      key.assertion(expired.options),
    ),
    { status: 400 },
  )
  for (let i = 0; i < 2; i++) {
    const challenge = await f.passkeys.authenticationOptions(f.request)
    assert.equal(
      (
        await f.passkeys.verifyAuthentication(
          f.ceremony(f.request, challenge.cookie),
          key.assertion(challenge.options),
        )
      ).state.authenticated,
      true,
    )
  }
})

test('IP and insecure public hosts are unsupported and cannot enroll credentials', async (t) => {
  const f = await fixture(t)
  for (const host of ['127.0.0.1:8791', 'example.com', '[::1]:8791']) {
    const request = { ...f.logged, headers: { ...f.logged.headers, host } }
    assert.equal(f.passkeys.status(request).supported, false)
    await assert.rejects(f.passkeys.registrationOptions(request, { currentPassword: password }), {
      status: 400,
    })
  }
})

test('cross-origin iframe ceremonies are rejected even when a browser omits topOrigin', async (t) => {
  const f = await fixture(t)
  const { key } = await f.register()
  const challenge = await f.passkeys.authenticationOptions(f.request)
  await assert.rejects(
    f.passkeys.verifyAuthentication(
      f.ceremony(f.request, challenge.cookie),
      key.assertion(challenge.options, { crossOrigin: true }),
    ),
    { status: 401 },
  )
  const creation = await f.passkeys.registrationOptions(f.logged, { currentPassword: password })
  await assert.rejects(
    f.passkeys.verifyRegistration(
      f.ceremony(f.logged, creation.cookie),
      softwarePasskey().registration(creation.options, { crossOrigin: true }),
    ),
    { status: 400 },
  )
})

test('removing a credential while its signature is being verified prevents the final session commit', async (t) => {
  const f = await fixture(t)
  const { key } = await f.register()
  const challenge = await f.passkeys.authenticationOptions(f.request)
  const pending = f.passkeys.verifyAuthentication(
    f.ceremony(f.request, challenge.cookie),
    key.assertion(challenge.options),
  )
  f.db.exec('DELETE FROM prts_passkeys')
  await assert.rejects(pending, { status: 401 })
})

test('public challenge allocation is bounded per address and old challenge cookies are not duplicated', async (t) => {
  const f = await fixture(t)
  await f.register()
  for (let i = 0; i < 9; i++) await f.passkeys.authenticationOptions(f.request)
  // The previous registration ceremony was consumed, leaving nine live logins.
  const tenth = await f.passkeys.authenticationOptions(f.request)
  await assert.rejects(f.passkeys.authenticationOptions(f.request), { status: 429 })
  const replace = f.ceremony(f.request, tenth.cookie)
  await f.passkeys.authenticationOptions(replace)
  assert.equal(
    f.db.prepare('SELECT COUNT(*) AS count FROM prts_passkey_challenges').get().count,
    10,
  )
})
