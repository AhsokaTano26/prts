import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncAssets } from '../scripts/sync-corpus-images.mjs'
import { HttpError } from './errors.mjs'

const DEFAULT_DIRECTORY = fileURLToPath(new URL('../data/assets/', import.meta.url))
const managers = new Map()
const databaseManagers = new WeakMap()
const initialized = new WeakSet()
const PHASES = ['checking', 'downloading', 'verifying', 'activating']
const count = (value, fallback) => (Number.isSafeInteger(value) && value >= 0 ? value : fallback)

function ensureProgressSchema(database) {
  if (!database || initialized.has(database)) return
  // Only job metadata belongs in SQLite; images and corpus archives stay under data/.
  database.exec(
    'CREATE TABLE IF NOT EXISTS resource_sync_state (kind TEXT PRIMARY KEY, payload TEXT NOT NULL)',
  )
  initialized.add(database)
}

export function loadResourceSyncState(database, kind) {
  if (!database) return null
  ensureProgressSchema(database)
  const row = database.prepare('SELECT payload FROM resource_sync_state WHERE kind = ?').get(kind)
  if (!row) return null
  try {
    return JSON.parse(row.payload)
  } catch {
    return null
  }
}

export function saveResourceSyncState(database, kind, state) {
  if (!database) return
  ensureProgressSchema(database)
  database
    .prepare(
      `INSERT INTO resource_sync_state (kind, payload) VALUES (?, ?)
    ON CONFLICT(kind) DO UPDATE SET payload = excluded.payload`,
    )
    .run(kind, JSON.stringify(state))
}

function safeRelative(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.split('/').some((part) => !part || part.startsWith('.'))
  )
}

export async function getAsset(directory, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/assets/')) return null
  const relative = pathname.slice('/assets/'.length)
  if (!safeRelative(relative) || !relative.endsWith('.png')) return null
  try {
    const root = await realpath(directory || DEFAULT_DIRECTORY)
    const file = await realpath(path.join(root, relative))
    if (!file.startsWith(`${root}${path.sep}`)) return null
    const info = await stat(file)
    if (!info.isFile()) return null
    return { file, mime: 'image/png', size: info.size }
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return null
    throw error
  }
}

export async function assetStatus(directory = DEFAULT_DIRECTORY) {
  try {
    const root = await realpath(directory)
    const marker = await realpath(path.join(root, 'assets-manifest.json'))
    if (!marker.startsWith(`${root}${path.sep}`)) throw new Error('Invalid image manifest')
    const info = await stat(marker)
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Invalid image manifest')
    const manifest = JSON.parse(await readFile(marker, 'utf8'))
    if (
      manifest.schemaVersion !== 1 ||
      typeof manifest.release !== 'string' ||
      !Number.isSafeInteger(manifest.files) ||
      manifest.files < 1 ||
      manifest.files > 1000 ||
      !Array.isArray(manifest.images) ||
      manifest.images.length !== manifest.files
    )
      throw new Error('Invalid image manifest')
    let bytes = 0
    const seen = new Set()
    for (const image of manifest.images) {
      if (!safeRelative(image.path) || seen.has(image.path))
        throw new Error('Invalid image manifest')
      seen.add(image.path)
      const asset = await getAsset(root, `/assets/${image.path}`)
      if (!asset || asset.size !== image.size) throw new Error('Missing installed image')
      bytes += asset.size
    }
    if (bytes !== manifest.totalBytes) throw new Error('Invalid image totals')
    return { ready: true, release: manifest.release, files: manifest.files, totalBytes: bytes }
  } catch {
    return { ready: false, release: null, files: 0, totalBytes: 0 }
  }
}

export function assetManager({
  database,
  directory = DEFAULT_DIRECTORY,
  synchronize = syncAssets,
  now = Date.now,
} = {}) {
  directory = path.resolve(directory)
  let registry = managers
  if (database) {
    if (!databaseManagers.has(database)) databaseManagers.set(database, new Map())
    registry = databaseManagers.get(database)
  }
  if (registry.has(directory)) return registry.get(directory)
  const storageKey = `assets:${directory}`
  let state = {
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
  }
  const stored = loadResourceSyncState(database, storageKey)
  if (stored && ['idle', 'running', 'succeeded', 'failed'].includes(stored.state))
    state = { ...state, ...stored }
  const save = (next) => {
    state = next
    saveResourceSyncState(database, storageKey, state)
  }
  if (state.state === 'running')
    save({
      ...state,
      state: 'failed',
      phase: null,
      finishedAt: new Date(now()).toISOString(),
      result: null,
      error: '上次图片同步因服务重启而中断，请重试；已下载的有效图片仍可使用。',
    })
  let starting
  async function run(previous) {
    try {
      const report = await synchronize({
        directory,
        log() {},
        onProgress(progress) {
          if (state.state !== 'running') return
          save({
            ...state,
            phase: PHASES.includes(progress.phase) ? progress.phase : state.phase,
            completedFiles: count(progress.completedFiles, state.completedFiles),
            totalFiles: count(progress.totalFiles, state.totalFiles),
            completedBytes: count(progress.completedBytes, state.completedBytes),
            totalBytes: count(progress.totalBytes, state.totalBytes),
            release: typeof progress.release === 'string' ? progress.release : state.release,
          })
        },
      })
      const installed = await assetStatus(directory)
      if (!installed.ready || installed.release !== report.release)
        throw new Error('Image activation failed')
      save({
        ...state,
        state: 'succeeded',
        phase: null,
        completedFiles: installed.files,
        totalFiles: installed.files,
        completedBytes: installed.totalBytes,
        totalBytes: installed.totalBytes,
        release: installed.release,
        finishedAt: new Date(now()).toISOString(),
        error: null,
        result: !previous.ready
          ? 'installed'
          : previous.release === installed.release
            ? 'current'
            : 'updated',
      })
    } catch {
      save({
        ...state,
        state: 'failed',
        phase: null,
        finishedAt: new Date(now()).toISOString(),
        result: null,
        error: previous.ready
          ? '图片更新失败，请检查网络和磁盘空间后重试。已安装的有效图片仍可使用。'
          : '图片下载或校验失败，请检查网络和磁盘空间后重试。',
      })
    }
  }
  const manager = {
    async status() {
      const installed = await assetStatus(directory)
      return {
        ...state,
        release: state.release || installed.release,
        ready: installed.ready,
        availableFiles: installed.files,
        installedBytes: installed.totalBytes,
      }
    },
    async start(mode) {
      if (!['install', 'update'].includes(mode))
        throw new HttpError(400, '同步模式必须为 install 或 update。')
      if (state.state === 'running') return manager.status()
      if (starting) {
        await starting.catch(() => {})
        return manager.start(mode)
      }
      starting = (async () => {
        const previous = await assetStatus(directory)
        if (mode === 'install' && previous.ready)
          throw new HttpError(409, '图片已安装，请使用检查更新与修复。')
        save({
          state: 'running',
          phase: 'checking',
          completedFiles: 0,
          totalFiles: 0,
          completedBytes: 0,
          totalBytes: 0,
          release: previous.release,
          startedAt: new Date(now()).toISOString(),
          finishedAt: null,
          error: null,
          result: null,
        })
        setImmediate(() => {
          void run(previous).catch(() => {})
        })
        return manager.status()
      })()
      try {
        return await starting
      } finally {
        starting = null
      }
    },
  }
  registry.set(directory, manager)
  return manager
}
