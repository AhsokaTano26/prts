import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  symlink,
  readdir,
  realpath,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { test } from 'node:test'
import { digest, packAssets, safePath, syncCorpus } from '../scripts/sync-corpus.mjs'

const API = 'https://prts.chat/api/agent/data/releases'
const PACKS = [
  'official_game',
  'endfield_official_game',
  'endfield_reviewed_knowledge',
  'reviewed_wiki',
  'terra_journey',
  'entities',
  'references',
]
const GROUPS = {
  arknights: ['official_game', 'reviewed_wiki', 'terra_journey', 'entities', 'references'],
  endfield: ['endfield_official_game', 'endfield_reviewed_knowledge'],
}
const RELEASE_ID = 'test-approved-release'
const DATA_VERSION = digest(Buffer.from(RELEASE_ID))
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n')

function fixture() {
  const routes = new Map()
  const files = new Map()
  const summaries = []
  const gzipPaths = []
  for (const packId of PACKS) {
    const prefix = `releases/${RELEASE_ID}/${packId}/`
    const asset = (relative) => {
      const bytes = gzipSync(Buffer.from(`${packId}:${relative}\n`))
      files.set(prefix + relative, bytes)
      gzipPaths.push(prefix + relative)
      return { path: relative, compressed_size: bytes.length, sha256: digest(bytes) }
    }
    const manifest = {
      data_version: digest(Buffer.from(packId)),
      document_catalog: asset('catalog/documents.jsonl.gz'),
      shards: [asset('shards/00000.jsonl.gz')],
      search_index: { shards: [asset('search-index/00000.bin.gz')] },
    }
    if (packId === 'endfield_official_game') {
      manifest.localization = {
        catalog: asset('localization/catalog.jsonl.gz'),
        languages: { CN: asset('localization/CN.jsonl.gz'), EN: asset('localization/EN.jsonl.gz') },
      }
    }
    const assets = packAssets(manifest)
    summaries.push({
      pack_id: packId,
      data_version: manifest.data_version,
      shard_count: assets.size,
      compressed_size: [...assets.values()].reduce((sum, entry) => sum + entry.size, 0),
      document_count: 1,
      line_count: 1,
    })
    const bytes = json(manifest)
    files.set(prefix + 'pack-manifest.json', bytes)
    routes.set(`${API}/${RELEASE_ID}/${packId}/pack-manifest.json`, bytes)
  }
  const release = {
    release_id: RELEASE_ID,
    data_version: DATA_VERSION,
    distribution_status: 'published',
    required_packs: PACKS,
    publication: { approved_pack_ids: PACKS },
    packs: summaries,
    compressed_size: summaries.reduce((sum, entry) => sum + entry.compressed_size, 0),
    document_count: 7,
    line_count: 7,
  }
  routes.set(
    `${API}/current`,
    json({ code: 200, data: { ...release, shard_count: gzipPaths.length } }),
  )
  routes.set(`${API}/${RELEASE_ID}/release-manifest.json`, json(release))
  for (const [group, packIds] of Object.entries(GROUPS)) {
    const base = `https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-${group}/resolve/master/`
    const descriptors = {}
    for (const [relative, bytes] of files) {
      if (!packIds.includes(relative.split('/')[2])) continue
      descriptors[relative] = { size: bytes.length, sha256: digest(bytes) }
      routes.set(base + relative, bytes)
    }
    routes.set(
      `${base}releases/${RELEASE_ID}/dataset-manifest.json`,
      json({
        release_id: RELEASE_ID,
        data_version: DATA_VERSION,
        pack_ids: packIds,
        file_count: Object.keys(descriptors).length,
        files: descriptors,
      }),
    )
    routes.set(`${base}README.md`, Buffer.from('---\nlicense: other\n---\nUpstream source.\n'))
  }
  const requests = []
  return {
    files,
    gzipPaths,
    routes,
    requests,
    async transport(url) {
      requests.push(url)
      assert.ok(routes.has(url), `Unexpected download URL: ${url}`)
      return routes.get(url)
    },
  }
}

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prts-corpus-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('sync verifies every approved resource, retains gzip bytes and reuses valid local files', async (t) => {
  const directory = await workspace(t)
  const root = path.join(directory, 'corpus')
  const source = fixture()
  const first = await syncCorpus({ root, transport: source.transport, log() {} })
  assert.equal(first.file_count, source.files.size)
  assert.equal(first.gzip_file_count, source.gzipPaths.length)
  assert.equal(first.downloaded, source.gzipPaths.length)
  for (const [relative, bytes] of source.files)
    assert.deepEqual(await readFile(path.join(root, relative)), bytes)
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'current.json'), 'utf8')), {
    release_id: RELEASE_ID,
    data_version: DATA_VERSION,
  })
  assert.match(
    await readFile(
      path.join(root, 'releases', RELEASE_ID, 'sources', 'endfield', 'README.md'),
      'utf8',
    ),
    /license: other/,
  )
  source.requests.length = 0
  const second = await syncCorpus({ root, transport: source.transport, log() {} })
  assert.equal(second.downloaded, 0)
  assert.equal(second.reused, source.files.size)
  assert.equal(source.requests.filter((url) => url.endsWith('.gz')).length, 0)
})

