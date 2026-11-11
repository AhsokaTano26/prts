import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDatabase } from '../server/database.mjs'
import { createStorage } from '../server/storage.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'
import { createPlace } from '../src/lib/places.ts'
import { createWorkspaceTools } from '../server/assistant-tools.mjs'

function setup(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'prts-places-storage-'))
  const database = createDatabase({ filename: path.join(directory, 'workspace.sqlite') })
  t.after(() => database.close())
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return {
    store: createStorage(database, { uploadsDir: path.join(directory, 'uploads') }),
    database,
  }
}
const write = (value, expectedRevision = 0, mutationId = crypto.randomUUID()) => ({
  value,
  expectedRevision,
  mutationId,
})
const preferences = () => ({
  motionEnabled: true,
  assistant: { persona: 'prts', knowledge: 'all' },
  assistantMode: 'local',
})
const map = () => ({
  apiKey: '1234567890abcdef1234567890abcdef',
  center: { lng: 104, lat: 35 },
  zoom: 5,
  layer: 'vector',
})

test('old workspace PUT preserves places while explicit empty clears and stale PUT cannot erase', (t) => {
  const { store } = setup(t)
  const initial = { ...createInitialWorkspace(), places: [createPlace({ name: '山间书屋' })] }
  store.putDocument('workspace', write(initial))
  const older = structuredClone(initial)
  delete older.places
  older.tasks[0].title = '旧页面改了任务'
  const saved = store.putDocument('workspace', write(older, 1))
  assert.deepEqual(saved.value.places, initial.places)
  assert.deepEqual(store.getDocument('workspace').value.places, initial.places)
  assert.throws(() => store.putDocument('workspace', write({ ...initial, places: [] }, 1)), {
    status: 409,
  })
  assert.deepEqual(
    store.putDocument('workspace', write({ ...initial, places: [] }, 2)).value.places,
    [],
  )
})

test('authoritative legacy workspace import clears places and rejects invalid place data atomically', (t) => {
  const { store } = setup(t)
  const initial = { ...createInitialWorkspace(), places: [createPlace({ name: '饭馆' })] }
  store.putDocument('workspace', write(initial))
  assert.throws(() => store.putDocument('workspace', write({ ...initial, places: null }, 1)), {
    status: 400,
  })
  assert.equal(store.getDocument('workspace').revision, 1)
  const older = structuredClone(initial)
  delete older.places
  const restored = store.importDocuments({
    documents: { workspace: older, preferences: preferences() },
    expectedRevisions: { workspace: 1, preferences: 0, focus: 0 },
    mutationId: crypto.randomUUID(),
  })
  assert.deepEqual(restored.documents.workspace.value.places, [])
})

test('map configuration survives older preference writers and explicit clearing remains possible', (t) => {
  const { store } = setup(t)
  store.putDocument('preferences', write({ ...preferences(), map: map() }))
  assert.deepEqual(store.getDocument('preferences').value.map, map())
  const saved = store.putDocument(
    'preferences',
    write({ ...preferences(), motionEnabled: false }, 1),
  )
  assert.deepEqual(saved.value.map, map())
  const cleared = { ...map(), apiKey: '' }
  assert.deepEqual(
    store.putDocument('preferences', write({ ...preferences(), map: cleared }, 2)).value.map,
    cleared,
  )
})

test('invalid map preferences never update revisions or overwrite valid configuration', (t) => {
  const { store } = setup(t)
  store.putDocument('preferences', write({ ...preferences(), map: map() }))
  for (const changes of [
    { zoom: 0 },
    { layer: 'bad' },
    { center: { lng: 181, lat: 30 } },
    { apiKey: '<script>' },
  ]) {
    assert.throws(
      () =>
        store.putDocument(
          'preferences',
          write({ ...preferences(), map: { ...map(), ...changes } }, 1),
        ),
      { status: 400 },
    )
    assert.equal(store.getDocument('preferences').revision, 1)
  }
})

