#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, rename, unlink, lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const API = 'https://prts.chat/api/agent/data/releases'
const DEFAULT_ROOT = fileURLToPath(new URL('../data/corpus/', import.meta.url))
const PACKS = [
  'official_game',
  'endfield_official_game',
  'endfield_reviewed_knowledge',
  'reviewed_wiki',
  'terra_journey',
  'entities',
  'references',
]
const DATASETS = [
  {
    group: 'arknights',
    packs: ['official_game', 'reviewed_wiki', 'terra_journey', 'entities', 'references'],
  },
  { group: 'endfield', packs: ['endfield_official_game', 'endfield_reviewed_knowledge'] },
].map((dataset) => ({
  ...dataset,
  base: `https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-${dataset.group}/resolve/master/`,
}))

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

export function safePath(value) {
  invariant(
    typeof value === 'string' &&
      value.length > 0 &&
      !value.startsWith('/') &&
      !/[\\\x00-\x20?#%:]/.test(value) &&
      value.split('/').every((part) => part && part !== '.' && part !== '..'),
    `Unsafe relative path: ${value}`,
  )
  return value
}

export function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function validateBytes(bytes, descriptor, label) {
  invariant(
    Number.isSafeInteger(descriptor.size) &&
      descriptor.size >= 0 &&
      /^[a-f0-9]{64}$/.test(descriptor.sha256),
    `Invalid descriptor: ${label}`,
  )
  invariant(
    bytes.length === descriptor.size,
    `Size mismatch: ${label} (${bytes.length} != ${descriptor.size})`,
  )
  invariant(digest(bytes) === descriptor.sha256, `SHA-256 mismatch: ${label}`)
}

// curl performs HTTPS transport only. No downloaded file or upstream code is executed.
export async function download(url, maxBytes = 8 * 1024 * 1024) {
  const parsed = new URL(url)
  invariant(
    parsed.protocol === 'https:' && !parsed.username && !parsed.password,
    'Only HTTPS downloads are allowed',
  )
  // Each retry gets a fresh stdout buffer: curl retries to stdout can append partial bodies.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await downloadAttempt(url, parsed, maxBytes)
    } catch (error) {
      if (attempt === 2) throw error
      await delay(500 * (attempt + 1))
    }
  }
}

function downloadAttempt(url, parsed, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'curl',
      [
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--max-redirs',
        '5',
        '--proto',
        '=https',
        '--proto-redir',
        '=https',
        '--connect-timeout',
        '15',
        '--max-time',
        '90',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const chunks = []
    let size = 0
    let errorText = ''
    let error
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        error = new Error(`Download exceeds expected size: ${parsed.pathname}`)
        child.kill()
      } else chunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      errorText = (errorText + chunk.toString()).slice(-2000)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (error) reject(error)
      else if (code !== 0)
        reject(new Error(`Download failed (${code}): ${parsed.pathname}: ${errorText.trim()}`))
      else resolve(Buffer.concat(chunks))
    })
  })
}

function unsafeLocalPath(file) {
  const error = new Error(`Unsafe local path (symlink or non-regular entry): ${file}`)
  error.code = 'UNSAFE_LOCAL_PATH'
  return error
}

function insideRoot(root, file) {
  const relative = path.relative(root, file)
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  )
}

async function prepareRoot(root) {
  root = path.resolve(root)
  const info = await lstat(root).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw unsafeLocalPath(root)
  await mkdir(root, { recursive: true })
  return realpath(root)
}

async function guardLocalPath(root, file) {
  if (!insideRoot(root, file)) throw unsafeLocalPath(file)
  let directory = root
  const relative = path.relative(root, path.dirname(file))
  for (const component of relative ? relative.split(path.sep) : []) {
    directory = path.join(directory, component)
    await mkdir(directory).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
    const info = await lstat(directory)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      !insideRoot(root, await realpath(directory))
    )
      throw unsafeLocalPath(directory)
  }
  const info = await lstat(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (info && (!info.isFile() || info.isSymbolicLink())) throw unsafeLocalPath(file)
}

async function atomicWrite(root, file, bytes) {
  await guardLocalPath(root, file)
  const temporary = `${file}.partial-${randomUUID()}`
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, file)
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

async function parallel(items, concurrency, task) {
  let cursor = 0
  let failure
  const results = new Array(items.length)
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!failure && cursor < items.length) {
        const index = cursor++
        try {
          results[index] = await task(items[index], index)
        } catch (error) {
          failure ||= error
        }
      }
    }),
  )
  if (failure) throw failure
  return results
}

export function packAssets(manifest) {
  const assets = new Map()
  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (typeof value.path === 'string' && typeof value.sha256 === 'string') {
      const relative = safePath(value.path)
      invariant(relative.endsWith('.gz'), `Unexpected non-gzip asset: ${relative}`)
      const descriptor = { size: value.compressed_size, sha256: value.sha256 }
      invariant(
        Number.isSafeInteger(descriptor.size) &&
          descriptor.size > 0 &&
          /^[a-f0-9]{64}$/.test(descriptor.sha256),
        `Invalid pack asset: ${relative}`,
      )
      invariant(!assets.has(relative), `Duplicate pack asset: ${relative}`)
      assets.set(relative, descriptor)
    }
    for (const child of Object.values(value)) visit(child)
  }
  visit(manifest)
  invariant(
    assets.size > 0 && assets.has(manifest.document_catalog?.path),
    'Pack document catalog is missing',
  )
  return assets
}