test('progress reports complete monotonic verified-file snapshots including pack manifests', async (t) => {
  const root = await workspace(t)
  const source = fixture()
  const snapshots = []
  const report = await syncCorpus({
    root,
    transport: source.transport,
    log() {},
    onProgress: (snapshot) => snapshots.push(snapshot),
  })
  assert.ok(snapshots.length >= source.files.size + 3)
  assert.deepEqual(snapshots[0], {
    phase: 'checking',
    completedFiles: 0,
    totalFiles: 0,
    completedBytes: 0,
    totalBytes: 0,
    release: null,
  })
  const expectedKeys = [
    'phase',
    'completedFiles',
    'totalFiles',
    'completedBytes',
    'totalBytes',
    'release',
  ].sort()
  let previous = snapshots[0]
  const verifiedCounts = new Set()
  for (const snapshot of snapshots) {
    assert.deepEqual(Object.keys(snapshot).sort(), expectedKeys)
    assert.ok(['checking', 'downloading', 'verifying', 'activating'].includes(snapshot.phase))
    assert.ok(snapshot.release === null || snapshot.release === RELEASE_ID)
    for (const key of ['completedFiles', 'totalFiles', 'completedBytes', 'totalBytes']) {
      assert.ok(Number.isSafeInteger(snapshot[key]) && snapshot[key] >= previous[key], key)
    }
    assert.ok(snapshot.completedFiles <= snapshot.totalFiles)
    assert.ok(snapshot.completedBytes <= snapshot.totalBytes)
    verifiedCounts.add(snapshot.completedFiles)
    previous = snapshot
  }
  assert.equal(verifiedCounts.size, source.files.size + 1)
  assert.ok(snapshots.some((snapshot) => snapshot.phase === 'downloading'))
  assert.ok(snapshots.some((snapshot) => snapshot.phase === 'verifying'))
  assert.deepEqual(snapshots.at(-1), {
    phase: 'activating',
    completedFiles: source.files.size,
    totalFiles: source.files.size,
    completedBytes: report.verified_bytes,
    totalBytes: report.verified_bytes,
    release: RELEASE_ID,
  })
})

test('a fully reused corpus reports verifying without entering the downloading phase', async (t) => {
  const root = await workspace(t)
  const source = fixture()
  await syncCorpus({ root, transport: source.transport, log() {} })
  const snapshots = []
  await syncCorpus({
    root,
    transport: source.transport,
    log() {},
    onProgress: (snapshot) => snapshots.push(snapshot),
  })
  assert.ok(
    snapshots.some((snapshot) => snapshot.phase === 'verifying' && snapshot.completedFiles > 0),
  )
  assert.equal(
    snapshots.some((snapshot) => snapshot.phase === 'downloading'),
    false,
  )
  assert.equal(snapshots.at(-1)?.completedFiles, source.files.size)
})

test('beforeActivate runs after all files verify and its async failure preserves the previous pointer', async (t) => {
  const root = await workspace(t)
  const source = fixture()
  const previous = json({ release_id: 'previous-release', data_version: 'previous-version' })
  await writeFile(path.join(root, 'current.json'), previous)
  let calls = 0
  const snapshots = []
  await assert.rejects(
    syncCorpus({
      root,
      transport: source.transport,
      log() {},
      onProgress: (snapshot) => snapshots.push(snapshot),
      async beforeActivate(candidate) {
        calls += 1
        assert.deepEqual(candidate, {
          root: await realpath(root),
          releaseId: RELEASE_ID,
          dataVersion: DATA_VERSION,
        })
        assert.equal(snapshots.at(-1).completedFiles, source.files.size)
        for (const [relative, bytes] of source.files)
          assert.deepEqual(await readFile(path.join(root, relative)), bytes)
        assert.deepEqual(await readFile(path.join(root, 'current.json')), previous)
        await Promise.resolve()
        throw new Error('Candidate schema rejected')
      },
    }),
    /Candidate schema rejected/,
  )
  assert.equal(calls, 1)
  assert.deepEqual(await readFile(path.join(root, 'current.json')), previous)
  assert.equal(
    snapshots.some((snapshot) => snapshot.phase === 'activating'),
    false,
  )
})

