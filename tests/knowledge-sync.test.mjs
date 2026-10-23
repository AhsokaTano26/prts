import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { gzipSync } from 'node:zlib'
import { createServer } from '../server/index.mjs'
import { createCorpus } from '../server/corpus.mjs'

const PASSWORD = 'knowledge-sync-test-password'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prts-sync-api-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

// A tiny real corpus exercises activation and cache replacement without network access.
async function stage(root, releaseId, title) {
  const dataVersion = digest(Buffer.from(releaseId))
  const directory = path.join(root, 'releases', releaseId, 'official_game')
  const document = { document_id: 'amiya', display_title: title, character_name: '阿米娅' }
  const record = { document, lines: [{ line_number: 1, text: `${title}：阿米娅负责罗德岛事务。` }] }
  async function packed(relative, plain, extra = {}) {
    const bytes = gzipSync(plain)
    await mkdir(path.dirname(path.join(directory, relative)), { recursive: true })
    await writeFile(path.join(directory, relative), bytes)
    return {
      path: relative,
      compressed_size: bytes.length,
      uncompressed_size: plain.length,
      sha256: digest(bytes),
      ...extra,
    }
  }
  const shard = await packed('shards/00000.jsonl.gz', Buffer.from(JSON.stringify(record)), {
    document_count: 1,
  })
  const catalog = await packed(
    'catalog/documents.jsonl.gz',
    Buffer.from(
      JSON.stringify({ document, search_index_id: 1, record_index: 0, shard_path: shard.path }),
    ),
  )
  const emptyIndex = Buffer.alloc(16)
  emptyIndex.write('PRTSNG2\0', 'ascii')
  const index = await packed('search-index/00000.bin.gz', emptyIndex, {
    first_ngram: '',
    last_ngram: '\uffff',
  })
  await writeFile(
    path.join(directory, 'pack-manifest.json'),
    JSON.stringify({
      document_count: 1,
      document_catalog: catalog,
      shards: [shard],
      search_index: { shards: [index] },
    }),
  )
  await writeFile(
    path.join(root, 'releases', releaseId, 'release-manifest.json'),
    JSON.stringify({
      release_id: releaseId,
      data_version: dataVersion,
      document_count: 1,
      packs: [{ pack_id: 'official_game' }],
    }),
  )
  return { root, releaseId, dataVersion }
}

async function activate(identity) {
  await writeFile(
    path.join(identity.root, 'current.json'),
    JSON.stringify({ release_id: identity.releaseId, data_version: identity.dataVersion }),
  )
}

function report(identity) {
  return {
    release_id: identity.releaseId,
    data_version: identity.dataVersion,
    file_count: 4,
    verified_bytes: 1200,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function client(t, options) {
  const server = createServer({ env: { PRTS_PASSWORD: PASSWORD }, ...options })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  await login.json()
  return {
    base,
    get: (pathname = '/api/knowledge/sync') => fetch(`${base}${pathname}`, { headers: { cookie } }),
    post: (payload, headers = {}) =>
      fetch(`${base}/api/knowledge/sync`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      }),
    request: (method) => fetch(`${base}/api/knowledge/sync`, { method, headers: { cookie } }),
  }
}

async function terminal(client) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await (await client.get()).json()
    if (state.state !== 'running') return state
    await delay(5)
  }
  assert.fail('Background synchronization did not finish')
}