export function matchDataset(dataset, release, trustedPacks) {
  invariant(
    dataset.release_id === release.release_id && dataset.data_version === release.data_version,
    'Dataset release differs from the approved release',
  )
  invariant(
    dataset.files && Object.keys(dataset.files).length === dataset.file_count,
    'Dataset file count mismatch',
  )
  const expected = new Map()
  for (const packId of dataset.pack_ids || []) {
    const pack = trustedPacks.get(packId)
    invariant(pack, `Unexpected dataset pack: ${packId}`)
    const prefix = `releases/${release.release_id}/${packId}/`
    expected.set(`${prefix}pack-manifest.json`, {
      size: pack.bytes.length,
      sha256: digest(pack.bytes),
    })
    for (const [relative, descriptor] of pack.assets) expected.set(prefix + relative, descriptor)
  }
  invariant(
    expected.size === dataset.file_count,
    'Dataset omits or adds files relative to approved pack manifests',
  )
  for (const [relative, descriptor] of Object.entries(dataset.files)) {
    safePath(relative)
    const trusted = expected.get(relative)
    invariant(
      trusted && trusted.size === descriptor.size && trusted.sha256 === descriptor.sha256,
      `Untrusted dataset descriptor: ${relative}`,
    )
  }
  return expected
}

async function verifiedLocal(root, file, descriptor) {
  try {
    await guardLocalPath(root, file)
    const info = await lstat(file)
    if (!info.isFile() || info.size !== descriptor.size) return false
    validateBytes(await readFile(file), descriptor, file)
    return true
  } catch (error) {
    if (error.code && error.code !== 'ENOENT') throw error
    return false
  }
}

