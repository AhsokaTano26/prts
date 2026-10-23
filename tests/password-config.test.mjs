import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createAuth } from '../server/auth.mjs'
import { createDatabase } from '../server/database.mjs'

const PASSWORD = 'database-password-test-only'
const NEW_PASSWORD = 'database-new-password-test-only'
const request = (cookie = '', address = '192.0.2.1') => ({
  method: 'POST',
  headers: { cookie },
  socket: { remoteAddress: address },
})
const login = (auth, password = PASSWORD, address) =>
  auth.login(request('', address), async () => ({ password }))
const cookieOf = (result) => result.cookie.split(';')[0]

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-password-config-'))
  const connections = []
  t.after(async () => {
    for (const database of connections) database.close()
    await rm(root, { recursive: true, force: true })
  })
  return (env = { PRTS_PASSWORD: PASSWORD }, logger = () => {}) => {
    const database = createDatabase({ filename: path.join(root, 'prts.sqlite') })
    connections.push(database)
    return { database, auth: createAuth({ env, database, logger }) }
  }
}

test('a generated first password is logged once, persists, and is never stored in plaintext', async (t) => {
  const open = await fixture(t)
  const logs = []
  const first = open({}, (message) => logs.push(message))
  assert.equal(logs.length, 1)
  const generated = logs[0].match(/：([A-Za-z0-9_-]{32,})$/)?.[1]
  assert.ok(
    generated,
    'A cryptographically generated password must be included in the one-time log',
  )
  assert.equal((await login(first.auth, generated)).state.authenticated, true)
  const rows = first.database.prepare('SELECT key,value FROM auth_metadata').all()
  assert.equal(
    rows.some((row) => Buffer.from(row.value).toString().includes(generated)),
    false,
  )
  const second = open({ PRTS_PASSWORD: 'ignored-new-environment-password' }, (line) =>
    logs.push(line),
  )
  assert.equal(logs.length, 1)
  assert.equal((await login(second.auth, generated)).state.authenticated, true)
  await assert.rejects(login(second.auth, 'ignored-new-environment-password'), { status: 401 })
})

test('an explicit bootstrap password is stored once without logging and later env values are ignored', async (t) => {
  const open = await fixture(t)
  const logs = []
  const first = open({ PRTS_PASSWORD: PASSWORD }, (line) => logs.push(line))
  const signedIn = await login(first.auth)
  const second = open({}, (line) => logs.push(line))
  assert.equal(second.auth.state(request(cookieOf(signedIn))).authenticated, true)
  assert.equal((await login(second.auth)).state.authenticated, true)
  assert.deepEqual(logs, [])
})

test('invalid stored credentials fail closed without generating or replacing a password', async (t) => {
  const open = await fixture(t)
  const { database } = open()
  database
    .prepare('UPDATE auth_metadata SET value = ? WHERE key = ?')
    .run(Buffer.from('{}'), 'password-credential')
  const logs = []
  assert.throws(() => open({}, (line) => logs.push(line)))
  assert.deepEqual(logs, [])
  assert.equal(
    Buffer.from(
      database.prepare('SELECT value FROM auth_metadata WHERE key = ?').get('password-credential')
        .value,
    ).toString(),
    '{}',
  )
})

test('database password changes revoke every session and are observed by existing and new instances', async (t) => {
  const open = await fixture(t)
  const first = open()
  const second = open({ PRTS_PASSWORD: 'ignored-password' })
  const a = await login(first.auth)
  const b = await login(second.auth)
  const cleared = await first.auth.changePassword(request(cookieOf(a)), async () => ({
    currentPassword: PASSWORD,
    newPassword: NEW_PASSWORD,
  }))
  assert.match(cleared, /Max-Age=0/)
  assert.equal(first.auth.state(request(cookieOf(a))).authenticated, false)
  assert.equal(second.auth.state(request(cookieOf(b))).authenticated, false)
  await assert.rejects(login(first.auth), { status: 401 })
  assert.equal((await login(second.auth, NEW_PASSWORD)).state.authenticated, true)
  assert.equal((await login(open().auth, NEW_PASSWORD)).state.authenticated, true)
  assert.equal(first.database.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get().count, 2)
})

