import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { test } from 'node:test'

async function buildWorker(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-pwa-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'icons'))
  for (const file of [
    'index.html',
    'offline.html',
    'manifest.webmanifest',
    'favicon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/maskable-512.png',
    'icons/apple-touch-icon.png',
  ])
    await writeFile(path.join(root, file), file)
  const { writePwaWorker } = await import('../scripts/pwa.ts')
  const version = await writePwaWorker(root)
  return { root, version, writePwaWorker, source: await readFile(path.join(root, 'sw.js'), 'utf8') }
}
function runtime(source, { offline = false } = {}) {
  const handlers = new Map(),
    fetched = [],
    cached = []
  const cache = {
    addAll: async (requests) =>
      cached.push(...requests.map((request) => new URL(request.url).pathname)),
    match: async (key) =>
      key === '/offline.html' ? new Response('PRTS offline shell') : undefined,
  }
  vm.runInNewContext(source, {
    self: {
      location: { origin: 'https://prts.test' },
      addEventListener: (name, handler) => handlers.set(name, handler),
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
    },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    Request: class extends Request {
      constructor(input, init) {
        super(new URL(input, 'https://prts.test'), init)
      }
    },
    Response,
    fetch: async (request) => {
      fetched.push(request)
      if (offline) throw new Error('offline')
      return new Response('online document')
    },
    URL,
  })
  return { handlers, fetched, cached }
}

test('PWA build versions change with app builds and public offline content', async (t) => {
  const built = await buildWorker(t)
  assert.equal(await built.writePwaWorker(built.root), built.version)
  await writeFile(
    path.join(built.root, 'index.html'),
    '<script src="/assets/new-hash.js"></script>',
  )
  const next = await built.writePwaWorker(built.root)
  assert.notEqual(next, built.version)
  await writeFile(path.join(built.root, 'offline.html'), 'updated offline copy')
  assert.notEqual(await built.writePwaWorker(built.root), next)
})

test('worker precaches only public install/offline assets and never handles private API or mutations', async (t) => {
  const { source } = await buildWorker(t)
  const worker = runtime(source)
  let installed
  worker.handlers.get('install')({ waitUntil: (promise) => (installed = promise) })
  await installed
  assert.ok(worker.cached.includes('/offline.html'))
  assert.ok(worker.cached.includes('/icons/icon-512.png'))
  assert.equal(
    worker.cached.some((url) => url.startsWith('/api') || url === '/' || url === '/index.html'),
    false,
  )
  for (const [url, method, mode] of [
    ['/api/state', 'GET', 'navigate'],
    ['/api/auth/session', 'GET', 'cors'],
    ['/api/files/id/content', 'GET', 'cors'],
    ['/api/auth/login', 'POST', 'cors'],
    ['/api/chat', 'POST', 'cors'],
    ['/assets/amiya.png', 'GET', 'cors'],
    ['https://outside.example/file', 'GET', 'cors'],
  ]) {
    let handled = false
    worker.handlers.get('fetch')({
      request: { url: new URL(url, 'https://prts.test').href, method, mode },
      respondWith: () => (handled = true),
    })
    assert.equal(handled, false, url)
  }
  assert.equal(worker.fetched.length, 0)
})

test('offline navigation returns the public offline page while online navigation stays fresh', async (t) => {
  const { source } = await buildWorker(t)
  for (const offline of [true, false]) {
    const worker = runtime(source, { offline })
    let result
    worker.handlers.get('fetch')({
      request: { url: 'https://prts.test/', method: 'GET', mode: 'navigate' },
      respondWith: (promise) => (result = promise),
    })
    assert.equal(await (await result).text(), offline ? 'PRTS offline shell' : 'online document')
  }
})

test('published app icons have real installable PNG dimensions', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../static/manifest.webmanifest', import.meta.url), 'utf8'),
  )
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.start_url, '/')
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]) {
    const bytes = await readFile(new URL(`../static/icons/${name}`, import.meta.url))
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(bytes.readUInt32BE(16), size)
    assert.equal(bytes.readUInt32BE(20), size)
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512'))
})