test('sync API authenticates, checks Origin, validates mode and never starts from GET', async (t) => {
  let invoked = 0
  const app = await client(t, {
    corpusDir: await workspace(t),
    syncCorpus: async () => {
      invoked += 1
    },
  })
  assert.equal((await fetch(`${app.base}/api/knowledge/sync`)).status, 401)
  assert.equal(
    (
      await fetch(`${app.base}/api/knowledge/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: app.base },
        body: JSON.stringify({ mode: 'install' }),
      })
    ).status,
    401,
  )
  assert.equal(
    (await app.post({ mode: 'update' }, { origin: 'https://foreign.example' })).status,
    403,
  )
  assert.equal((await app.request('PUT')).status, 405)
  for (const value of [{}, null, [], { mode: 'other' }, { mode: 1 }])
    assert.equal((await app.post(value)).status, 400)
  for (let i = 0; i < 3; i += 1) {
    const response = await app.get()
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      state: 'idle',
      phase: null,
      completedFiles: 0,
      totalFiles: 0,
      completedBytes: 0,
      totalBytes: 0,
      release: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
    })
  }
  assert.equal(invoked, 0)
})

test('install runs once across repeated requests and listeners, reports progress and becomes searchable without restart', async (t) => {
  const root = await workspace(t)
  const gate = deferred()
  t.after(() => gate.resolve())
  let invocations = 0
  const syncCorpus = async ({ root: directory, onProgress, beforeActivate }) => {
    invocations += 1
    assert.equal(directory, root)
    onProgress({
      phase: 'downloading',
      completedFiles: 2,
      totalFiles: 4,
      completedBytes: 600,
      totalBytes: 1200,
      release: 'installed-v1',
    })
    await gate.promise
    const next = await stage(root, 'installed-v1', '阿米娅 / 首次安装')
    await beforeActivate(next)
    await activate(next)
    return report(next)
  }
  const app = await client(t, { corpusDir: root, syncCorpus })
  const other = await client(t, { corpusDir: root, syncCorpus })
  const response = await app.post({ mode: 'install' }, { origin: app.base })
  assert.equal(response.status, 202)
  const initial = await response.json()
  assert.equal(initial.state, 'running')
  assert.ok(initial.startedAt)
  for (const current of [app, other, app]) {
    const repeat = await current.post({ mode: 'install' })
    assert.equal(repeat.status, 202)
    assert.equal((await repeat.json()).startedAt, initial.startedAt)
  }
  const progress = await (await other.get()).json()
  assert.equal(progress.phase, 'downloading')
  assert.equal(progress.completedFiles, 2)
  assert.equal(progress.completedBytes, 600)
  assert.equal(invocations, 1)
  gate.resolve()
  const done = await terminal(other)
  assert.equal(done.state, 'succeeded')
  assert.equal(done.result, 'installed')
  assert.equal(done.completedFiles, 4)
  assert.equal(done.completedBytes, 1200)
  assert.ok(done.finishedAt)
  assert.equal((await (await app.get('/api/knowledge')).json()).ready, true)
  const search = await (
    await app.get(`/api/knowledge/search?q=${encodeURIComponent('阿米娅')}`)
  ).json()
  assert.equal(search.results[0].title, '阿米娅 / 首次安装')
  const restored = createCorpus({ directory: root })
  assert.equal((await restored.status()).release, 'installed-v1')
  assert.equal((await restored.search('阿米娅')).results[0].title, '阿米娅 / 首次安装')
})

test('installed corpus rejects install, updates atomically and reports current on a verified same-version run', async (t) => {
  const root = await workspace(t)
  await activate(await stage(root, 'old-v1', '阿米娅 / 旧版本'))
  const gate = deferred()
  t.after(() => gate.resolve())
  let invocations = 0
  const app = await client(t, {
    corpusDir: root,
    syncCorpus: async ({ beforeActivate }) => {
      invocations += 1
      await gate.promise
      const next = await stage(root, 'new-v2', '阿米娅 / 新版本')
      await beforeActivate(next)
      await activate(next)
      return report(next)
    },
  })
  assert.equal((await app.post({ mode: 'install' })).status, 409)
  assert.equal(invocations, 0)
  assert.equal((await app.post({ mode: 'update' })).status, 202)
  assert.equal((await (await app.get('/api/knowledge')).json()).release, 'old-v1')
  gate.resolve()
  assert.equal((await terminal(app)).result, 'updated')
  assert.equal((await (await app.get('/api/knowledge')).json()).release, 'new-v2')
  const search = await (
    await app.get(`/api/knowledge/search?q=${encodeURIComponent('阿米娅')}`)
  ).json()
  assert.equal(search.results[0].title, '阿米娅 / 新版本')
  assert.equal((await app.post({ mode: 'update' })).status, 202)
  assert.equal((await terminal(app)).result, 'current')
  assert.equal(invocations, 2)
})

test('failed background work sanitizes errors and preserves the old active corpus', async (t) => {
  const root = await workspace(t)
  await activate(await stage(root, 'working-v1', '阿米娅 / 可用版本'))
  const app = await client(t, {
    corpusDir: root,
    syncCorpus: async () => {
      throw new Error('secret-token /Users/private-data curl stderr')
    },
  })
  assert.equal((await app.post({ mode: 'update' })).status, 202)
  const failed = await terminal(app)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.result, null)
  assert.ok(failed.error)
  assert.doesNotMatch(failed.error, /secret-token|Users|stderr/)
  assert.equal((await (await app.get('/api/knowledge')).json()).release, 'working-v1')
  assert.equal(JSON.parse(await readFile(path.join(root, 'current.json'))).release_id, 'working-v1')
})

test('activation validates a candidate before publishing and leaves old data available on malformed releases', async (t) => {
  const root = await workspace(t)
  await activate(await stage(root, 'valid-v1', '阿米娅 / 正常版本'))
  const app = await client(t, {
    corpusDir: root,
    syncCorpus: async ({ beforeActivate }) => {
      const next = await stage(root, 'broken-v2', '阿米娅 / 无效版本')
      await writeFile(
        path.join(root, 'releases', 'broken-v2', 'official_game', 'catalog/documents.jsonl.gz'),
        'broken catalog',
      )
      await beforeActivate(next)
      await activate(next)
      return report(next)
    },
  })
  assert.equal((await app.post({ mode: 'update' })).status, 202)
  assert.equal((await terminal(app)).state, 'failed')
  assert.equal(JSON.parse(await readFile(path.join(root, 'current.json'))).release_id, 'valid-v1')
  assert.equal((await (await app.get('/api/knowledge')).json()).release, 'valid-v1')
})

test('a failed first install can be retried and clears the previous error on success', async (t) => {
  const root = await workspace(t)
  let fail = true
  const app = await client(t, {
    corpusDir: root,
    syncCorpus: async ({ beforeActivate }) => {
      if (fail) throw new Error('temporary connection failure')
      const next = await stage(root, 'recovered-v1', '阿米娅 / 恢复安装')
      await beforeActivate(next)
      await activate(next)
      return report(next)
    },
  })
  assert.equal((await app.post({ mode: 'install' })).status, 202)
  assert.equal((await terminal(app)).state, 'failed')
  assert.equal((await (await app.get('/api/knowledge')).json()).ready, false)
  fail = false
  assert.equal((await app.post({ mode: 'install' })).status, 202)
  const recovered = await terminal(app)
  assert.equal(recovered.state, 'succeeded')
  assert.equal(recovered.result, 'installed')
  assert.equal(recovered.error, null)
  assert.equal((await createCorpus({ directory: root }).status()).ready, true)
})
