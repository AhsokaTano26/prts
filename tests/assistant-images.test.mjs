import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatabase } from '../server/database.mjs'
import { createStorage } from '../server/storage.mjs'
import { createWorkspaceTools } from '../server/assistant-tools.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
  'base64',
)
function setup(t) {
  const database = createDatabase()
  const storage = createStorage(database)
  t.after(() => {
    storage.close()
    database.close()
  })
  storage.putDocument('workspace', {
    value: createInitialWorkspace(),
    expectedRevision: 0,
    mutationId: crypto.randomUUID(),
  })
  const tools = createWorkspaceTools(database, storage)
  const session = tools.session()
  const upload = (id, bytes = png, type = 'image/png', name = `${id}.png`) =>
    storage.putFiles([
      {
        id,
        name,
        type,
        size: bytes.length,
        createdAt: new Date().toISOString(),
        data: bytes.toString('base64'),
      },
    ])
  const read = (id, extra = {}) =>
    session.execute('read_workspace_item', JSON.stringify({ kind: 'file', id, ...extra }))
  return { tools, session, storage, upload, read }
}

test('workspace image input uses actual bytes rather than the uploaded MIME label', (t) => {
  const { upload, read } = setup(t)
  upload('mislabelled', png, 'application/octet-stream')
  const result = read('mislabelled')
  assert.equal(result.error, undefined)
  assert.equal(result.type, 'image/png')
  assert.equal(result.imageAttached, true)
  assert.equal(result.imageUrl, `data:image/png;base64,${png.toString('base64')}`)
  assert.match(read('mislabelled', { offset: 1 }).error, /分页/)
})

test('image reads reject unsupported formats, forged image labels and unknown file IDs', (t) => {
  const { upload, read } = setup(t)
  upload('fake', Buffer.from('not an image'))
  upload(
    'vector',
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    'image/svg+xml',
    'vector.svg',
  )
  for (const id of ['fake', 'vector', '../../.env', 'missing']) {
    const result = read(id)
    assert.ok(result.error, id)
    assert.equal(result.imageUrl, undefined)
  }
})

test('image input allows 5 MB but rejects larger files without encoding them', (t) => {
  const { upload, read } = setup(t)
  const bytes = Buffer.alloc(5 * 1024 * 1024)
  png.copy(bytes)
  upload('limit-image', bytes)
  const result = read('limit-image')
  assert.equal(result.error, undefined)
  assert.equal(Buffer.from(result.imageUrl.split(',')[1], 'base64').length, bytes.length)
  upload('large-image', Buffer.concat([bytes, Buffer.from([0])]))
  const rejected = read('large-image')
  assert.match(rejected.error, /5 MB/)
  assert.equal(rejected.imageUrl, undefined)
})

test('one reply can load four distinct images and repeat reads do not consume the budget', (t) => {
  const { tools, upload, read } = setup(t)
  for (let i = 0; i < 5; i++) upload(`image-${i}`)
  for (let i = 0; i < 4; i++) {
    assert.equal(read(`image-${i}`).error, undefined)
    assert.equal(read('image-0').error, undefined)
  }
  const rejected = read('image-4')
  assert.match(rejected.error, /4/)
  assert.equal(rejected.imageUrl, undefined)
  const nextReply = tools
    .session()
    .execute('read_workspace_item', JSON.stringify({ kind: 'file', id: 'image-4' }))
  assert.equal(nextReply.error, undefined)
})
