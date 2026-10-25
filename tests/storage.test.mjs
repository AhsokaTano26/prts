import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { createDatabase } from '../server/database.mjs'
import { createStorage, storageRoute, MAX_FILE_BYTES } from '../server/storage.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'

function setup(t, options = {}) {
  const db = createDatabase()
  const uploadsDir = mkdtempSync(path.join(os.tmpdir(), 'prts-upload-test-'))
  t.after(() => db.close())
  t.after(() => rmSync(uploadsDir, { recursive: true, force: true }))
  return { db, uploadsDir, store: createStorage(db, { uploadsDir, ...options }) }
}
const write = (value, expectedRevision = 0, mutationId = crypto.randomUUID()) => ({
  value,
  expectedRevision,
  mutationId,
})
const file = (id, content, name = '文档.txt') => ({
  id,
  name,
  type: 'text/plain',
  createdAt: '2026-10-23T00:00:00.000Z',
  data: Buffer.from(content).toString('base64'),
})
const message = (id, content = id) => ({ id, role: 'user', content, mode: 'local' })

test('SQLite documents survive reopening and stale revisions never overwrite saved content', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-sqlite-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const filename = path.join(root, 'private', 'prts.sqlite')
  let db = createDatabase({ filename })
  let store = createStorage(db, { uploadsDir: path.join(root, 'uploads') })
  const workspace = createInitialWorkspace()
  const initial = write(workspace, 0, 'initial-write')
  assert.equal(store.putDocument('workspace', initial).revision, 1)
  assert.equal(store.putDocument('workspace', initial).revision, 1)
  db.close()
  db = createDatabase({ filename })
  t.after(() => db.close())
  store = createStorage(db, { uploadsDir: path.join(root, 'uploads') })
  assert.deepEqual(store.getState().documents.workspace, { value: workspace, revision: 1 })
  const next = { ...workspace, settings: { ...workspace.settings, name: '远端新名字' } }
  assert.equal(store.putDocument('workspace', write(next, 1)).revision, 2)
  assert.throws(() => store.putDocument('workspace', write(workspace, 1)), { status: 409 })
  assert.throws(() => store.putDocument('workspace', { ...initial, value: next }), { status: 409 })
  assert.equal(store.getState().documents.workspace.value.settings.name, '远端新名字')
})

test('document validation rejects invalid data without changing revisions or allowing arbitrary keys', (t) => {
  const { store } = setup(t)
  const workspace = createInitialWorkspace()
  store.putDocument('workspace', write(workspace))
  assert.throws(() => store.putDocument('workspace', write({ tasks: [] }, 1)), { status: 400 })
  assert.throws(() => store.putDocument('unexpected', write({})), { status: 404 })
  assert.throws(() => store.putDocument('preferences', write({ motionEnabled: 'yes' })), {
    status: 400,
  })
  assert.throws(
    () => store.putDocument('focus', write({ remaining: -1, endAt: null, sessionId: null })),
    { status: 400 },
  )
  assert.equal(store.getState().documents.workspace.revision, 1)
  const preferences = {
    motionEnabled: false,
    assistant: { persona: 'amiya', knowledge: 'endfield' },
    assistantMode: 'ai',
  }
  assert.deepEqual(store.putDocument('preferences', write(preferences)).value, preferences)
})

test('files store exact disk bytes and only metadata in SQLite; repeats are idempotent', (t) => {
  const { store, db, uploadsDir } = setup(t)
  const bytes = Buffer.from([0, 255, 1, 128, 10])
  const input = file('binary-file', bytes)
  const first = store.putFiles([input])
  assert.equal(first.files[0].size, bytes.length)
  assert.equal(first.files[0].name, '文档.txt')
  assert.equal('data' in first.files[0], false)
  assert.equal('blob' in first.files[0], false)
  assert.deepEqual(store.putFiles([input]), first)
  assert.deepEqual(store.getFile('binary-file').bytes, bytes)
  assert.equal(
    db
      .prepare('PRAGMA table_info(prts_files)')
      .all()
      .some((column) => column.name === 'data'),
    false,
  )
  const diskKey = db
    .prepare('SELECT disk_key FROM prts_files WHERE id=?')
    .get('binary-file').disk_key
  assert.deepEqual(readFileSync(path.join(uploadsDir, diskKey)), bytes)
  assert.throws(() => store.putFiles([file('binary-file', 'other')]), { status: 409 })
  assert.throws(() => store.putFiles([{ ...input, id: 'invalid', data: 'bad!base64' }]), {
    status: 400,
  })
  store.deleteFile('binary-file')
  assert.deepEqual(store.listFiles(), { files: [] })
  assert.throws(() => store.getFile('binary-file'), { status: 404 })
  assert.deepEqual(readdirSync(uploadsDir), [])
})