test('wrong current passwords and invalid replacements preserve the original password and session', async (t) => {
  const { auth } = (await fixture(t))()
  const current = request(cookieOf(await login(auth)))
  for (const payload of [
    { currentPassword: 'wrong-password', newPassword: NEW_PASSWORD },
    { currentPassword: PASSWORD, newPassword: 'short' },
    { currentPassword: PASSWORD, newPassword: '        ' },
    { currentPassword: PASSWORD, newPassword: 'x'.repeat(1025) },
  ]) {
    await assert.rejects(
      auth.changePassword(current, async () => payload),
      { status: 400 },
    )
    assert.equal(auth.state(current).authenticated, true)
  }
  assert.equal((await login(auth)).state.authenticated, true)
})

test('password-change guesses share persistent limits and require an authenticated session', async (t) => {
  const open = await fixture(t)
  const { auth } = open()
  const change = async () => ({ currentPassword: 'wrong-password', newPassword: NEW_PASSWORD })
  await assert.rejects(auth.changePassword(request(), change), { status: 401 })
  const current = request(cookieOf(await login(auth)))
  for (let i = 0; i < 5; i++)
    await assert.rejects(auth.changePassword(current, change), { status: 400 })
  const restarted = open().auth
  await assert.rejects(restarted.changePassword(current, change), { status: 429 })
  assert.equal(restarted.state(current).authenticated, true)
})

test('a pending old login and concurrent password changes cannot retain old authentication', async (t) => {
  const { auth } = (await fixture(t))()
  const current = request(cookieOf(await login(auth)))
  let release
  const pending = auth.login(
    request('', '192.0.2.2'),
    () => new Promise((resolve) => (release = resolve)),
  )
  const outcome = pending.catch((error) => error)
  const results = await Promise.allSettled([
    auth.changePassword(current, async () => ({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    })),
    auth.changePassword(current, async () => ({
      currentPassword: PASSWORD,
      newPassword: `${NEW_PASSWORD}-two`,
    })),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.find((result) => result.status === 'rejected').reason.status, 401)
  release({ password: PASSWORD })
  assert.equal((await outcome).status, 401)
  assert.equal(auth.state(current).authenticated, false)
})

test('legacy salt-only databases bootstrap the credential without discarding valid sessions', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-password-legacy-'))
  const database = createDatabase({ filename: path.join(root, 'prts.sqlite') })
  t.after(async () => {
    database.close()
    await rm(root, { recursive: true, force: true })
  })
  const { createHash, scryptSync } = await import('node:crypto')
  const salt = Buffer.alloc(16, 42)
  const hash = scryptSync(PASSWORD, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 })
  const version = createHash('sha256').update(hash).digest('hex')
  const token = Buffer.alloc(32, 5).toString('base64url')
  database.exec('CREATE TABLE auth_metadata (key TEXT PRIMARY KEY, value BLOB NOT NULL)')
  database.prepare('INSERT INTO auth_metadata VALUES (?, ?)').run('password-salt', salt)
  database.exec(
    'CREATE TABLE auth_sessions (key TEXT PRIMARY KEY, value TEXT NOT NULL, version TEXT NOT NULL)',
  )
  database
    .prepare('INSERT INTO auth_sessions VALUES (?, ?, ?)')
    .run(
      createHash('sha256').update(token).digest('hex'),
      JSON.stringify(Date.now() + 60_000),
      version,
    )
  const auth = createAuth({
    database,
    env: { PRTS_PASSWORD: PASSWORD },
    logger: () => assert.fail('No password log for environment initialization'),
  })
  assert.equal(auth.state(request(`prts_session=${token}`)).authenticated, true)
  assert.equal((await login(auth)).state.authenticated, true)
  const restarted = createAuth({
    database,
    env: {},
    logger: () => assert.fail('Must not regenerate'),
  })
  assert.equal((await login(restarted)).state.authenticated, true)
})
