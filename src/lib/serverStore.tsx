import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { apiFetch, WORKSPACE_UPDATED_EVENT } from './api'
import {
  createInitialWorkspace,
  validateWorkspace,
  WORKSPACE_STORAGE_KEY,
  type Workspace,
} from './workspace'
import { parseAssistantPreferences, type AssistantPreferences } from './assistant'
import { listLegacyFiles, type LegacyWorkspaceFile } from './legacyFiles'
import { storeFileRecords } from './files'
import { Modal } from '../components/UI'
import '../styles/server-storage.css'

export type AssistantMode = 'local' | 'ai' | 'knowledge'
export type ServerPreferences = {
  motionEnabled: boolean
  assistant: AssistantPreferences
  assistantMode: AssistantMode
  migratedBrowserIds?: string[]
}
export type FocusState = { remaining: number; endAt: number | null; sessionId: string | null }
export type Values = { workspace: Workspace; preferences: ServerPreferences; focus: FocusState }
type Key = keyof Values
export type Document<T> = { value: T; revision: number }
type Documents = { [K in Key]: Document<Values[K]> | null }
type Loaded = { [K in Key]: Document<Values[K]> }
type Legacy = {
  id: string
  workspace: Workspace | null
  preferences: ServerPreferences
  focus: FocusState | null
  messages: unknown[]
  files: LegacyWorkspaceFile[]
  raw: string | null
  error: string
  available: boolean
}
type Mutation = {
  key: Key
  value: Values[Key]
  expectedRevision?: number
  mutationId: string
  resolve: (saved: boolean) => void
}
type RetainedDraft = {
  id: string
  documents: Documents
  revisions: Record<Key, number>
  mutations: Omit<Mutation, 'resolve'>[]
}
const retainedDrafts = new Map<string, RetainedDraft>()
const warnRetainedDraft = (event: BeforeUnloadEvent) => {
  if (!retainedDrafts.size) return
  event.preventDefault()
  event.returnValue = ''
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', warnRetainedDraft)

type Store = {
  documents: Loaded
  saving: boolean
  error: string
  conflict: boolean
  save: <K extends Key>(key: K, value: Values[K]) => Promise<boolean>
  retry: () => void
  reload: () => Promise<void>
  exportDraft: () => void
  completeFocus: (sessionId: string) => Promise<boolean>
  recoveryAvailable: boolean
  recoverDraft: () => void
  exportRecovery: () => void
  legacyAvailable: boolean
  showMigration: () => void
}
const Context = createContext<Store | null>(null)
const defaults = (): ServerPreferences => ({
  motionEnabled: true,
  assistant: parseAssistantPreferences(null),
  assistantMode: 'local',
})

async function request(path: string, init?: RequestInit) {
  const response = await apiFetch(path, { ...init, signal: AbortSignal.timeout(30_000) })
  const body = await response.json()
  if (!response.ok) {
    const error = new Error(body.error || '服务器保存失败，请检查网络后重试。') as Error & {
      status: number
    }
    error.status = response.status
    throw error
  }
  return body
}

function downloadJSON(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], {
      type: 'application/json',
    }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function readLegacy(): Promise<Legacy> {
  let raw: string | null = null
  let workspace: Workspace | null = null
  const preferences = defaults()
  let focus: FocusState | null = null
  let messages: unknown[] = []
  let files: LegacyWorkspaceFile[] = []
  let error = ''
  let hasPreferences = false
  try {
    raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (raw) {
      try {
        workspace = validateWorkspace(JSON.parse(raw))
      } catch {
        error = '旧工作台数据无法解析，原文仍保留在浏览器，可先下载恢复。'
      }
    }
    const assistant = localStorage.getItem('prts-assistant-v1')
    const motion = localStorage.getItem('prts-motion')
    const mode = sessionStorage.getItem('prts-assistant-mode')
    hasPreferences = Boolean(assistant || motion || mode)
    if (assistant) {
      try {
        preferences.assistant = parseAssistantPreferences(JSON.parse(assistant))
      } catch {
        /* preserve defaults */
      }
    }
    if (motion) preferences.motionEnabled = motion !== 'off'
    if (mode === 'local' || mode === 'ai' || mode === 'knowledge') preferences.assistantMode = mode
    try {
      const old = JSON.parse(localStorage.getItem('prts-focus-v1') || 'null')
      if (
        old &&
        Number.isFinite(old.remaining) &&
        old.remaining >= 0 &&
        old.remaining <= 10800 &&
        (old.endAt === null || Number.isFinite(old.endAt))
      )
        focus = {
          remaining: old.remaining,
          endAt: old.endAt,
          sessionId: old.endAt ? crypto.randomUUID() : null,
        }
    } catch {
      /* invalid legacy timer does not replace valid server state */
    }
    try {
      const old = JSON.parse(sessionStorage.getItem('prts-chat-v1') || '[]')
      if (Array.isArray(old))
        messages = old.filter(
          (m) =>
            m &&
            !m.pending &&
            typeof m.id === 'string' &&
            typeof m.content === 'string' &&
            ['user', 'assistant'].includes(m.role) &&
            ['local', 'ai'].includes(m.mode),
        )
    } catch {
      /* invalid legacy chat remains in browser */
    }
  } catch {
    error = '无法读取浏览器旧数据，请检查浏览器存储权限后重试迁移。'
  }
  try {
    // Avoid creating a new IndexedDB for browsers that never had a file library.
    const databases =
      typeof indexedDB?.databases === 'function' ? await indexedDB.databases() : null
    if (databases === null || databases.some((db) => db.name === 'prts-files-v1'))
      files = await listLegacyFiles()
  } catch {
    error = '无法读取浏览器旧文件，请关闭占用文件库的页面后重试迁移。'
  }
  const fingerprint = JSON.stringify({
    raw,
    preferences,
    focus: focus && { remaining: focus.remaining, endAt: focus.endAt },
    messages,
    files: files.map((f) => ({ id: f.id, size: f.size, name: f.name })),
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint))
  const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
  return {
    id,
    workspace,
    preferences,
    focus,
    messages,
    files,
    raw,
    error,
    available: Boolean(raw || hasPreferences || focus || messages.length || files.length),
  }
}

export function useServerStore() {
  const store = useContext(Context)
  if (!store) throw new Error('服务器工作台尚未载入。')
  return store
}

export default function ServerStoreProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<Documents | null>(null)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  const [legacy, setLegacy] = useState<Legacy | null>(null)
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [migrationBusy, setMigrationBusy] = useState(false)
  const [migrationStatus, setMigrationStatus] = useState('')
  const [initializing, setInitializing] = useState(false)
  const [recoveries, setRecoveries] = useState(() => [...retainedDrafts.values()])
  const restoringId = useRef<string | null>(null)
  const records = useRef<Documents | null>(null)
  const revisions = useRef<Record<Key, number>>({ workspace: 0, preferences: 0, focus: 0 })
  const queue = useRef<Mutation[]>([])
  const processing = useRef(false)
  const stopped = useRef(false)
  const conflicted = useRef(false)
  const generation = useRef(0)
  const mutationEpoch = useRef(0)
  const active = useRef(true)
  const migrationInFlight = useRef(false)
  const migrationAttempt = useRef<{
    sourceId: string
    documents: Partial<Values> & { preferences: ServerPreferences }
    expectedRevisions: Record<Key, number>
    mutationId: string
  } | null>(null)

  const apply = useCallback((next: Documents) => {
    records.current = next
    revisions.current = {
      workspace: next.workspace?.revision || 0,
      preferences: next.preferences?.revision || 0,
      focus: next.focus?.revision || 0,
    }
    setDocuments(next)
  }, [])

  const load = useCallback(async () => {
    const version = ++generation.current
    try {
      const [data, previous] = await Promise.all([
        request('/api/state', { cache: 'no-store' }),
        readLegacy(),
      ])
      if (!active.current || version !== generation.current) return
      const next = data.documents as Documents
      if (!next || !('workspace' in next) || !('preferences' in next) || !('focus' in next))
        throw new Error('服务器数据格式异常，未进行任何覆盖。')
      if (next.workspace) next.workspace.value = validateWorkspace(next.workspace.value)
      apply(next)
      migrationAttempt.current = null
      setLegacy(previous)
      setRecoveries([...retainedDrafts.values()])
      setError('')
      setConflict(false)
      stopped.current = false
      conflicted.current = false
    } catch (cause) {
      if (active.current && version === generation.current)
        setError(cause instanceof Error ? cause.message : '无法连接数据库，请重试。')
    }
  }, [apply])

  useEffect(() => {
    active.current = true
    void load()
    return () => {
      active.current = false
      ++generation.current
      if (queue.current.length && records.current) {
        const id = restoringId.current || queue.current[0].mutationId
        retainedDrafts.set(id, {
          id,
          documents: structuredClone(records.current),
          revisions: { ...revisions.current },
          mutations: queue.current.map(({ resolve: _resolve, ...entry }) => structuredClone(entry)),
        })
      }
      for (const entry of queue.current) entry.resolve(false)
    }
  }, [load])

  const process = useCallback(async () => {
    if (processing.current || stopped.current) return
    processing.current = true
    setSaving(true)
    while (queue.current.length && !stopped.current && active.current) {
      const entry = queue.current[0]
      entry.expectedRevision ??= revisions.current[entry.key]
      try {
        const result = await request(`/api/state/${entry.key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            value: entry.value,
            expectedRevision: entry.expectedRevision,
            mutationId: entry.mutationId,
          }),
        })
        revisions.current[entry.key] = result.revision
        queue.current.shift()
        entry.resolve(true)
        if (records.current) {
          const current = records.current[entry.key]
          if (current) {
            const next = {
              ...records.current,
              [entry.key]: { ...current, revision: result.revision },
            }
            records.current = next
            if (active.current) setDocuments(next)
          }
        }
      } catch (cause) {
        const isConflict = (cause as { status?: number }).status === 409
        stopped.current = true
        conflicted.current = isConflict
        setConflict(isConflict)
        setError(
          isConflict
            ? '另一台设备已更新这些数据。当前草稿已保留，请下载草稿后重新载入服务器数据。'
            : cause instanceof Error
              ? cause.message
              : '服务器保存失败，当前草稿尚未保存。',
        )
        for (const item of queue.current) {
          item.resolve(false)
          item.resolve = () => {}
        }
      }
    }
    processing.current = false
    if (!queue.current.length && restoringId.current) {
      retainedDrafts.delete(restoringId.current)
      restoringId.current = null
      if (active.current) setRecoveries([...retainedDrafts.values()])
    }
    if (active.current) setSaving(false)
  }, [])

  const save = useCallback(
    <K extends Key>(key: K, value: Values[K]): Promise<boolean> => {
      if (!records.current) return Promise.resolve(false)
      ++mutationEpoch.current
      const next = { ...records.current, [key]: { value, revision: revisions.current[key] } }
      records.current = next
      setDocuments(next)
      return new Promise((resolve) => {
        const pending = queue.current.at(-1)
        const complete = stopped.current ? () => {} : resolve
        if (pending?.key === key && pending.expectedRevision === undefined) {
          // A newer snapshot includes the previous edit; keep only the unsent one.
          pending.value = value
          const previous = pending.resolve
          pending.resolve = (saved) => {
            previous(saved)
            complete(saved)
          }
        } else {
          queue.current.push({ key, value, mutationId: crypto.randomUUID(), resolve: complete })
        }
        if (stopped.current) resolve(false)
        else void process()
      })
    },
    [process],
  )

  const retry = useCallback(() => {
    if (conflicted.current) return
    stopped.current = false
    setError('')
    void process()
  }, [process])

  const reload = useCallback(async () => {
    if (processing.current) return
    for (const entry of queue.current) entry.resolve(false)
    queue.current = []
    records.current = null
    setDocuments(null)
    await load()
  }, [load])

  const recoverDraft = () => {
    const recovery = recoveries[0]
    if (!recovery || !records.current || processing.current || queue.current.length) return
    const next = { ...records.current }
    for (const key of new Set(recovery.mutations.map((entry) => entry.key))) {
      Object.assign(next, { [key]: recovery.documents[key] })
      revisions.current[key] = recovery.revisions[key]
    }
    records.current = next
    setDocuments(next)
    queue.current = recovery.mutations.map((entry) => ({ ...entry, resolve: () => {} }))
    restoringId.current = recovery.id
    stopped.current = false
    conflicted.current = false
    setConflict(false)
    setError('')
    void process()
  }

  const initialize = async (useLegacy: boolean) => {
    if (!records.current || initializing) return
    setInitializing(true)
    setError('')
    try {
      let previous = legacy
      if (useLegacy) {
        previous = await readLegacy()
        setLegacy(previous)
        if (previous.error) throw new Error(previous.error)
      }
      if (useLegacy) {
        await migrate(previous)
        return
      }
      const workspace = createInitialWorkspace()
      if (!records.current.workspace && !(await save('workspace', workspace))) return
      if (
        !records.current.preferences &&
        !(await save('preferences', useLegacy && previous ? previous.preferences : defaults()))
      )
        return
      if (
        !records.current.focus &&
        !(await save(
          'focus',
          useLegacy && previous?.focus
            ? previous.focus
            : { remaining: workspace.settings.focusMinutes * 60, endAt: null, sessionId: null },
        ))
      )
        return
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '初始化失败，请重试。')
    } finally {
      setInitializing(false)
    }
  }

  async function migrate(previous = legacy) {
    if (!previous || !records.current || migrationInFlight.current || queue.current.length) return
    migrationInFlight.current = true
    ++mutationEpoch.current
    setMigrationBusy(true)
    setMigrationStatus('正在迁移浏览器数据…')
    try {
      if (previous.error) throw new Error(previous.error)
      if (!migrationAttempt.current) {
        const current = records.current
        const workspace = previous.workspace || current.workspace?.value || createInitialWorkspace()
        const migratedBrowserIds = [
          ...new Set([...(current.preferences?.value.migratedBrowserIds || []), previous.id]),
        ].slice(-100)
        migrationAttempt.current = {
          sourceId: previous.id,
          documents: {
            ...(previous.workspace || !current.workspace ? { workspace } : {}),
            preferences: { ...previous.preferences, migratedBrowserIds },
            ...(previous.focus || !current.focus
              ? {
                  focus: previous.focus || {
                    remaining: workspace.settings.focusMinutes * 60,
                    endAt: null,
                    sessionId: null,
                  },
                }
              : {}),
          },
          expectedRevisions: { ...revisions.current },
          mutationId: crypto.randomUUID(),
        }
      }
      const attempt = migrationAttempt.current
      if (attempt.sourceId !== previous.id)
        throw new Error('浏览器旧数据已变化，请重新载入后再次确认迁移。')
      for (let index = 0; index < previous.files.length; index++) {
        setMigrationStatus(`正在迁移文件 ${index + 1} / ${previous.files.length}…`)
        await storeFileRecords([previous.files[index]])
      }
      if (previous.messages.length)
        await request('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: previous.messages }),
        })
      setMigrationStatus('正在确认服务器版本并保存工作台…')
      const result = await request('/api/state/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: attempt.documents,
          expectedRevisions: attempt.expectedRevisions,
          mutationId: attempt.mutationId,
        }),
      })
      apply(result.documents as Documents)
      migrationAttempt.current = null
      setMigrationStatus('迁移完成，原浏览器数据已保留。')
      setMigrationOpen(false)
      setMountVersion((v) => v + 1)
    } catch (cause) {
      const isConflict = (cause as { status?: number }).status === 409
      const message = isConflict
        ? '迁移期间服务器数据已变化，工作台未被替换。已上传的文件和对话会保留，请取消后重新载入服务器，再决定是否导入。'
        : cause instanceof Error
          ? `迁移未完成：${cause.message}。原数据已保留，可以重试。`
          : '迁移中断，原数据已保留，可以重试。'
      setMigrationStatus(message)
      setMigrationOpen(true)
      if (isConflict) {
        setError(message)
        setConflict(true)
        conflicted.current = true
        stopped.current = true
      }
    } finally {
      migrationInFlight.current = false
      setMigrationBusy(false)
    }
  }

  const completeFocus = useCallback(
    async (sessionId: string) => {
      // A queued snapshot must reach the server before the atomic completion mutates it.
      if (
        queue.current.length ||
        processing.current ||
        stopped.current ||
        migrationInFlight.current
      )
        return false
      const epoch = mutationEpoch.current
      try {
        const result = await request('/api/focus/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        if (!records.current) return false
        if (
          mutationEpoch.current !== epoch ||
          queue.current.some((item) => item.key === 'workspace' || item.key === 'focus')
        ) {
          stopped.current = true
          conflicted.current = true
          setConflict(true)
          setError('专注完成时存在其他编辑，请保留草稿并重新载入服务器数据。')
          return false
        }
        apply({ ...records.current, ...result.documents })
        return result.completed === true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '专注完成尚未同步，请重试。')
        return false
      }
    },
    [apply],
  )

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!queue.current.length && !processing.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    const refresh = async () => {
      if (
        migrationInFlight.current ||
        document.visibilityState !== 'visible' ||
        !records.current?.workspace ||
        queue.current.length ||
        processing.current ||
        stopped.current
      )
        return
      const version = generation.current
      const epoch = mutationEpoch.current
      try {
        const result = await request('/api/state', { cache: 'no-store' })
        if (
          !active.current ||
          generation.current !== version ||
          mutationEpoch.current !== epoch ||
          queue.current.length ||
          processing.current ||
          stopped.current
        )
          return
        const next = result.documents as Documents
        if (!next?.workspace || !next.preferences || !next.focus) return
        next.workspace.value = validateWorkspace(next.workspace.value)
        apply(next)
      } catch {
        /* A failed background refresh must not replace the loaded workspace. */
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('focus', refresh)
    window.addEventListener(WORKSPACE_UPDATED_EVENT, refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(WORKSPACE_UPDATED_EVENT, refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [apply])

  const [mountVersion, setMountVersion] = useState(0)
  const legacyAvailable = Boolean(
    legacy?.available && !documents?.preferences?.value.migratedBrowserIds?.includes(legacy.id),
  )
  const ready =
    Boolean(documents?.workspace && documents.preferences && documents.focus) &&
    !initializing &&
    !migrationBusy
  const store: Store | null = ready
    ? {
        documents: documents as Loaded,
        saving,
        error,
        conflict,
        save,
        retry,
        reload,
        exportDraft: () =>
          downloadJSON(
            Object.fromEntries(
              Object.entries(records.current || {}).map(([key, record]) => [key, record?.value]),
            ),
            'prts-unsaved-draft.json',
          ),
        completeFocus,
        recoveryAvailable: recoveries.length > 0,
        recoverDraft,
        exportRecovery: () => {
          const recovery = recoveries[0]
          if (recovery)
            downloadJSON(
              Object.fromEntries(
                Object.entries(recovery.documents).map(([key, record]) => [key, record?.value]),
              ),
              'prts-recovered-draft.json',
            )
        },
        legacyAvailable,
        showMigration: () => {
          setMigrationStatus('')
          setMigrationOpen(true)
        },
      }
    : null

  if (!store)
    return (
      <div className="server-loading" role="status">
        <div className="panel server-loading-panel">
          <p className="mono">PRTS / DATABASE CONNECTION</p>
          <h1>
            {migrationBusy
              ? '迁移浏览器旧数据'
              : documents
                ? '初始化服务器工作台'
                : '连接服务器数据库'}
          </h1>
          {error && <p role="alert">{error}</p>}
          {!documents ? (
            <>
              <p>确认数据已载入后即可进入终端。</p>
              <button className="button button-primary" onClick={() => void load()}>
                重新连接
              </button>
            </>
          ) : (
            <>
              <p>
                {legacyAvailable
                  ? '检测到此浏览器中的旧数据。可以迁移到服务器，原数据会保留。'
                  : '服务器尚未建立工作台，创建后即可在其他设备登录访问。'}
              </p>
              {legacy?.error && <p role="alert">{legacy.error}</p>}
              <div className="modal-actions">
                {legacyAvailable && (
                  <button
                    disabled={initializing || migrationBusy || saving}
                    className="button button-primary"
                    onClick={() => void initialize(true)}
                  >
                    迁移浏览器数据并进入
                  </button>
                )}
                <button
                  disabled={initializing || migrationBusy || saving}
                  className="button button-ghost"
                  onClick={() => void initialize(false)}
                >
                  创建服务器工作台
                </button>
                {legacy?.raw && (
                  <button
                    className="button button-ghost"
                    onClick={() => downloadJSON(legacy.raw, 'prts-browser-original.json')}
                  >
                    下载旧数据原文
                  </button>
                )}
                {error && !conflict && (
                  <button className="button button-ghost" onClick={retry}>
                    重试保存
                  </button>
                )}
                {error && (
                  <button className="button button-ghost" onClick={() => void reload()}>
                    重新载入
                  </button>
                )}
              </div>
              {migrationStatus && <p>{migrationStatus}</p>}
            </>
          )}
        </div>
      </div>
    )
  return (
    <Context.Provider value={store}>
      <div key={mountVersion}>{children}</div>
      {migrationOpen && (
        <Modal
          title="迁移浏览器旧数据"
          onClose={() => {
            if (!migrationBusy) setMigrationOpen(false)
          }}
        >
          <p className="modal-copy">
            将迁移 {legacy?.workspace?.tasks.length || 0} 项任务、
            {legacy?.workspace?.notes.length || 0} 篇笔记、{legacy?.files.length || 0} 个文件和{' '}
            {legacy?.messages.length || 0} 条对话。
          </p>
          <p className="modal-copy">
            旧工作台及偏好将替换服务器中的对应内容；文件与对话按 ID
            合并。建议先导出服务器工作台备份。原浏览器数据会保留，迁移中断后可以重试。
          </p>
          {legacy?.error && <p role="alert">{legacy.error}</p>}
          {migrationStatus && <p role="status">{migrationStatus}</p>}
          <div className="modal-actions">
            <button
              disabled={migrationBusy}
              className="button button-ghost"
              onClick={() => setMigrationOpen(false)}
            >
              取消
            </button>
            <button
              disabled={migrationBusy || saving || Boolean(error)}
              className="button button-primary"
              onClick={() => void migrate()}
            >
              确认迁移并替换工作台
            </button>
            {legacy?.raw && (
              <button
                className="button button-ghost"
                onClick={() => downloadJSON(legacy.raw, 'prts-browser-original.json')}
              >
                下载旧数据原文
              </button>
            )}
          </div>
        </Modal>
      )}
    </Context.Provider>
  )
}