test('file quota checks are atomic across uploads and reject the entire batch', (t) => {
  const { store, uploadsDir } = setup(t, { maxFileBytes: 8, maxTotalFileBytes: 12 })
  store.putFiles([file('one', '12345678')])
  assert.throws(() => store.putFiles([file('two', '123'), file('three', '123')]), { status: 413 })
  assert.deepEqual(
    store.listFiles().files.map((entry) => entry.id),
    ['one'],
  )
  assert.equal(readdirSync(uploadsDir).length, 1)
  assert.throws(() => store.putFiles([file('large', '123456789')]), { status: 413 })
  store.putFiles([file('two', '1234')])
  assert.equal(
    store.listFiles().files.reduce((sum, entry) => sum + entry.size, 0),
    12,
  )
})

test('the advertised 20 MB file boundary accepts real binary content', (t) => {
  const { store } = setup(t)
  const bytes = Buffer.alloc(MAX_FILE_BYTES, 0xab)
  store.putFiles([file('full-size-file', bytes)])
  assert.deepEqual(store.getFile('full-size-file').bytes, bytes)
})

test('separate SQLite connections share revisions and file quota safely', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-connections-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const filename = path.join(root, 'shared.sqlite')
  const uploadsDir = path.join(root, 'uploads')
  const firstDb = createDatabase({ filename })
  const secondDb = createDatabase({ filename })
  t.after(() => {
    firstDb.close()
    secondDb.close()
  })
  const first = createStorage(firstDb, { uploadsDir, maxFileBytes: 8, maxTotalFileBytes: 12 })
  const second = createStorage(secondDb, { uploadsDir, maxFileBytes: 8, maxTotalFileBytes: 12 })
  first.putDocument('workspace', write(createInitialWorkspace()))
  const stale = second.getState().documents.workspace
  first.putDocument('workspace', write({ ...stale.value, focusSessions: 9 }, 1))
  assert.throws(() => second.putDocument('workspace', write(stale.value, 1)), { status: 409 })
  first.putFiles([file('one', '12345678')])
  assert.throws(() => second.putFiles([file('two', '12345678')]), { status: 413 })
  assert.equal(second.listFiles().files.length, 1)
})

test('uploaded file content remains readable after reopening the metadata database', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-file-restart-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const filename = path.join(root, 'prts.sqlite')
  const uploadsDir = path.join(root, 'uploads')
  let db = createDatabase({ filename })
  let store = createStorage(db, { uploadsDir })
  store.putFiles([file('preserved-file', '长期文件内容')])
  db.close()
  db = createDatabase({ filename })
  t.after(() => db.close())
  store = createStorage(db, { uploadsDir })
  assert.equal(store.getFile('preserved-file').bytes.toString(), '长期文件内容')
  assert.equal(store.listFiles().files.length, 1)
})

test('failed file metadata writes remove only newly staged files and leave earlier uploads intact', (t) => {
  const { db, store, uploadsDir } = setup(t)
  const existing = file('kept', 'existing-file')
  store.putFiles([existing])
  const previousPaths = readdirSync(uploadsDir)
  db.exec(
    "CREATE TRIGGER reject_test_file BEFORE INSERT ON prts_files WHEN NEW.id='reject' BEGIN SELECT RAISE(ABORT,'injected failure'); END",
  )
  assert.throws(
    () => store.putFiles([existing, file('new', 'new-file'), file('reject', 'rejected-file')]),
    /injected failure/,
  )
  assert.deepEqual(readdirSync(uploadsDir), previousPaths)
  assert.equal(store.getFile('kept').bytes.toString(), 'existing-file')
  assert.deepEqual(
    store.listFiles().files.map((entry) => entry.id),
    ['kept'],
  )
})

