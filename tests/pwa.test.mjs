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
  await mkdir(path.join(root, 'branding'))
  for (const file of [
    'index.html',
    'offline.html',
    'offline-rhine.html',
    'manifest.webmanifest',
    'rhodes-island.svg',
    'branding/rhodes-island.png',
    'icons/rhodes-island-192.png',
    'icons/rhodes-island-512.png',
    'icons/rhodes-island-maskable-512.png',
    'icons/rhodes-island-apple-180.png',
    'manifest-rhine.webmanifest',
    'branding/rhine-lab.png',
    'icons/rhine-lab-192.png',
    'icons/rhine-lab-512.png',
    'icons/rhine-lab-maskable-512.png',
    'icons/rhine-lab-180.png',
  ])
    await writeFile(path.join(root, file), file)
  const { writePwaWorker } = await import('../scripts/pwa.ts')
  const version = await writePwaWorker(root)
  return { root, version, writePwaWorker, source: await readFile(path.join(root, 'sw.js'), 'utf8') }
}
function runtime(
  source,
  {
    offline = false,
    storage = new Map(),
    clients = [{ id: 'controlled', type: 'window', url: 'https://prts.test/#settings' }],
    scope = 'https://prts.test/',
  } = {},
) {
  const handlers = new Map(),
    fetched = [],
    cached = [],
    writes = []
  storage.set('/offline.html', 'PRTS offline shell')
  storage.set('/offline-rhine.html', 'Rhine Lab offline shell')
  const cache = {
    addAll: async (requests) =>
      cached.push(...requests.map((request) => new URL(request.url).pathname)),
    match: async (key) => (storage.has(key) ? new Response(storage.get(key)) : undefined),
    put: async (key, response) => {
      const value = await response.text()
      storage.set(key, value)
      writes.push({ key, value })
    },
  }
  vm.runInNewContext(source, {
    self: {
      location: { origin: 'https://prts.test' },
      registration: { scope },
      addEventListener: (name, handler) => handlers.set(name, handler),
      clients: {
        claim: async () => {},
        matchAll: async (options) => {
          assert.equal(options.type, 'window')
          assert.equal(options.includeUncontrolled, false)
          return clients
        },
      },
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
  return { handlers, fetched, cached, writes, storage }
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
  const offlineVersion = await built.writePwaWorker(built.root)
  assert.notEqual(offlineVersion, next)
  await writeFile(path.join(built.root, 'icons/rhine-lab-192.png'), 'updated Rhine Lab icon')
  assert.notEqual(await built.writePwaWorker(built.root), offlineVersion)
})

test('worker precaches only public install/offline assets and never handles private API or mutations', async (t) => {
  const { source } = await buildWorker(t)
  const worker = runtime(source)
  let installed
  worker.handlers.get('install')({ waitUntil: (promise) => (installed = promise) })
  await installed
  assert.ok(worker.cached.includes('/offline.html'))
  assert.ok(worker.cached.includes('/offline-rhine.html'))
  assert.ok(worker.cached.includes('/icons/rhodes-island-512.png'))
  assert.ok(worker.cached.includes('/manifest-rhine.webmanifest'))
  assert.ok(worker.cached.includes('/icons/rhine-lab-512.png'))
  assert.ok(worker.cached.includes('/icons/rhine-lab-180.png'))
  assert.equal(
    worker.cached.some((url) => url.startsWith('/api') || url === '/' || url === '/index.html'),
    false,
  )
  for (const [url, method, mode] of [
    ['/api/state', 'GET', 'navigate'],
    ['/api/auth/session', 'GET', 'cors'],
    ['/api/appearance', 'GET', 'cors'],
    ['/api/files/id/content', 'GET', 'cors'],
    ['/api/auth/login', 'POST', 'cors'],
    ['/api/chat', 'POST', 'cors'],
    ['/assets/amiya.png', 'GET', 'cors'],
    ['/assets/priestess.png', 'GET', 'cors'],
    ['/assets/kaltsit.png', 'GET', 'cors'],
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

async function setOfflineTheme(worker, data, source = { id: 'controlled' }) {
  let pending
  worker.handlers.get('message')({ data, source, waitUntil: (promise) => (pending = promise) })
  await pending
}
async function navigation(worker) {
  let result
  worker.handlers.get('fetch')({
    request: { url: 'https://prts.test/#tasks', method: 'GET', mode: 'navigate' },
    respondWith: (promise) => (result = promise),
  })
  return (await result).text()
}

test('a controlled client selects a public offline theme that survives worker restart without storing private data', async (t) => {
  const { source } = await buildWorker(t)
  const worker = runtime(source, { offline: true })
  await setOfflineTheme(worker, { type: 'PRTS_THEME', theme: 'rhine', privateData: 'never-store' })
  assert.equal(worker.writes.length, 1)
  assert.equal(worker.writes[0].value, 'rhine')
  assert.equal(worker.writes[0].key.startsWith('/api'), false)
  assert.equal(worker.fetched.length, 0)
  const restarted = runtime(source, { offline: true, storage: worker.storage })
  assert.equal(await navigation(restarted), 'Rhine Lab offline shell')
  await setOfflineTheme(restarted, { type: 'PRTS_THEME', theme: 'rhodes' })
  assert.equal(await navigation(restarted), 'PRTS offline shell')
  const online = runtime(source, { storage: worker.storage })
  assert.equal(await navigation(online), 'online document')
})

test('offline theme messages reject invalid values, untrusted sources and out-of-scope clients', async (t) => {
  const { source } = await buildWorker(t)
  const worker = runtime(source, { offline: true })
  for (const theme of [null, '', 'unknown', '/api/state', { theme: 'rhine' }])
    await setOfflineTheme(worker, { type: 'PRTS_THEME', theme })
  await setOfflineTheme(worker, { type: 'PRTS_THEME', theme: 'rhine' }, null)
  await setOfflineTheme(worker, { type: 'PRTS_THEME', theme: 'rhine' }, { id: 'uncontrolled' })
  assert.equal(worker.writes.length, 0)
  for (const [url, scope] of [
    ['https://outside.example/', 'https://prts.test/'],
    ['https://prts.test/outside/', 'https://prts.test/app/'],
    ['invalid-url', 'https://prts.test/'],
  ]) {
    const untrusted = runtime(source, {
      offline: true,
      clients: [{ id: 'controlled', type: 'window', url }],
      scope,
    })
    await setOfflineTheme(untrusted, { type: 'PRTS_THEME', theme: 'rhine' })
    assert.equal(untrusted.writes.length, 0)
    assert.equal(await navigation(untrusted), 'PRTS offline shell')
  }
})

test('published app icons have real installable PNG dimensions', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../static/manifest.webmanifest', import.meta.url), 'utf8'),
  )
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.start_url, '/')
  for (const [name, size] of [
    ['rhodes-island-192.png', 192],
    ['rhodes-island-512.png', 512],
    ['rhodes-island-maskable-512.png', 512],
    ['rhodes-island-apple-180.png', 180],
  ]) {
    const bytes = await readFile(new URL(`../static/icons/${name}`, import.meta.url))
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(bytes.readUInt32BE(16), size)
    assert.equal(bytes.readUInt32BE(20), size)
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512'))
})

test('Rhine Lab installation keeps the same application identity and uses distinct valid theme icons', async () => {
  const original = JSON.parse(
    await readFile(new URL('../static/manifest.webmanifest', import.meta.url), 'utf8'),
  )
  const rhine = JSON.parse(
    await readFile(new URL('../static/manifest-rhine.webmanifest', import.meta.url), 'utf8'),
  )
  for (const field of ['id', 'start_url', 'scope', 'display'])
    assert.equal(rhine[field], original[field])
  assert.match(rhine.name, /莱茵生命/)
  assert.notEqual(rhine.background_color, original.background_color)
  assert.equal(rhine.icons.length, 3)
  assert.ok(rhine.icons.every((icon) => icon.src.startsWith('/icons/rhine-lab-')))
  assert.ok(rhine.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512'))
  for (const [name, size] of [
    ['rhine-lab-192.png', 192],
    ['rhine-lab-512.png', 512],
    ['rhine-lab-maskable-512.png', 512],
    ['rhine-lab-180.png', 180],
  ]) {
    const bytes = await readFile(new URL(`../static/icons/${name}`, import.meta.url))
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(bytes.readUInt32BE(16), size)
    assert.equal(bytes.readUInt32BE(20), size)
  }
})