test('old-writer idempotent response contains committed places instead of default empty array', (t) => {
  const { store } = setup(t)
  const initial = { ...createInitialWorkspace(), places: [createPlace({ name: '书屋' })] }
  store.putDocument('workspace', write(initial))
  const older = structuredClone(initial)
  delete older.places
  const request = write(older, 1)
  const first = store.putDocument('workspace', request)
  const retried = store.putDocument('workspace', request)
  assert.deepEqual(retried, first)
  assert.deepEqual(retried.value.places, initial.places)
})

test('places survive a reopened SQLite database and another module completing focus', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'prts-places-reopen-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const filename = path.join(directory, 'workspace.sqlite')
  let database = createDatabase({ filename })
  let store = createStorage(database, { uploadsDir: path.join(directory, 'uploads') })
  const place = createPlace({ name: '重访书屋' })
  store.putDocument('workspace', write({ ...createInitialWorkspace(), places: [place] }))
  database.close()
  database = createDatabase({ filename })
  t.after(() => database.close())
  store = createStorage(database, { uploadsDir: path.join(directory, 'uploads') })
  assert.deepEqual(store.getDocument('workspace').value.places, [place])
  store.putDocument('focus', write({ remaining: 1, endAt: 1, sessionId: 'places-focus' }))
  assert.deepEqual(store.completeFocus('places-focus').documents.workspace.value.places, [place])
})

test('assistant task mutations preserve place records without adding them to overview context', (t) => {
  const { store, database } = setup(t)
  const place = createPlace({ name: '我的私人地点', note: '私密收藏备注' })
  store.putDocument('workspace', write({ ...createInitialWorkspace(), places: [place] }))
  const tools = createWorkspaceTools(database, store)
  const session = tools.session()
  const proposal = session.execute(
    'propose_workspace_change',
    JSON.stringify({ operation: 'create_task', fields: { title: '新的待办' } }),
  )
  tools.decide(proposal.action.id, 'apply')
  assert.deepEqual(store.getDocument('workspace').value.places, [place])
  assert.ok(!JSON.stringify(tools.overview()).includes('私密收藏备注'))
})

test('merged legacy payload is checked against document size before committing', (t) => {
  const { store } = setup(t)
  const place = createPlace({ name: '长备注', note: '长'.repeat(5000) })
  store.putDocument('workspace', write({ ...createInitialWorkspace(), places: [place] }))
  const older = { ...store.getDocument('workspace').value }
  delete older.places
  older.notes = Array.from({ length: 10 }, (_, index) => ({
    id: `n${index}`,
    title: 'x',
    content: 'x'.repeat(1_000_000),
    tag: '',
    pinned: false,
    updatedAt: '2026-11-11T00:00:00Z',
  }))
  // Request stays below 10 MiB; retained UTF-8 place data pushes the merged value over.
  older.notes.push({ ...older.notes[0], id: 'n10', content: 'x'.repeat(480_000) })
  assert.ok(Buffer.byteLength(JSON.stringify(older)) < 10 * 1024 * 1024)
  assert.throws(() => store.putDocument('workspace', write(older, 1)), { status: 413 })
  assert.equal(store.getDocument('workspace').revision, 1)
})

test('reading legacy database rows supplies places without rewriting stored content or revision', (t) => {
  const { store, database } = setup(t)
  const old = { ...createInitialWorkspace() }
  delete old.places
  database
    .prepare('INSERT INTO prts_documents (key,data,revision,updated_at) VALUES (?,?,?,?)')
    .run('workspace', JSON.stringify(old), 7, '2026-11-11T00:00:00Z')
  assert.deepEqual(store.getDocument('workspace').value.places, [])
  assert.deepEqual(store.getState().documents.workspace.value.places, [])
  const row = database
    .prepare('SELECT data,revision FROM prts_documents WHERE key=?')
    .get('workspace')
  assert.equal(row.revision, 7)
  assert.equal(JSON.parse(row.data).places, undefined)
})
