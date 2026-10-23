import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncCorpus } from '../scripts/sync-corpus.mjs'
import { createCorpus } from './corpus.mjs'
import { HttpError } from './errors.mjs'
import { loadResourceSyncState, saveResourceSyncState } from './resources.mjs'

const DEFAULT_DIRECTORY = fileURLToPath(new URL('../data/corpus/', import.meta.url))
const managers = new Map()
const databaseManagers = new WeakMap()
const PHASES = ['checking', 'downloading', 'verifying', 'activating']
const validRelease = (value) => typeof value === 'string' && /^[A-Za-z0-9._-]{1,160}$/.test(value)
const count = (value, fallback) => (Number.isSafeInteger(value) && value >= 0 ? value : fallback)

// One directory has one job and one live snapshot throughout this server process.
export function knowledgeManager({
  database,
  directory = DEFAULT_DIRECTORY,
  synchronize = syncCorpus,
  now = Date.now,
} = {}) {
  directory = path.resolve(directory)
  let registry = managers
  if (database) {
    if (!databaseManagers.has(database)) databaseManagers.set(database, new Map())
    registry = databaseManagers.get(database)
  }
  if (registry.has(directory)) return registry.get(directory)
  let corpus = createCorpus({ directory })
  let starting
  let sequence = 0
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
  const storageKey = `corpus:${directory}`
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
      error: '上次语料同步因服务重启而中断，请重试；已安装的语料仍可使用。',
    })
  const snapshot = () => ({ ...state })

  async function run(previous, job) {
    let candidate
    try {
      const report = await synchronize({
        root: directory,
        log() {},
        onProgress(progress) {
          if (sequence !== job || state.state !== 'running') return
          save({
            ...state,
            phase: PHASES.includes(progress.phase) ? progress.phase : state.phase,
            completedFiles: count(progress.completedFiles, state.completedFiles),
            totalFiles: count(progress.totalFiles, state.totalFiles),
            completedBytes: count(progress.completedBytes, state.completedBytes),
            totalBytes: count(progress.totalBytes, state.totalBytes),
            release: validRelease(progress.release) ? progress.release : state.release,
          })
        },
        async beforeActivate({ releaseId, dataVersion }) {
          if (!validRelease(releaseId) || typeof dataVersion !== 'string')
            throw new Error('Invalid release')
          const next = createCorpus({
            directory,
            release: { release_id: releaseId, data_version: dataVersion },
          })
          const status = await next.status()
          if (!status.ready || status.release !== releaseId)
            throw new Error('Invalid candidate corpus')
          candidate = next
        },
      })
      if (!candidate || !validRelease(report?.release_id))
        throw new Error('Release was not activated')
      const status = await candidate.status()
      if (status.release !== report.release_id) throw new Error('Release identity changed')
      // Existing requests may finish with their old snapshot; all new requests use the new one.
      corpus = candidate
      save({
        ...state,
        state: 'succeeded',
        phase: null,
        completedFiles: count(report.file_count, state.totalFiles),
        totalFiles: count(report.file_count, state.totalFiles),
        completedBytes: count(report.verified_bytes, state.totalBytes),
        totalBytes: count(report.verified_bytes, state.totalBytes),
        release: report.release_id,
        finishedAt: new Date(now()).toISOString(),
        error: null,
        result: !previous.ready
          ? 'installed'
          : previous.release === report.release_id
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
          ? '语料同步失败，请检查网络和磁盘空间后重试。已安装的语料仍可使用。'
          : '语料下载或校验失败，请检查网络和磁盘空间后重试。',
      })
    }
  }

  const manager = {
    get corpus() {
      return corpus
    },
    status: snapshot,
    async start(mode) {
      if (!['install', 'update'].includes(mode))
        throw new HttpError(400, '同步模式必须为 install 或 update。')
      if (state.state === 'running') return snapshot()
      if (starting) {
        await starting.catch(() => {})
        return manager.start(mode)
      }
      starting = (async () => {
        const previous = await corpus.status()
        if (mode === 'install' && previous.ready)
          throw new HttpError(409, '语料已安装，请使用检查更新与修复。')
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
        const job = ++sequence
        // The job is owned by the process, never by an HTTP request or browser connection.
        setImmediate(() => {
          void run(previous, job).catch(() => {})
        })
        return snapshot()
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