export async function syncCorpus({
  root = DEFAULT_ROOT,
  concurrency = 10,
  transport = download,
  log = console.log,
  onProgress = () => {},
  beforeActivate = () => {},
} = {}) {
  invariant(
    Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 12,
    'Concurrency must be 1–12',
  )
  invariant(
    typeof onProgress === 'function' && typeof beforeActivate === 'function',
    'Progress and activation callbacks must be functions',
  )
  let progress = {
    phase: 'checking',
    completedFiles: 0,
    totalFiles: 0,
    completedBytes: 0,
    totalBytes: 0,
    release: null,
  }
  const emitProgress = (phase, changes = {}) => {
    progress = { ...progress, ...changes, phase }
    // A fresh snapshot prevents later updates or observer mutation from changing prior events.
    return onProgress({ ...progress })
  }
  await emitProgress('checking')
  root = await prepareRoot(root)
  const json = async (url) => {
    const bytes = await transport(url)
    return { bytes, value: JSON.parse(bytes.toString('utf8')) }
  }
  log('Fetching approved release metadata…')
  const currentResponse = await json(`${API}/current`)
  const current = currentResponse.value.data
  invariant(
    currentResponse.value.code === 200 && current?.distribution_status === 'published',
    'Current release is not published',
  )
  safePath(current.release_id)
  invariant(
    !current.release_id.includes('/') && /^[a-f0-9]{64}$/.test(current.data_version),
    'Invalid release identity',
  )
  await emitProgress('checking', { release: current.release_id })
  const releaseUrl = `${API}/${current.release_id}/release-manifest.json`
  const releaseResponse = await json(releaseUrl)
  const release = releaseResponse.value
  invariant(
    release.release_id === current.release_id &&
      release.data_version === current.data_version &&
      release.distribution_status === 'published',
    'Release manifest differs from current release',
  )
  invariant(
    PACKS.every(
      (pack) =>
        release.required_packs?.includes(pack) &&
        release.publication?.approved_pack_ids?.includes(pack),
    ),
    'Release does not approve all required packs',
  )
  invariant(
    release.required_packs.length === PACKS.length && release.packs.length === PACKS.length,
    'Unexpected release pack set',
  )
  const packs = new Map(
    await parallel(PACKS, concurrency, async (packId) => {
      const result = await json(`${API}/${current.release_id}/${packId}/pack-manifest.json`)
      const summary = release.packs.find((pack) => pack.pack_id === packId)
      invariant(
        summary && result.value.data_version === summary.data_version,
        `Pack version mismatch: ${packId}`,
      )
      const assets = packAssets(result.value)
      invariant(
        assets.size === summary.shard_count &&
          [...assets.values()].reduce((sum, item) => sum + item.size, 0) ===
            summary.compressed_size,
        `Pack totals mismatch: ${packId}`,
      )
      return [packId, { ...result, assets }]
    }),
  )
  const datasets = await parallel(DATASETS, 2, async (source) => {
    const manifestUrl = `${source.base}releases/${current.release_id}/dataset-manifest.json`
    const manifest = await json(manifestUrl)
    invariant(
      JSON.stringify([...manifest.value.pack_ids].sort()) ===
        JSON.stringify([...source.packs].sort()),
      `Dataset pack set mismatch: ${source.group}`,
    )
    const files = matchDataset(manifest.value, release, packs)
    const readme = await transport(`${source.base}README.md`)
    return { source, manifestUrl, manifest, files, readme }
  })
  const files = datasets.flatMap((dataset) =>
    [...dataset.files].map(([relative, descriptor]) => ({
      relative,
      descriptor,
      url: dataset.source.base + relative,
    })),
  )
  invariant(
    new Set(files.map((file) => file.relative)).size === files.length,
    'Datasets contain duplicate files',
  )
  const gzipFiles = files.filter((file) => file.relative.endsWith('.gz'))
  const gzipBytes = gzipFiles.reduce((sum, file) => sum + file.descriptor.size, 0)
  invariant(
    gzipFiles.length === current.shard_count && gzipBytes === release.compressed_size,
    'Release resource totals mismatch',
  )
  const verifiedBytes = files.reduce((sum, file) => sum + file.descriptor.size, 0)
  await emitProgress('checking', { totalFiles: files.length, totalBytes: verifiedBytes })
  const releaseRoot = path.join(root, 'releases', current.release_id)
  await atomicWrite(root, path.join(releaseRoot, 'release-manifest.json'), releaseResponse.bytes)
  await atomicWrite(root, path.join(releaseRoot, 'current-upstream.json'), currentResponse.bytes)
  for (const [packId, pack] of packs)
    await atomicWrite(root, path.join(releaseRoot, packId, 'pack-manifest.json'), pack.bytes)
  for (const dataset of datasets) {
    const directory = path.join(releaseRoot, 'sources', dataset.source.group)
    await atomicWrite(root, path.join(directory, 'dataset-manifest.json'), dataset.manifest.bytes)
    await atomicWrite(root, path.join(directory, 'README.md'), dataset.readme)
  }
  log(
    `Release ${current.release_id}: ${files.length} files, ${gzipBytes.toLocaleString()} gzip bytes; concurrency ${concurrency}.`,
  )
  let completed = 0
  let reused = 0
  let downloaded = 0
  let downloadedBytes = 0
  let completedBytes = 0
  let activeDownloads = 0
  await emitProgress('verifying')
  await parallel(files, concurrency, async (file) => {
    const destination = path.join(root, safePath(file.relative))
    if (await verifiedLocal(root, destination, file.descriptor)) reused += 1
    else {
      activeDownloads += 1
      try {
        await emitProgress('downloading')
        const bytes = await transport(file.url, file.descriptor.size)
        validateBytes(bytes, file.descriptor, file.relative)
        await atomicWrite(root, destination, bytes)
        downloaded += 1
        downloadedBytes += bytes.length
      } finally {
        activeDownloads -= 1
      }
    }
    completed += 1
    completedBytes += file.descriptor.size
    if (completed % 50 === 0 || completed === files.length)
      log(`Verified ${completed}/${files.length}; downloaded ${downloaded}, reused ${reused}.`)
    await emitProgress(activeDownloads > 0 ? 'downloading' : 'verifying', {
      completedFiles: completed,
      completedBytes,
    })
  })
  const report = {
    release_id: current.release_id,
    data_version: current.data_version,
    verified_at: new Date().toISOString(),
    file_count: files.length,
    verified_bytes: verifiedBytes,
    gzip_file_count: gzipFiles.length,
    gzip_bytes: gzipBytes,
    downloaded,
    downloaded_bytes: downloadedBytes,
    reused,
    document_count: release.document_count,
    line_count: release.line_count,
    packs: release.packs.map((pack) => ({
      pack_id: pack.pack_id,
      file_count: pack.shard_count,
      compressed_bytes: pack.compressed_size,
      document_count: pack.document_count,
      line_count: pack.line_count,
    })),
  }
  await atomicWrite(
    root,
    path.join(releaseRoot, 'sync-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  await beforeActivate({ root, releaseId: current.release_id, dataVersion: current.data_version })
  await emitProgress('activating')
  await atomicWrite(
    root,
    path.join(root, 'current.json'),
    JSON.stringify(
      { release_id: current.release_id, data_version: current.data_version },
      null,
      2,
    ) + '\n',
  )
  log(JSON.stringify(report, null, 2))
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(
      'Usage: node scripts/sync-corpus.mjs [--concurrency 1..12]\nRequires Node >=22.18 and curl. Reuses files only after size/SHA-256 verification. Keeps gzip compressed.',
    )
  } else {
    const valid = args.length === 0 || (args.length === 2 && args[0] === '--concurrency')
    if (!valid) {
      console.error('Unknown arguments; use --help.')
      process.exitCode = 1
    } else
      syncCorpus({ concurrency: args.length ? Number(args[1]) : 10 }).catch((error) => {
        console.error(`Corpus sync failed; current.json was not updated: ${error.message}`)
        process.exitCode = 1
      })
  }
}
