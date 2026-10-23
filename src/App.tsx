import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LayoutDashboard,
  ListTodo,
  FileText,
  FolderOpen,
  Sparkles,
  Settings2,
  Search,
  ChevronRight,
  Menu,
  X,
  Check,
  PanelLeftClose,
  WifiOff,
  LockKeyhole,
} from 'lucide-react'
import {
  makeId,
  validateWorkspace,
  type Workspace,
  type Task,
  type Note,
  type Activity,
  type Settings,
} from './lib/workspace'
import { listFiles, type WorkspaceFile } from './lib/files'
import { useFocusTimer } from './lib/useFocusTimer'
import { createTaskCategory, renameTaskCategory, deleteTaskCategory } from './lib/taskCategories'
import { Logo, Modal } from './components/UI'
import Overview from './components/Overview'
import TasksView, { TaskDialog } from './components/TasksView'
import NotesView from './components/NotesView'
import FilesView from './components/FilesView'
import AssistantView, { type ApiHealth } from './components/AssistantView'
import SettingsView from './components/SettingsView'
import CommandPalette from './components/CommandPalette'
import BootSequence from './components/BootSequence'
import { apiFetch } from './lib/api'
import { useServerStore } from './lib/serverStore'
const navItems = [
  { id: 'overview', label: '总览', en: 'OVERVIEW', icon: LayoutDashboard },
  { id: 'tasks', label: '任务中枢', en: 'TASK CENTER', icon: ListTodo },
  { id: 'notes', label: '个人档案', en: 'ARCHIVES', icon: FileText },
  { id: 'files', label: '文件资料库', en: 'FILE STORAGE', icon: FolderOpen },
  { id: 'assistant', label: 'PRTS 助手', en: 'INTELLIGENCE', icon: Sparkles },
]
const validPages = ['overview', 'tasks', 'notes', 'files', 'assistant', 'settings']
function readPage() {
  const h = location.hash.slice(1)
  return validPages.includes(h) ? h : 'overview'
}
function activity(text: string, type: Activity['type']): Activity {
  return { id: makeId(), text, type, time: new Date().toISOString() }
}
export default function App({ onLock }: { onLock: () => void }) {
  const store = useServerStore()
  const workspace = store.documents.workspace.value
  const preferences = store.documents.preferences.value
  const motionEnabled = preferences.motionEnabled
  const storageError = store.error
  const [page, setPage] = useState(readPage),
    [mobileOpen, setMobileOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [taskDialog, setTaskDialog] = useState<Task | null | undefined>(undefined),
    [newTaskCategoryId, setNewTaskCategoryId] = useState(''),
    [selectedNoteId, setSelectedNoteId] = useState<string | null>(null),
    [toast, setToast] = useState(''),
    [confirmReload, setConfirmReload] = useState(false),
    [files, setFiles] = useState<WorkspaceFile[]>([]),
    [time, setTime] = useState(new Date()),
    [health, setHealth] = useState<ApiHealth>({
      configured: false,
      model: '',
      provider: '',
      reachable: false,
    })
  const [booting, setBooting] = useState(() => {
    try {
      return sessionStorage.getItem('prts-boot-seen') !== '1'
    } catch {
      return true
    }
  })
  const bootTriggerRef = useRef<HTMLElement | null>(null)
  const workspaceRef = useRef(workspace),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mainRef = useRef<HTMLElement>(null),
    drawerRef = useRef<HTMLElement>(null),
    menuRef = useRef<HTMLButtonElement>(null)
  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4500)
  }, [])
  workspaceRef.current = workspace
  const update = useCallback(
    (fn: (w: Workspace) => Workspace, successMessage?: string) => {
      const next = validateWorkspace(fn(workspaceRef.current))
      workspaceRef.current = next
      return store.save('workspace', next).then((saved) => {
        if (saved && successMessage) notify(successMessage)
        return saved
      })
    },
    [notify, store.save],
  )
  const log = useCallback(
    (text: string, type: Activity['type']) =>
      update((w) => ({ ...w, activities: [activity(text, type), ...w.activities].slice(0, 100) })),
    [update],
  )
  useEffect(() => {
    document.documentElement.dataset.motion = motionEnabled ? 'on' : 'off'
  }, [motionEnabled])
  const finishBoot = useCallback(() => {
    setBooting(false)
    try {
      sessionStorage.setItem('prts-boot-seen', '1')
    } catch {
      /* repeat safely on next visit */
    }
    requestAnimationFrame(() => {
      ;(bootTriggerRef.current || mainRef.current)?.focus({ preventScroll: true })
      bootTriggerRef.current = null
    })
  }, [])
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => {
      clearInterval(timer)
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])
  const navigate = useCallback((target: string) => {
    if (!validPages.includes(target)) return
    location.hash = target
    setPage(target)
    setMobileOpen(false)
    mainRef.current?.scrollTo({ top: 0 })
    requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }))
  }, [])
  useEffect(() => {
    const onHash = () => {
      setPage(readPage())
      setMobileOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      }
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  useEffect(() => {
    if (!mobileOpen) return
    const drawer = drawerRef.current
    const buttons = drawer?.querySelectorAll<HTMLButtonElement>('button')
    buttons?.[0]?.focus()
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !buttons?.length) return
      const first = buttons[0],
        last = buttons[buttons.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    drawer?.addEventListener('keydown', trap)
    return () => {
      drawer?.removeEventListener('keydown', trap)
      menuRef.current?.focus()
    }
  }, [mobileOpen])
  const refreshHealth = useCallback(async () => {
    try {
      const r = await apiFetch('/api/health', { signal: AbortSignal.timeout(6000) })
      if (!r.ok) throw new Error()
      const data = await r.json()
      setHealth({
        configured: data.configured === true,
        model: data.model || '',
        provider: data.provider || '',
        reachable: true,
      })
    } catch {
      setHealth({ configured: false, model: '', provider: '', reachable: false })
    }
  }, [])
  const refreshFiles = useCallback(() => {
    listFiles()
      .then(setFiles)
      .catch(() => {
        /* files view surfaces storage error */
      })
  }, [])
  useEffect(() => {
    void refreshHealth()
    refreshFiles()
  }, [refreshHealth, refreshFiles])
  function completeFocus() {
    notify('专注协议完成。辛苦了，博士。')
    if (workspaceRef.current.settings.sound) {
      try {
        const ctx = new AudioContext()
        const oscillator = ctx.createOscillator(),
          gain = ctx.createGain()
        oscillator.connect(gain)
        gain.connect(ctx.destination)
        oscillator.frequency.value = 660
        gain.gain.setValueAtTime(0.07, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
        oscillator.start()
        oscillator.stop(ctx.currentTime + 0.8)
        oscillator.onended = () => void ctx.close()
      } catch {
        /* optional sound */
      }
    }
  }
  const timer = useFocusTimer(workspace.settings.focusMinutes, completeFocus)
  function toggleTask(id: string) {
    update((w) => {
      const task = w.tasks.find((t) => t.id === id)
      if (!task) return w
      return {
        ...w,
        tasks: w.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
        activities: [
          activity(`${task.done ? '恢复了' : '完成了'}「${task.title}」`, 'task'),
          ...w.activities,
        ].slice(0, 100),
      }
    })
  }
  function createTask(title: string) {
    const task: Task = {
      id: makeId(),
      title,
      priority: 'medium',
      categoryId: '',
      dueDate: '',
      done: false,
      createdAt: new Date().toISOString(),
    }
    return update((w) => ({
      ...w,
      tasks: [task, ...w.tasks],
      activities: [activity(`添加了任务「${title}」`, 'task'), ...w.activities].slice(0, 100),
    }))
  }
  function openNewTask(categoryId = '') {
    setNewTaskCategoryId(categoryId)
    setTaskDialog(null)
  }
  function changeTaskCategories(change: (w: Workspace) => Workspace, message: string) {
    try {
      update(
        (w) => ({
          ...change(w),
          activities: [activity(message, 'task'), ...w.activities].slice(0, 100),
        }),
        message,
      )
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : '分类操作失败，请重试。'
    }
  }
  function saveTask(value: Pick<Task, 'title' | 'priority' | 'dueDate' | 'categoryId'>) {
    const editing = taskDialog
    update(
      (w) => ({
        ...w,
        tasks: editing
          ? w.tasks.map((t) => (t.id === editing.id ? { ...t, ...value } : t))
          : [
              { ...value, id: makeId(), createdAt: new Date().toISOString(), done: false },
              ...w.tasks,
            ],
        activities: [
          activity(`${editing ? '更新了' : '添加了'}任务「${value.title}」`, 'task'),
          ...w.activities,
        ].slice(0, 100),
      }),
      editing ? '任务已更新' : '新目标已加入任务中枢',
    )
    setTaskDialog(undefined)
  }
  function changeNotes(notes: Note[]) {
    update((w) => {
      const changed = notes.find((n) => !w.notes.some((old) => old.id === n.id))
      const removed = w.notes.find((n) => !notes.some((next) => next.id === n.id))
      return {
        ...w,
        notes,
        activities: changed
          ? [activity('创建了一篇新笔记', 'note'), ...w.activities].slice(0, 100)
          : removed
            ? [activity(`删除了笔记「${removed.title}」`, 'note'), ...w.activities].slice(0, 100)
            : w.activities,
      }
    })
  }
  function newNote() {
    const note: Note = {
      id: makeId(),
      title: '未命名笔记',
      content: '',
      tag: '随想',
      updatedAt: new Date().toISOString(),
      pinned: false,
    }
    changeNotes([note, ...workspaceRef.current.notes])
    setSelectedNoteId(note.id)
    navigate('notes')
  }
  function openNote(id: string) {
    setSelectedNoteId(id)
    navigate('notes')
  }
  function saveSettings(settings: Settings) {
    void update((w) => ({ ...w, settings }), '个人偏好已保存')
  }
  const currentLabel = navItems.find((n) => n.id === page)?.label || '系统设置'
  return (
    <>
      <div className="app-shell" inert={booting}>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        {mobileOpen && (
          <button
            className="sidebar-overlay"
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <aside
          className={`sidebar ${mobileOpen ? 'is-open' : ''}`}
          ref={drawerRef}
          aria-label="主导航"
          role={mobileOpen ? 'dialog' : undefined}
          aria-modal={mobileOpen ? true : undefined}
        >
          <button
            className="sidebar-close icon-button"
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          >
            <PanelLeftClose size={20} />
          </button>
          <button className="brand" onClick={() => navigate('overview')} aria-label="PRTS 返回总览">
            <Logo />
            <strong>
              PRTS<span>®</span>
            </strong>
            <small className="mono">PERSONAL TERMINAL</small>
          </button>
          <div className="nav-section-label mono">
            WORKSPACE<span>01—05</span>
          </div>
          <nav>
            {navItems.map((n) => (
              <button
                className={`nav-item ${page === n.id ? 'active' : ''}`}
                onClick={() => navigate(n.id)}
                aria-label={n.label}
                aria-current={page === n.id ? 'page' : undefined}
                key={n.id}
              >
                <n.icon size={19} strokeWidth={1.5} />
                <div>
                  {n.label}
                  <span className="mono">{n.en}</span>
                </div>
                {n.id === 'tasks' && (
                  <small className="nav-count mono">
                    {String(workspace.tasks.filter((t) => !t.done).length).padStart(2, '0')}
                  </small>
                )}
                {page === n.id && <span className="nav-active-mark" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-message mono">
              <span className="live-dot" />
              SYSTEM OPERATIONAL<div>思绪有序，自由前行。</div>
            </div>
            <button
              className={`nav-item settings-nav ${page === 'settings' ? 'active' : ''}`}
              onClick={() => navigate('settings')}
              aria-label="系统设置"
              aria-current={page === 'settings' ? 'page' : undefined}
            >
              <Settings2 size={19} strokeWidth={1.5} />
              <div>
                系统设置<span className="mono">PREFERENCES</span>
              </div>
            </button>
            <button
              className="profile-button"
              onClick={() => navigate('settings')}
              aria-label={`个人设置：${workspace.settings.name}`}
            >
              <div className="profile-avatar">
                <Logo small />
              </div>
              <div>
                <strong className="mono">Dr. {workspace.settings.name}</strong>
                <span>罗德岛 · 个人终端</span>
              </div>
              <ChevronRight size={15} />
            </button>
          </div>
        </aside>
        <div className="workspace-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                ref={menuRef}
                className="icon-button mobile-menu"
                onClick={() => setMobileOpen(true)}
                aria-label="打开导航"
                aria-expanded={mobileOpen}
              >
                <Menu size={20} />
              </button>
              <span className="breadcrumb-icon">◈</span>
              <span>工作空间</span>
              <ChevronRight size={12} />
              <strong>{currentLabel}</strong>
            </div>
            <div className="topbar-right">
              <button
                className="icon-button"
                onClick={onLock}
                aria-label="锁定终端"
                title="锁定终端"
              >
                <LockKeyhole size={17} />
              </button>
              <button
                className="global-search"
                onClick={() => setSearchOpen(true)}
                aria-label="搜索任务、笔记或文件"
              >
                <Search size={15} />
                <span>搜索任务、笔记或文件…</span>
                <kbd>⌘ K</kbd>
              </button>
              <div className="topbar-date">
                <span className="mono">
                  {time.toLocaleDateString('en-CA').replaceAll('-', ' / ')}
                </span>
                <small>
                  {time.toLocaleDateString('zh-CN', { weekday: 'long' })}
                  <span className="mono">
                    {time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </small>
              </div>
            </div>
          </header>
          <main
            id="main-content"
            className="main-content"
            ref={mainRef}
            inert={mobileOpen}
            tabIndex={-1}
          >
            {storageError && (
              <div className="storage-warning" role="alert">
                <WifiOff size={16} />
                <span>{storageError}</span>
                <button onClick={store.exportDraft}>下载未保存草稿</button>
                {!store.conflict && <button onClick={store.retry}>重试保存</button>}
                <button onClick={() => setConfirmReload(true)}>重新载入服务器</button>
              </div>
            )}
            {store.recoveryAvailable && (
              <div className="storage-warning">
                <span>上次锁定前有尚未保存的草稿，已保留在当前页面内存中。</span>
                <button
                  disabled={store.saving || Boolean(store.error)}
                  onClick={store.recoverDraft}
                >
                  恢复上次草稿
                </button>
                <button onClick={store.exportRecovery}>下载上次草稿</button>
              </div>
            )}
            {store.legacyAvailable && (
              <div className="storage-warning">
                <span>检测到此浏览器的旧数据，可迁移到服务器。原数据会保留。</span>
                <button onClick={store.showMigration}>迁移浏览器旧数据</button>
              </div>
            )}
            <div
              key={page}
              className={`motion-page ${page === 'assistant' ? 'motion-page-chat' : ''}`}
            >
              {page === 'overview' && (
                <Overview
                  workspace={workspace}
                  timer={timer}
                  onNewTask={() => openNewTask()}
                  onToggleTask={toggleTask}
                  onEditTask={setTaskDialog}
                  onNavigate={navigate}
                  onNote={openNote}
                />
              )}{' '}
              {page === 'tasks' && (
                <TasksView
                  tasks={workspace.tasks}
                  categories={workspace.taskCategories}
                  onNew={openNewTask}
                  onToggle={toggleTask}
                  onEdit={setTaskDialog}
                  onCreateCategory={(name) =>
                    changeTaskCategories(
                      (w) => createTaskCategory(w, name),
                      `已创建分类「${name.trim()}」`,
                    )
                  }
                  onRenameCategory={(id, name) =>
                    changeTaskCategories(
                      (w) => renameTaskCategory(w, id, name),
                      `分类已改名为「${name.trim()}」`,
                    )
                  }
                  onDeleteCategory={(id) =>
                    changeTaskCategories(
                      (w) => deleteTaskCategory(w, id),
                      '分类已删除，任务已移入未分类',
                    )
                  }
                />
              )}{' '}
              {page === 'notes' && (
                <NotesView
                  notes={workspace.notes}
                  onChange={changeNotes}
                  onNotify={notify}
                  selectedNoteId={selectedNoteId}
                  onSelectNote={setSelectedNoteId}
                />
              )}{' '}
              {page === 'files' && (
                <FilesView
                  onNotify={notify}
                  onActivity={(text) => log(text, 'file')}
                  onCountChange={refreshFiles}
                />
              )}{' '}
              {page === 'assistant' && (
                <AssistantView
                  workspace={workspace}
                  health={health}
                  onSettings={() => navigate('settings')}
                  onNewTask={createTask}
                  preferences={preferences.assistant}
                  mode={preferences.assistantMode}
                  onPreferencesChange={(assistant) => {
                    void store.save('preferences', { ...preferences, assistant })
                  }}
                  onModeChange={(assistantMode) => {
                    void store.save('preferences', { ...preferences, assistantMode })
                  }}
                />
              )}{' '}
              {page === 'settings' && (
                <SettingsView
                  workspace={workspace}
                  health={health}
                  onSave={saveSettings}
                  onImport={(data) => {
                    void update(() => data, '工作台备份已导入')
                  }}
                  onNotify={notify}
                  onRefresh={refreshHealth}
                  motionEnabled={motionEnabled}
                  onMotionToggle={() => {
                    void store.save('preferences', {
                      ...preferences,
                      motionEnabled: !motionEnabled,
                    })
                  }}
                  onReplay={() => {
                    bootTriggerRef.current =
                      document.activeElement instanceof HTMLElement ? document.activeElement : null
                    setBooting(true)
                  }}
                />
              )}
            </div>
          </main>
          <footer className="statusbar">
            <span>
              <i className={storageError ? 'error-dot' : 'live-dot'} />
              {storageError
                ? '服务器保存未完成'
                : store.saving
                  ? '正在保存到服务器…'
                  : 'SQLite · 已保存到服务器'}
              <span className="status-divider">/</span>
              <span className="footer-device mono">PERSONAL WORKSPACE</span>
            </span>
            <span className="mono">
              {timer.running && (
                <button onClick={() => navigate('overview')} className="footer-focus">
                  FOCUS {String(Math.floor(timer.remaining / 60)).padStart(2, '0')}:
                  {String(timer.remaining % 60).padStart(2, '0')}
                  <span> / </span>
                </button>
              )}
              PRTS <span className="muted">//</span> v1.0
            </span>
          </footer>
        </div>
        {toast && (
          <div className="toast" role="status">
            <Check size={17} />
            <span>{toast}</span>
            <button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}>
              <X size={14} />
            </button>
          </div>
        )}
        {taskDialog !== undefined && (
          <TaskDialog
            key={taskDialog?.id || `new-${newTaskCategoryId}`}
            task={taskDialog}
            categories={workspace.taskCategories}
            defaultCategoryId={newTaskCategoryId}
            onSave={saveTask}
            onClose={() => setTaskDialog(undefined)}
            onDelete={
              taskDialog
                ? () => {
                    const title = taskDialog.title
                    update(
                      (w) => ({
                        ...w,
                        tasks: w.tasks.filter((t) => t.id !== taskDialog.id),
                        activities: [
                          activity(`删除了任务「${title}」`, 'task'),
                          ...w.activities,
                        ].slice(0, 100),
                      }),
                      '任务已删除',
                    )
                    setTaskDialog(undefined)
                  }
                : undefined
            }
          />
        )}{' '}
        {searchOpen && (
          <CommandPalette
            workspace={workspace}
            files={files}
            onClose={() => setSearchOpen(false)}
            onNavigate={navigate}
            onTask={(id) => {
              setTaskDialog(workspace.tasks.find((t) => t.id === id))
              navigate('tasks')
            }}
            onNote={openNote}
            onNewTask={() => openNewTask()}
            onNewNote={newNote}
          />
        )}
      </div>
      {confirmReload && (
        <Modal title="重新载入服务器数据" onClose={() => setConfirmReload(false)}>
          <p className="modal-copy">
            重新载入会放弃此页面尚未保存的修改。请先下载草稿保留内容，再继续。
          </p>
          <div className="modal-actions">
            <button className="button button-ghost" onClick={store.exportDraft}>
              下载未保存草稿
            </button>
            <button className="button button-ghost" onClick={() => setConfirmReload(false)}>
              取消
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                setConfirmReload(false)
                void store.reload()
              }}
            >
              确认重新载入
            </button>
          </div>
        </Modal>
      )}
      {booting && <BootSequence onComplete={finishBoot} />}
    </>
  )
}