test('a local file with the right size and wrong SHA-256 is downloaded again', async (t) => {
  const root = await workspace(t)
  const source = fixture()
  await syncCorpus({ root, transport: source.transport, log() {} })
  const relative = source.gzipPaths[0]
  const damaged = Buffer.from(source.files.get(relative))
  damaged[damaged.length - 1] ^= 1
  await writeFile(path.join(root, relative), damaged)
  const report = await syncCorpus({ root, transport: source.transport, log() {} })
  assert.equal(report.downloaded, 1)
  assert.deepEqual(await readFile(path.join(root, relative)), source.files.get(relative))
})

test('same-size corrupt upstream data is rejected without publishing or replacing the current pointer', async (t) => {
  const root = await workspace(t)
  const source = fixture()
  const previous = json({ release_id: 'previous-release', data_version: 'previous-version' })
  await writeFile(path.join(root, 'current.json'), previous)
  const brokenPath = source.gzipPaths[0]
  const brokenUrl = [...source.routes.keys()].find((url) => url.endsWith(brokenPath))
  const damaged = Buffer.from(source.routes.get(brokenUrl))
  damaged[0] ^= 1
  source.routes.set(brokenUrl, damaged)
  await assert.rejects(
    syncCorpus({ root, transport: source.transport, log() {} }),
    /SHA-256 mismatch/,
  )
  assert.deepEqual(await readFile(path.join(root, 'current.json')), previous)
  await assert.rejects(readFile(path.join(root, brokenPath)), { code: 'ENOENT' })
  const members = await readdir(root, { recursive: true })
  assert.equal(
    members.some((name) => name.includes('.partial-')),
    false,
  )
})

test('a failed first download never creates a current pointer and can resume from verified files', async (t) => {
  const root = await workspace(t)
  const source = fixture()
  let accepted = 0
  await assert.rejects(
    syncCorpus({
      root,
      concurrency: 1,
      log() {},
      transport: async (url) => {
        if (url.endsWith('.gz') && ++accepted === 3) throw new Error('Simulated interruption')
        return source.transport(url)
      },
    }),
    /Simulated interruption/,
  )
  await assert.rejects(readFile(path.join(root, 'current.json')), { code: 'ENOENT' })
  const report = await syncCorpus({ root, transport: source.transport, log() {} })
  assert.equal(report.downloaded, source.gzipPaths.length - 2)
  assert.equal(report.reused, PACKS.length + 2)
})

test('unsafe manifest paths are rejected before accessing the filesystem', () => {
  for (const candidate of [
    '../escape.gz',
    '/absolute.gz',
    'a/../escape.gz',
    'a//b.gz',
    'a\\b.gz',
    'a/%2e%2e/b.gz',
    'a?b.gz',
    'https://bad.test/file.gz',
    'a\0b.gz',
  ]) {
    assert.throws(() => safePath(candidate), /Unsafe relative path/)
  }
  assert.equal(safePath('localization/CN.jsonl.gz'), 'localization/CN.jsonl.gz')
})

test('mirror descriptors must exactly match approved pack hashes before any gzip download', async (t) => {
  const root = await workspace(t)
  const source = fixture()
  const manifestUrl = [...source.routes.keys()].find((url) => url.endsWith('dataset-manifest.json'))
  const manifest = JSON.parse(source.routes.get(manifestUrl))
  const relative = Object.keys(manifest.files).find((entry) => entry.endsWith('.gz'))
  manifest.files[relative].sha256 = '0'.repeat(64)
  source.routes.set(manifestUrl, json(manifest))
  await assert.rejects(
    syncCorpus({ root, transport: source.transport, log() {} }),
    /Untrusted dataset descriptor/,
  )
  assert.equal(
    source.requests.some((url) => url.endsWith('.gz')),
    false,
  )
  await assert.rejects(readFile(path.join(root, 'current.json')), { code: 'ENOENT' })
})

test('a symlinked corpus root is rejected without writing into its target', async (t) => {
  const directory = await workspace(t)
  const outside = path.join(directory, 'outside')
  await mkdir(outside)
  const root = path.join(directory, 'corpus')
  await symlink(outside, root)
  const source = fixture()
  await assert.rejects(
    syncCorpus({ root, transport: source.transport, log() {} }),
    /Unsafe local path/,
  )
  assert.deepEqual(await readdir(outside), [])
})

test('a symlinked release directory is rejected without writing outside the corpus', async (t) => {
  const directory = await workspace(t)
  const outside = path.join(directory, 'outside')
  const root = path.join(directory, 'corpus')
  await mkdir(outside)
  await mkdir(root)
  await symlink(outside, path.join(root, 'releases'))
  const source = fixture()
  await assert.rejects(
    syncCorpus({ root, transport: source.transport, log() {} }),
    /Unsafe local path/,
  )
  assert.deepEqual(await readdir(outside), [])
})
