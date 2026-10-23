import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const IMAGE_DIRECTORY = path.join(ROOT, 'public/assets/corpus-images')
const MANIFEST = path.join(ROOT, 'src/data/corpus-images.json')
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function imageFile(asset) {
  const prefix = 'assets/beyond/dynamicassets/gameplay/ui/sprites/'
  if (typeof asset.path !== 'string' || !asset.path.startsWith(prefix))
    throw new Error('Invalid image source path')
  const relative = asset.path.slice(prefix.length)
  if (!/^[a-zA-Z0-9_/-]+\.png$/.test(relative) || relative.split('/').some((part) => !part))
    throw new Error('Invalid image file path')
  return relative
}

export function verifyImage(buffer, asset) {
  if (
    buffer.length !== asset.size ||
    buffer.length < 33 ||
    !buffer.subarray(0, 8).equals(PNG_SIGNATURE) ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error(`Invalid PNG: ${asset.id}`)
  const blob = createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex')
  if (blob !== asset.gitBlobSha1) throw new Error(`Image integrity mismatch: ${asset.id}`)
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (!width || !height || width > 32768 || height > 32768)
    throw new Error(`Invalid image dimensions: ${asset.id}`)
  return { width, height, sha256: createHash('sha256').update(buffer).digest('hex') }
}

export async function syncCorpusImages() {
  const source = JSON.parse(
    await readFile(path.join(ROOT, 'data/corpus-images/sources.json'), 'utf8'),
  )
  const images = new Map()
  let completed = 0
  let downloaded = 0
  let next = 0
  await mkdir(IMAGE_DIRECTORY, { recursive: true })
  async function worker() {
    while (next < source.assets.length) {
      const asset = source.assets[next++]
      const file = imageFile(asset)
      const expectedUrl = `https://raw.githubusercontent.com/555me/EndfieldAssets/${source.upstream.commit}/${asset.path}`
      if (asset.downloadUrl !== expectedUrl || !/^[a-f0-9]{40}$/.test(source.upstream.commit))
        throw new Error('Image source must use the pinned repository commit')
      const destination = path.join(IMAGE_DIRECTORY, file)
      let metadata
      try {
        metadata = verifyImage(await readFile(destination), asset)
      } catch {
        await mkdir(path.dirname(destination), { recursive: true })
        const temporary = `${destination}.download`
        await execFileAsync(
          'curl',
          [
            '--fail',
            '--silent',
            '--show-error',
            '--location',
            '--proto',
            '=https',
            '--http1.1',
            '--connect-timeout',
            '15',
            '--max-time',
            '90',
            '--retry',
            '4',
            '--retry-all-errors',
            '--retry-delay',
            '2',
            '--output',
            temporary,
            asset.downloadUrl,
          ],
          { maxBuffer: 1024 * 1024 },
        )
        metadata = verifyImage(await readFile(temporary), asset)
        await rename(temporary, destination)
        downloaded += 1
      }
      images.set(asset.id, { src: `/assets/corpus-images/${file}`, ...metadata })
      completed += 1
      if (completed % 10 === 0 || completed === source.assets.length)
        console.log(`Verified images: ${completed}/${source.assets.length}`)
    }
  }
  // All workers settle before an error is reported; incomplete downloads never publish a manifest.
  const results = await Promise.allSettled(Array.from({ length: 6 }, worker))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
  const entries = source.mappings.map((mapping) => {
    const variants = mapping.assets.map((id) => {
      const label = id.endsWith('_f') ? '女管理员' : '男管理员'
      return {
        ...images.get(id),
        alt: mapping.assets.length > 1 ? `${mapping.alt} · ${label}` : mapping.alt,
        ...(mapping.assets.length > 1 ? { label } : {}),
      }
    })
    return {
      resource: mapping.resource,
      kind: mapping.kind,
      ...variants[0],
      alt: mapping.alt,
      ...(variants.length > 1 ? { variants } : {}),
    }
  })
  const manifest = {
    schemaVersion: 1,
    corpusRelease: source.corpusRelease,
    sourceCommit: source.upstream.commit,
    images: entries,
    unresolved: source.unresolved.map((entry) => entry.corpusId),
  }
  await mkdir(path.dirname(MANIFEST), { recursive: true })
  await writeFile(`${MANIFEST}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`)
  await rename(`${MANIFEST}.tmp`, MANIFEST)
  console.log(
    JSON.stringify({
      files: images.size,
      mappings: entries.length,
      downloaded,
      reused: images.size - downloaded,
      unresolved: manifest.unresolved,
    }),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  syncCorpusImages().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
