import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createServer } from '../server/index.mjs'
import { createDatabase } from '../server/database.mjs'
import { createStorage } from '../server/storage.mjs'

const preferences = () => ({
  motionEnabled: true,
  assistant: { persona: 'prts', knowledge: 'all' },
  assistantMode: 'local',
})
const write = (value, expectedRevision = 0) => ({
  value,
  expectedRevision,
  mutationId: crypto.randomUUID(),
})
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-appearance-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
async function app(t) {
  const root = await directory(t)
  const server = createServer({
    env: { PRTS_PASSWORD: 'appearance-test-password-only' },
    databasePath: path.join(root, 'prts.sqlite'),
    log: () => {},
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, server }
}

test('login appearance exposes only the saved theme without requiring authentication or caching it', async (t) => {
  const { base } = await app(t)
  const initial = await fetch(`${base}/api/appearance`)
  assert.equal(initial.status, 200)
  assert.equal(initial.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await initial.json(), { theme: 'rhodes' })

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'appearance-test-password-only' }),
  })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  await login.json()
  const saved = await fetch(`${base}/api/state/preferences`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(
      write({
        ...preferences(),
        assistant: { persona: 'kaltsit', knowledge: 'endfield' },
        appearance: { theme: 'rhine', portrait: 'priestess' },
        migratedBrowserIds: ['private-migration-id'],
      }),
    ),
  })
  assert.equal(saved.status, 200)
  const publicAppearance = await fetch(`${base}/api/appearance`)
  assert.deepEqual(await publicAppearance.json(), { theme: 'rhine' })
  const writePublic = await fetch(`${base}/api/appearance`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme: 'rhodes' }),
  })
  assert.equal(writePublic.status, 405)
  assert.equal(writePublic.headers.get('allow'), 'GET')
  const writePrivate = await fetch(`${base}/api/state/preferences`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(write(preferences(), 1)),
  })
  assert.equal(writePrivate.status, 401)
})

test('appearance survives SQLite reopening and a legacy client cannot erase the saved selection', async (t) => {
  const root = await directory(t)
  const filename = path.join(root, 'prts.sqlite')
  let db = createDatabase({ filename })
  let store = createStorage(db, { uploadsDir: path.join(root, 'uploads') })
  const appearance = { theme: 'rhine', portrait: 'kaltsit' }
  store.putDocument('preferences', write({ ...preferences(), appearance }))
  db.close()
  db = createDatabase({ filename })
  t.after(() => db.close())
  store = createStorage(db, { uploadsDir: path.join(root, 'uploads') })
  assert.deepEqual(store.getDocument('preferences').value.appearance, appearance)
  const saved = store.putDocument(
    'preferences',
    write({ ...preferences(), motionEnabled: false }, 1),
  )
  assert.deepEqual(saved.value.appearance, appearance)
  assert.equal(saved.value.motionEnabled, false)
  assert.equal(store.getDocument('preferences').revision, 2)
})

test('invalid explicit appearance choices cannot mutate a saved preference document', async (t) => {
  const root = await directory(t)
  const db = createDatabase()
  t.after(() => db.close())
  const store = createStorage(db, { uploadsDir: path.join(root, 'uploads') })
  const original = { ...preferences(), appearance: { theme: 'rhine', portrait: 'amiya' } }
  store.putDocument('preferences', write(original))
  for (const appearance of [
    null,
    [],
    'rhine',
    {},
    { theme: 'rhine' },
    { theme: 'rhine', portrait: 'external-image' },
    { theme: 'unknown', portrait: 'amiya' },
    { theme: 'https://example.com/theme.css', portrait: 'amiya' },
  ]) {
    assert.throws(
      () => store.putDocument('preferences', write({ ...preferences(), appearance }, 1)),
      {
        status: 400,
      },
    )
  }
  assert.deepEqual(store.getDocument('preferences'), { value: original, revision: 1 })
})

test('legacy preference reads and invalid stored themes fall back safely without rewriting SQLite', async (t) => {
  const { base, server } = await app(t)
  const insert = server.database.prepare(
    'INSERT INTO prts_documents (key,data,revision,updated_at) VALUES (?,?,?,?)',
  )
  insert.run('preferences', JSON.stringify(preferences()), 1, new Date().toISOString())
  assert.deepEqual(await (await fetch(`${base}/api/appearance`)).json(), { theme: 'rhodes' })
  const invalid = { ...preferences(), appearance: { theme: 'unexpected-private-value' } }
  server.database
    .prepare('UPDATE prts_documents SET data=? WHERE key=?')
    .run(JSON.stringify(invalid), 'preferences')
  assert.deepEqual(await (await fetch(`${base}/api/appearance`)).json(), { theme: 'rhodes' })
  assert.deepEqual(
    JSON.parse(
      server.database.prepare('SELECT data FROM prts_documents WHERE key=?').get('preferences')
        .data,
    ),
    invalid,
  )
})

test('importing old browser preferences preserves current appearance while explicit imports can change it', async (t) => {
  const root = await directory(t)
  const db = createDatabase()
  t.after(() => db.close())
  const store = createStorage(db, { uploadsDir: path.join(root, 'uploads') })
  const appearance = { theme: 'rhine', portrait: 'priestess' }
  store.putDocument('preferences', write({ ...preferences(), appearance }))
  const legacy = store.importDocuments({
    documents: { preferences: preferences() },
    expectedRevisions: { workspace: 0, preferences: 1, focus: 0 },
    mutationId: crypto.randomUUID(),
  })
  assert.deepEqual(legacy.documents.preferences.value.appearance, appearance)
  const explicit = store.importDocuments({
    documents: {
      preferences: { ...preferences(), appearance: { theme: 'rhodes', portrait: 'kaltsit' } },
    },
    expectedRevisions: { workspace: 0, preferences: 2, focus: 0 },
    mutationId: crypto.randomUUID(),
  })
  assert.deepEqual(explicit.documents.preferences.value.appearance, {
    theme: 'rhodes',
    portrait: 'kaltsit',
  })
})