test('disk keys ignore supplied filenames and do not follow symlinks or delete another upload', (t) => {
  const { db, store, uploadsDir } = setup(t)
  store.putFiles([file('one', 'same-data', '../../outside.txt'), file('two', 'same-data')])
  const paths = readdirSync(uploadsDir)
  assert.equal(paths.length, 2)
  assert.equal(
    paths.every((name) => /^[a-f0-9-]{36}\.bin$/.test(name)),
    true,
  )
  store.deleteFile('one')
  assert.equal(store.getFile('two').bytes.toString(), 'same-data')
  const key = db.prepare('SELECT disk_key FROM prts_files WHERE id=?').get('two').disk_key
  const target = path.join(uploadsDir, 'untouched.txt')
  writeFileSync(target, 'not-an-upload')
  unlinkSync(path.join(uploadsDir, key))
  symlinkSync(target, path.join(uploadsDir, key))
  assert.throws(() => store.getFile('two'), { status: 500 })
  store.deleteFile('two')
  assert.equal(readFileSync(target, 'utf8'), 'not-an-upload')
})

test('earlier development BLOB uploads migrate to disk without losing content', (t) => {
  const db = createDatabase()
  const uploadsDir = mkdtempSync(path.join(os.tmpdir(), 'prts-blob-migration-'))
  t.after(() => {
    db.close()
    rmSync(uploadsDir, { recursive: true, force: true })
  })
  db.exec(
    'DROP TABLE prts_files; CREATE TABLE prts_files (id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL,sha256 TEXT NOT NULL,data BLOB NOT NULL) STRICT',
  )
  const bytes = Buffer.from('earlier-file-content')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  db.prepare('INSERT INTO prts_files VALUES (?,?,?,?,?,?,?)').run(
    'old-file',
    '旧文件.txt',
    'text/plain',
    bytes.length,
    '2026-10-23T00:00:00.000Z',
    sha256,
    bytes,
  )
  const store = createStorage(db, { uploadsDir })
  assert.deepEqual(store.getFile('old-file').bytes, bytes)
  assert.equal(
    db
      .prepare('PRAGMA table_info(prts_files)')
      .all()
      .some((column) => column.type === 'BLOB'),
    false,
  )
  assert.equal(readdirSync(uploadsDir).length, 1)
})

test('atomic document import changes no document on conflict and replays idempotently', (t) => {
  const { store } = setup(t)
  const workspace = createInitialWorkspace()
  const preferences = {
    motionEnabled: true,
    assistant: { persona: 'prts', knowledge: 'all' },
    assistantMode: 'local',
  }
  const focus = { remaining: 1500, endAt: null, sessionId: null }
  const initial = {
    documents: { workspace, preferences, focus },
    expectedRevisions: { workspace: 0, preferences: 0, focus: 0 },
    mutationId: 'initial-browser-import',
  }
  const first = store.importDocuments(initial)
  assert.deepEqual(store.importDocuments(initial), first)
  const changed = { ...workspace, settings: { ...workspace.settings, name: '服务器更新' } }
  store.putDocument('workspace', write(changed, 1))
  const before = store.getState()
  assert.deepEqual(store.importDocuments(initial), before)
  const next = {
    documents: {
      workspace,
      preferences: { ...preferences, migratedBrowserIds: ['browser-two'] },
      focus: { ...focus, remaining: 300 },
    },
    expectedRevisions: { workspace: 1, preferences: 1, focus: 1 },
    mutationId: 'second-browser-import',
  }
  assert.throws(() => store.importDocuments(next), { status: 409 })
  assert.deepEqual(store.getState(), before)
  assert.throws(
    () =>
      store.importDocuments({
        ...initial,
        documents: { ...initial.documents, workspace: changed },
      }),
    { status: 409 },
  )
  const success = store.importDocuments({
    ...next,
    expectedRevisions: { workspace: 2, preferences: 1, focus: 1 },
  })
  assert.equal(success.documents.workspace.revision, 3)
  assert.equal(success.documents.preferences.revision, 2)
  assert.equal(success.documents.focus.revision, 2)
  assert.deepEqual(success.documents.preferences.value.migratedBrowserIds, ['browser-two'])
})

