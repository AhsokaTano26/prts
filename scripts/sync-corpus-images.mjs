import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, lstat, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { download } from './sync-corpus.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const ASSET_DIRECTORY = path.join(ROOT, 'data/assets')
const SOURCE_FILE = path.join(ROOT, 'server/image-sources.json')
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
export const AMIYA = {
  id: 'amiya',
  size: 411842,
  sha256: '3fe7605b1dfb923ff83451de42eec7657310e7b859fc0b8ff893045b082807ce',
  downloadUrl:
    'https://media.prts.wiki/3/34/%E7%AB%8B%E7%BB%98_%E9%98%BF%E7%B1%B3%E5%A8%85_1%2B.png',
}

export function imageFile(asset) {
  const prefix = 'assets/beyond/dynamicassets/gameplay/ui/sprites/'
  if (typeof asset.path !== 'string' || !asset.path.startsWith(prefix))
    throw new Error('Invalid image source path')
  const relative = asset.path.slice(prefix.length)
  if (!/^[a-zA-Z0-9_/-]+\.png$/.test(relative) || relative.split('/').some((part) => !part))
    throw new Error('Invalid image file path')
  return relative
}

function pngMetadata(buffer, expectedSize, id) {
  if (
    buffer.length !== expectedSize ||
    buffer.length < 33 ||
    !buffer.subarray(0, 8).equals(PNG_SIGNATURE) ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error(`Invalid PNG: ${id}`)
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (!width || !height || width > 32768 || height > 32768)
    throw new Error(`Invalid image dimensions: ${id}`)
  return { width, height, sha256: createHash('sha256').update(buffer).digest('hex') }
}

export function verifyImage(buffer, asset) {
  const metadata = pngMetadata(buffer, asset.size, asset.id)
  const blob = createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex')
  if (blob !== asset.gitBlobSha1) throw new Error(`Image integrity mismatch: ${asset.id}`)
  return metadata
}

export function verifyAmiya(buffer) {
  const metadata = pngMetadata(buffer, AMIYA.size, AMIYA.id)
  if (metadata.sha256 !== AMIYA.sha256 || metadata.width !== 1024 || metadata.height !== 1024)
    throw new Error('Image integrity mismatch: amiya')
  return metadata
}

async function prepareDirectory(directory) {
  const existing = await lstat(directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
    throw new Error('Image directory must be a real directory')
  await mkdir(directory, { recursive: true })
  return realpath(directory)
}

async function destinationPath(root, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    path.isAbsolute(relative) ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid destination path')
  let current = root
  for (const component of relative.split('/').slice(0, -1)) {
    current = path.join(current, component)
    await mkdir(current).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Unsafe destination directory')
  }
  const file = path.join(root, relative)
  const existing = await lstat(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (existing && (!existing.isFile() || existing.isSymbolicLink()))
    throw new Error('Unsafe destination file')
  return file
}

async function atomicWrite(file, bytes) {
  const temporary = `${file}.download-${randomUUID()}`
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, file)
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

async function sourceManifest(sourceFile) {
  const source = JSON.parse(await readFile(sourceFile, 'utf8'))
  if (
    !/^[a-f0-9]{40}$/.test(source.upstream?.commit) ||
    !Array.isArray(source.assets) ||
    !source.assets.length
  )
    throw new Error('Invalid pinned image manifest')
  const paths = new Set()
  for (const asset of source.assets) {
    const relative = imageFile(asset)
    const expectedUrl = `https://raw.githubusercontent.com/555me/EndfieldAssets/${source.upstream.commit}/${asset.path}`
    if (
      asset.downloadUrl !== expectedUrl ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > 32 * 1024 * 1024 ||
      !/^[a-f0-9]{40}$/.test(asset.gitBlobSha1) ||
      paths.has(relative)
    )
      throw new Error('Invalid pinned image descriptor')
    paths.add(relative)
  }
  return source
}

export async function syncCorpusImages({
  directory = path.join(ASSET_DIRECTORY, 'corpus-images'),
  sourceFile = SOURCE_FILE,
  transport = download,
  onProgress = () => {},
  log = console.log,
} = {}) {
  const source = await sourceManifest(sourceFile)
  const root = await prepareDirectory(directory)
  let completed = 0,
    completedBytes = 0,
    downloaded = 0,
    next = 0
  const totalBytes = source.assets.reduce((total, asset) => total + asset.size, 0)
  const images = new Map()
  const emit = (phase) =>
    onProgress({
      phase,
      completedFiles: completed,
      totalFiles: source.assets.length,
      completedBytes,
      totalBytes,
      release: source.upstream.commit,
    })
  await emit('verifying')
  async function worker() {
    while (next < source.assets.length) {
      const asset = source.assets[next++]
      const file = imageFile(asset)
      const destination = await destinationPath(root, file)
      let metadata
      try {
        metadata = verifyImage(await readFile(destination), asset)
      } catch {
        await emit('downloading')
        const bytes = await transport(asset.downloadUrl, asset.size)
        metadata = verifyImage(Buffer.from(bytes), asset)
        await atomicWrite(destination, bytes)
        downloaded += 1
      }
      images.set(asset.id, { path: `corpus-images/${file}`, size: asset.size, ...metadata })
      completed += 1
      completedBytes += asset.size
      await emit('verifying')
      if (completed % 10 === 0 || completed === source.assets.length)
        log(`Verified images: ${completed}/${source.assets.length}`)
    }
  }
  const results = await Promise.allSettled(Array.from({ length: 6 }, worker))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
  return {
    release: source.upstream.commit,
    files: images.size,
    totalBytes,
    downloaded,
    reused: images.size - downloaded,
    images: [...images.values()],
  }
}

/** Runs only on explicit CLI/API invocation; application startup never downloads assets. */
export async function syncAssets({
  directory = ASSET_DIRECTORY,
  sourceFile = SOURCE_FILE,
  transport = download,
  onProgress = () => {},
  log = console.log,
} = {}) {
  const source = await sourceManifest(sourceFile)
  const root = await prepareDirectory(directory)
  const totalFiles = source.assets.length + 1
  const totalBytes = source.assets.reduce((total, asset) => total + asset.size, AMIYA.size)
  const release = `${source.upstream.commit}:${AMIYA.sha256.slice(0, 12)}`
  const progress = {
    phase: 'checking',
    completedFiles: 0,
    totalFiles,
    completedBytes: 0,
    totalBytes,
    release,
  }
  await onProgress({ ...progress })
  const destination = await destinationPath(root, 'amiya.png')
  let amiyaDownloaded = 0
  try {
    verifyAmiya(await readFile(destination))
  } catch {
    await onProgress({ ...progress, phase: 'downloading' })
    const bytes = Buffer.from(await transport(AMIYA.downloadUrl, AMIYA.size))
    verifyAmiya(bytes)
    await atomicWrite(destination, bytes)
    amiyaDownloaded = 1
  }
  const report = await syncCorpusImages({
    directory: path.join(root, 'corpus-images'),
    sourceFile,
    transport,
    log,
    onProgress: (value) =>
      onProgress({
        ...value,
        completedFiles: value.completedFiles + 1,
        totalFiles,
        completedBytes: value.completedBytes + AMIYA.size,
        totalBytes,
        release,
      }),
  })
  await onProgress({
    phase: 'activating',
    completedFiles: totalFiles,
    totalFiles,
    completedBytes: totalBytes,
    totalBytes,
    release,
  })
  const installed = {
    schemaVersion: 1,
    release,
    files: totalFiles,
    totalBytes,
    installedAt: new Date().toISOString(),
    images: [{ path: 'amiya.png', size: AMIYA.size, sha256: AMIYA.sha256 }, ...report.images],
  }
  const marker = await destinationPath(root, 'assets-manifest.json')
  await atomicWrite(marker, Buffer.from(`${JSON.stringify(installed, null, 2)}\n`))
  return {
    release,
    files: totalFiles,
    totalBytes,
    downloaded: report.downloaded + amiyaDownloaded,
    reused: report.reused + 1 - amiyaDownloaded,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.includes('--help'))
    console.log(
      'Usage: node scripts/sync-corpus-images.mjs [--directory data/assets]\nExplicitly downloads and verifies Amiya and corpus PNGs. Does not run during deployment or startup.',
    )
  else if (args.length !== 0 && (args.length !== 2 || args[0] !== '--directory')) {
    console.error('Unknown arguments; use --help.')
    process.exitCode = 1
  } else
    syncAssets({ directory: args.length ? path.resolve(args[1]) : ASSET_DIRECTORY })
      .then((report) => {
        console.log(JSON.stringify(report, null, 2))
      })
      .catch((error) => {
        console.error(error.message)
        process.exitCode = 1
      })
}
