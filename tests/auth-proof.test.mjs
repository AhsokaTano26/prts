import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAuth } from '../server/auth.mjs'
import { createDatabase } from '../server/database.mjs'

function fixture(t) {
  const db = createDatabase()
  t.after(() => db.close())
  const auth = createAuth({ database: db, env: { PRTS_PASSWORD: 'proof-test-password-only' } })
  const request = { headers: { host: 'localhost:8791' }, socket: { remoteAddress: '127.0.0.1' } }
  return { auth, db, request }
}

test('verified proofs issue ordinary rotating sessions and commit credential state atomically', async (t) => {
  const { auth, db, request } = fixture(t)
  db.exec('CREATE TABLE proof_state (value INTEGER NOT NULL);INSERT INTO proof_state VALUES (0)')
  const first = await auth.loginWithProof(
    request,
    async () => () => db.prepare('UPDATE proof_state SET value=value+1').run(),
  )
  assert.equal(first.state.authenticated, true)
  const logged = { ...request, headers: { ...request.headers, cookie: first.cookie.split(';')[0] } }
  assert.equal(auth.state(logged).authenticated, true)
  assert.equal(db.prepare('SELECT value FROM proof_state').get().value, 1)
  const second = await auth.loginWithProof(logged, async () => () => {})
  assert.equal(auth.state(logged).authenticated, false)
  assert.notEqual(first.cookie, second.cookie)
  await assert.rejects(
    auth.loginWithProof(request, async () => () => {
      db.exec('UPDATE proof_state SET value=99')
      throw new Error('reject commit')
    }),
    /reject commit/,
  )
  assert.equal(db.prepare('SELECT value FROM proof_state').get().value, 1)
})

test('management password rechecks require a current session and reject stale sessions after password rotation', async (t) => {
  const { auth, request } = fixture(t)
  await assert.rejects(auth.reauthenticate(request, 'proof-test-password-only'), { status: 401 })
  const session = await auth.login(request, async () => ({ password: 'proof-test-password-only' }))
  const logged = {
    ...request,
    headers: { ...request.headers, cookie: session.cookie.split(';')[0] },
  }
  await assert.rejects(auth.reauthenticate(logged, 'wrong'), { status: 400 })
  const version = await auth.reauthenticate(logged, 'proof-test-password-only')
  assert.equal(version, auth.currentVersion())
  await auth.changePassword(logged, async () => ({
    currentPassword: 'proof-test-password-only',
    newPassword: 'replacement-proof-password',
  }))
  assert.notEqual(version, auth.currentVersion())
  await assert.rejects(auth.reauthenticate(logged, 'replacement-proof-password'), { status: 401 })
})

test('a proof verified before password rotation cannot commit a new session afterwards', async (t) => {
  const { auth, request } = fixture(t)
  const session = await auth.login(request, async () => ({ password: 'proof-test-password-only' }))
  const logged = {
    ...request,
    headers: { ...request.headers, cookie: session.cookie.split(';')[0] },
  }
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  let committed = false
  const pending = auth.loginWithProof(request, async () => {
    await blocked
    return () => {
      committed = true
    }
  })
  await auth.changePassword(logged, async () => ({
    currentPassword: 'proof-test-password-only',
    newPassword: 'rotated-proof-password',
  }))
  release()
  await assert.rejects(pending, { status: 401 })
  assert.equal(committed, false)
})

test('revoking credentials blocks already-running proof and password logins without changing the password', async (t) => {
  const { auth, request } = fixture(t)
  let releaseProof, releasePassword
  const proofWait = new Promise((resolve) => {
    releaseProof = resolve
  })
  const passwordWait = new Promise((resolve) => {
    releasePassword = resolve
  })
  const proof = auth.loginWithProof(request, async () => {
    await proofWait
    return () => {}
  })
  const password = auth.login(request, async () => {
    await passwordWait
    return { password: 'proof-test-password-only' }
  })
  auth.revokeSessions()
  releaseProof()
  releasePassword()
  await assert.rejects(proof, { status: 401 })
  await assert.rejects(password, { status: 401 })
  assert.equal(
    (await auth.login(request, async () => ({ password: 'proof-test-password-only' }))).state
      .authenticated,
    true,
  )
})