test('atomic import rolls back all document writes if its final metadata insert fails', (t) => {
  const { store, db } = setup(t)
  const before = store.getState()
  db.exec(
    "CREATE TRIGGER reject_test_import BEFORE INSERT ON prts_imports BEGIN SELECT RAISE(ABORT,'injected import failure'); END",
  )
  assert.throws(
    () =>
      store.importDocuments({
        documents: {
          workspace: createInitialWorkspace(),
          preferences: {
            motionEnabled: true,
            assistant: { persona: 'prts', knowledge: 'all' },
            assistantMode: 'local',
          },
          focus: { remaining: 1500, endAt: null, sessionId: null },
        },
        expectedRevisions: { workspace: 0, preferences: 0, focus: 0 },
        mutationId: 'failing-import',
      }),
    /injected import failure/,
  )
  assert.deepEqual(store.getState(), before)
})

test('chat append is idempotent and paginates old messages without deleting history', (t) => {
  const { store } = setup(t)
  const values = Array.from({ length: 75 }, (_, i) => message(`message-${i}`))
  store.appendMessages(values)
  store.appendMessages(values)
  const latest = store.listMessages({ limit: 60 })
  assert.equal(latest.messages.length, 60)
  assert.equal(latest.messages[0].id, 'message-15')
  assert.equal(latest.messages[59].id, 'message-74')
  assert.equal(latest.hasMore, true)
  const earlier = store.listMessages({ limit: 60, before: latest.nextCursor })
  assert.equal(earlier.messages.length, 15)
  assert.equal(earlier.hasMore, false)
  assert.throws(() => store.appendMessages([message('message-0', 'changed')]), { status: 409 })
  assert.throws(() => store.appendMessages([{ ...message('pending'), pending: true }]), {
    status: 400,
  })
  store.deleteMessages()
  assert.equal(store.listMessages().messages.length, 0)
})

test('persona histories infer legacy pairs, paginate independently and clear only the chosen scope', (t) => {
  const { store } = setup(t)
  const ai = (id, role, persona) => ({
    id,
    role,
    content: id,
    mode: 'ai',
    ...(persona ? { persona } : {}),
  })
  const old = [ai('old-u', 'user'), ai('old-a', 'assistant', 'amiya')]
  store.appendMessages([
    message('local'),
    ...old,
    ai('prts-u', 'user'),
    ai('prts-a', 'assistant'),
    ai('amiya-u', 'user', 'amiya'),
    ai('amiya-a', 'assistant', 'amiya'),
    ai('kal-u', 'user', 'kaltsit'),
    ai('kal-a', 'assistant', 'kaltsit'),
  ])
  const latest = store.listMessages({ mode: 'ai', persona: 'amiya', limit: 2 })
  assert.deepEqual(
    latest.messages.map((m) => m.id),
    ['amiya-u', 'amiya-a'],
  )
  assert.equal(latest.hasMore, true)
  const earlier = store.listMessages({
    mode: 'ai',
    persona: 'amiya',
    before: latest.nextCursor,
    limit: 2,
  })
  assert.deepEqual(
    earlier.messages,
    old.map((m) => ({ ...m, persona: 'amiya' })),
  )
  assert.equal(earlier.hasMore, false)
  // Reading legacy rows must not rewrite them and break idempotent append retries.
  assert.deepEqual(store.appendMessages(old), { saved: 2 })
  assert.throws(() => store.listMessages({ mode: 'ai', persona: 'amiya', before: 'kal-u' }), {
    status: 404,
  })
  assert.throws(() => store.listMessages({ mode: 'local', persona: 'amiya' }), { status: 400 })
  assert.throws(() => store.deleteMessages({ mode: 'ai', persona: 'invalid' }), { status: 400 })
  store.deleteMessages({ mode: 'ai', persona: 'amiya' })
  assert.deepEqual(
    store.listMessages().messages.map((m) => m.id),
    ['local', 'prts-u', 'prts-a', 'kal-u', 'kal-a'],
  )
  assert.deepEqual(
    store.listMessages({ mode: 'ai', persona: 'prts' }).messages.map((m) => m.id),
    ['prts-u', 'prts-a'],
  )
})

