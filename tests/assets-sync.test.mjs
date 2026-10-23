import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { AMIYA, syncAssets } from '../scripts/sync-corpus-images.mjs'
import { knowledgeManager } from '../server/knowledge.mjs'
import {
  assetManager,
  assetStatus,
  getAsset,
  loadResourceSyncState,
  saveResourceSyncState,
} from '../server/resources.mjs'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1cAAAAASUVORK5CYII=',
  'base64',
)
const COMMIT = 'a'.repeat(40)
const AMIYA_BYTES = await readFile(new URL('../public/assets/amiya.png', import.meta.url))

function descriptor(id = 'tiny') {
  const assetPath = `assets/beyond/dynamicassets/gameplay/ui/sprites/reading/${id}.png`
  return {
    id,
    path: assetPath,
    size: PNG.length,
    gitBlobSha1: createHash('sha1').update(`blob ${PNG.length}\0`).update(PNG).digest('hex'),
    downloadUrl: `https://raw.githubusercontent.com/555me/EndfieldAssets/${COMMIT}/${assetPath}`,
  }
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-image-sync-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sourceFile = path.join(root, 'sources.json')
  const source = { upstream: { commit: COMMIT }, assets: [descriptor()] }
  await writeFile(sourceFile, JSON.stringify(source))
  const directory = path.join(root, 'data/assets')
  return { root, sourceFile, source, directory, filename: path.join(root, 'prts.sqlite') }
}

function transport(url) {
  return Promise.resolve(url === AMIYA.downloadUrl ? AMIYA_BYTES : PNG)
}
async function terminal(manager) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await manager.status()
    if (state.state !== 'running') return state
    await delay(5)
  }
  assert.fail('Image job did not complete')
}

test('empty deployment does not download assets until an explicit start, and repeat starts share one job', async (t) => {
  const files = await fixture(t)
  const database = new DatabaseSync(files.filename)
  t.after(() => database.close())
  let invoked = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  t.after(() => release())
  const manager = assetManager({
    database,
    directory: files.directory,
    synchronize: async (options) => {
      invoked += 1
      await gate
      return syncAssets({ ...options, sourceFile: files.sourceFile, transport })
    },
  })
  assert.equal((await manager.status()).ready, false)
  assert.equal((await manager.status()).state, 'idle')
  assert.equal(invoked, 0)
  await assert.rejects(stat(files.directory), { code: 'ENOENT' })
  assert.equal(await getAsset(files.directory, '/assets/amiya.png'), null)
  const initial = await manager.start('install')
  const duplicate = await manager.start('install')
  assert.equal(initial.state, 'running')
  assert.equal(initial.startedAt, duplicate.startedAt)
  release()
  const done = await terminal(manager)
  assert.equal(invoked, 1)
  assert.equal(done.state, 'succeeded')
  assert.equal(done.result, 'installed')
  assert.equal(done.ready, true)
  assert.equal(done.availableFiles, 2)
  const asset = await getAsset(files.directory, '/assets/corpus-images/reading/tiny.png')
  assert.deepEqual(await readFile(asset.file), PNG)
  assert.equal(asset.mime, 'image/png')
  assert.equal(asset.size, PNG.length)
  assert.deepEqual(
    await readFile((await getAsset(files.directory, '/assets/amiya.png')).file),
    AMIYA_BYTES,
  )
  const columns = database.prepare('PRAGMA table_info(resource_sync_state)').all()
  assert.ok(columns.every((column) => column.type !== 'BLOB'))
  assert.equal(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('resource_blobs','static_assets','corpus_resources')",
      )
      .all().length,
    0,
  )
  await assert.rejects(manager.start('install'), (error) => error.status === 409)
})

test('update reuses verified files without network and keeps paths under the selected data directory', async (t) => {
  const files = await fixture(t)
  const first = await syncAssets({ ...files, transport, log() {} })
  assert.equal(first.downloaded, 2)
  const second = await syncAssets({
    ...files,
    transport: () => {
      throw new Error('Network must not be used')
    },
    log() {},
  })
  assert.equal(second.downloaded, 0)
  assert.equal(second.reused, 2)
  assert.equal((await assetStatus(files.directory)).ready, true)
  assert.equal(await getAsset(files.directory, '/assets/../secret.png'), null)
  assert.equal(await getAsset(files.directory, '/assets/assets-manifest.json'), null)
  await writeFile(path.join(files.root, 'secret.png'), PNG)
  await symlink(path.join(files.root, 'secret.png'), path.join(files.directory, 'outside.png'))
  assert.equal(await getAsset(files.directory, '/assets/outside.png'), null)
})

test('a mismatched new download fails without replacing valid existing images or the active manifest', async (t) => {
  const files = await fixture(t)
  await syncAssets({ ...files, transport, log() {} })
  const before = await readFile(path.join(files.directory, 'assets-manifest.json'))
  files.source.assets.push(descriptor('second'))
  await writeFile(files.sourceFile, JSON.stringify(files.source))
  const database = new DatabaseSync(files.filename)
  t.after(() => database.close())
  const manager = assetManager({
    database,
    directory: files.directory,
    synchronize: (options) =>
      syncAssets({
        ...options,
        sourceFile: files.sourceFile,
        transport: async () => Buffer.alloc(PNG.length),
      }),
  })
  await manager.start('update')
  const done = await terminal(manager)
  assert.equal(done.state, 'failed')
  assert.equal(done.ready, true)
  assert.match(done.error, /有效图片仍可使用/)
  assert.deepEqual(await readFile(path.join(files.directory, 'assets-manifest.json')), before)
  assert.deepEqual(
    await readFile(path.join(files.directory, 'corpus-images/reading/tiny.png')),
    PNG,
  )
  await assert.rejects(stat(path.join(files.directory, 'corpus-images/reading/second.png')), {
    code: 'ENOENT',
  })
  assert.equal(loadResourceSyncState(database, `assets:${files.directory}`).state, 'failed')
})

test('job status survives restart and an interrupted job becomes a retryable failure', async (t) => {
  const files = await fixture(t)
  let database = new DatabaseSync(files.filename)
  saveResourceSyncState(database, `assets:${files.directory}`, {
    state: 'running',
    phase: 'downloading',
    completedFiles: 1,
    totalFiles: 2,
  })
  database.close()
  database = new DatabaseSync(files.filename)
  t.after(() => database.close())
  const manager = assetManager({
    database,
    directory: files.directory,
    synchronize: (options) => syncAssets({ ...options, sourceFile: files.sourceFile, transport }),
  })
  assert.equal((await manager.status()).state, 'failed')
  assert.match((await manager.status()).error, /中断/)
  await manager.start('install')
  assert.equal((await terminal(manager)).state, 'succeeded')
})

test('empty corpus stays on disk and persisted interrupted progress is recovered without automatic download', async (t) => {
  const files = await fixture(t)
  const database = new DatabaseSync(files.filename)
  t.after(() => database.close())
  const directory = path.join(files.root, 'data/corpus')
  saveResourceSyncState(database, `corpus:${directory}`, { state: 'running', phase: 'downloading' })
  let invoked = 0
  const manager = knowledgeManager({
    database,
    directory,
    synchronize: async () => {
      invoked += 1
    },
  })
  assert.equal(manager.status().state, 'failed')
  assert.match(manager.status().error, /中断/)
  assert.equal((await manager.corpus.status()).ready, false)
  assert.equal(invoked, 0)
  await assert.rejects(stat(directory), { code: 'ENOENT' })
  assert.equal(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('resource_blobs', 'corpus_resources')",
      )
      .all().length,
    0,
  )
})
