import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatabase } from '../server/database.mjs'
import { createStorage } from '../server/storage.mjs'
import { createWorkspaceTools } from '../server/assistant-tools.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'

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
  const session = createWorkspaceTools(database, storage).session()
  const upload = (id, text) =>
    storage.putFiles([
      {
        id,
        name: `${id}.txt`,
        type: 'text/plain',
        size: Buffer.byteLength(text),
        createdAt: new Date().toISOString(),
        data: Buffer.from(text).toString('base64'),
      },
    ])
  const read = (id, offset, limit) =>
    session.execute('read_workspace_item', JSON.stringify({ kind: 'file', id, offset, limit }))
  return { session, upload, read }
}

test('AI can read 3 MB and exactly 5 MB UTF-8 attachments through the final page', (t) => {
  const { upload, read } = setup(t)
  for (const size of [3 * 1024 * 1024, 5 * 1024 * 1024]) {
    const suffix = '文件末尾-END'
    const text = 'a'.repeat(size - Buffer.byteLength(suffix)) + suffix
    const id = `text-${size}`
    upload(id, text)
    const first = read(id, 0, 16)
    assert.equal(first.error, undefined)
    assert.equal(first.content, 'a'.repeat(16))
    assert.equal(first.totalCharacters, text.length)
    assert.equal(first.hasMore, true)
    const middle = read(id, 1_000_001, 13)
    assert.equal(middle.error, undefined)
    assert.equal(middle.content, 'a'.repeat(13))
    const last = read(id, text.length - suffix.length, suffix.length)
    assert.equal(last.error, undefined)
    assert.equal(last.content, suffix)
    assert.equal(last.hasMore, false)
    const end = read(id, text.length, 1)
    assert.equal(end.content, '')
    assert.equal(end.hasMore, false)
    assert.match(read(id, 0, 8001).error, /分页参数无效/)
  }
})

test('AI rejects an attachment one byte above 5 MB while retaining its searchable metadata', (t) => {
  const { session, upload, read } = setup(t)
  const size = 5 * 1024 * 1024 + 1
  upload('oversized-text', 'a'.repeat(size))
  const metadata = session.execute(
    'search_workspace',
    JSON.stringify({ kind: 'files', query: 'oversized-text' }),
  )
  assert.equal(metadata.results[0].size, size)
  assert.match(read('oversized-text', 0, 100).error, /超过 5 MB/)
})