test('focus completion updates count once, atomically, and cannot complete before the deadline', (t) => {
  let now = 1000
  const { store } = setup(t, { now: () => now })
  const workspace = createInitialWorkspace()
  store.putDocument('workspace', write(workspace))
  store.putDocument('focus', write({ remaining: 60, endAt: 2000, sessionId: 'focus-one' }))
  assert.throws(() => store.completeFocus('focus-one'), { status: 409 })
  now = 2001
  const completed = store.completeFocus('focus-one')
  assert.equal(completed.completed, true)
  assert.equal(completed.documents.workspace.value.focusSessions, workspace.focusSessions + 1)
  assert.equal(completed.documents.workspace.revision, 2)
  assert.equal(completed.documents.focus.value.endAt, null)
  assert.equal(completed.documents.focus.value.remaining, 0)
  assert.equal(store.completeFocus('focus-one').completed, false)
  assert.equal(
    store.getState().documents.workspace.value.focusSessions,
    workspace.focusSessions + 1,
  )
  assert.equal(store.completeFocus('unknown-session').completed, false)
})

async function route(store, url, method = 'GET', payload, headers = {}) {
  const request = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))])
  Object.assign(request, {
    url,
    method,
    headers: { 'content-type': 'application/json', ...headers },
  })
  const response = {
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }
  const handled = await storageRoute(
    request,
    response,
    new URL(url, 'http://localhost').pathname,
    store,
  )
  return { ...response, handled }
}

test('storage HTTP routes enforce methods, media types, state validation and safe file responses', async (t) => {
  const { store } = setup(t)
  assert.deepEqual(JSON.parse((await route(store, '/api/state')).body), {
    documents: { workspace: null, preferences: null, focus: null },
  })
  await assert.rejects(() => route(store, '/api/state', 'DELETE'), { status: 405 })
  await assert.rejects(
    () => route(store, '/api/state/workspace', 'PUT', write({}), { 'content-type': 'text/plain' }),
    { status: 415 },
  )
  await assert.rejects(() => route(store, '/api/state/workspace', 'PUT', write({})), {
    status: 400,
  })
  const saved = await route(store, '/api/state/workspace', 'PUT', write(createInitialWorkspace()))
  assert.equal(saved.status, 200)
  assert.equal(saved.headers['cache-control'], 'no-store')
  assert.equal(JSON.parse(saved.body).revision, 1)
  await route(store, '/api/files', 'POST', {
    files: [{ ...file('svg-file', '<svg/>', '不执行.svg'), type: 'image/svg+xml' }],
  })
  const download = await route(store, '/api/files/svg-file/content?inline=1')
  assert.equal(download.headers['content-type'], 'application/octet-stream')
  assert.match(download.headers['content-disposition'], /^attachment;/)
  assert.equal(download.headers['x-content-type-options'], 'nosniff')
  assert.deepEqual(download.body, Buffer.from('<svg/>'))
  const head = await route(store, '/api/files/svg-file/content', 'HEAD')
  assert.equal(head.body, undefined)
  assert.equal(head.headers['content-length'], 6)
  assert.equal((await route(store, '/api/unrelated')).handled, false)
})

test('automatic confirmation is an optional persisted boolean and older clients cannot erase it', (t) => {
  const { db, uploadsDir, store } = setup(t)
  const legacy = {
    motionEnabled: true,
    assistant: { persona: 'amiya', knowledge: 'none' },
    assistantMode: 'ai',
  }
  store.putDocument('preferences', write(legacy))
  assert.equal(store.getDocument('preferences').value.assistantAutoConfirm, undefined)
  assert.throws(
    () => store.putDocument('preferences', write({ ...legacy, assistantAutoConfirm: 'true' }, 1)),
    { status: 400 },
  )
  store.putDocument('preferences', write({ ...legacy, assistantAutoConfirm: true }, 1))
  const reopened = createStorage(db, { uploadsDir })
  assert.equal(reopened.getDocument('preferences').value.assistantAutoConfirm, true)
  reopened.putDocument('preferences', write(legacy, 2))
  assert.equal(reopened.getDocument('preferences').value.assistantAutoConfirm, true)
  reopened.putDocument('preferences', write({ ...legacy, assistantAutoConfirm: false }, 3))
  assert.equal(reopened.getDocument('preferences').value.assistantAutoConfirm, false)
})
