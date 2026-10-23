import { useEffect, useRef, useState } from 'react'
import {
  Search,
  CornerDownLeft,
  Plus,
  FileText,
  ListTodo,
  LayoutDashboard,
  FolderOpen,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { Modal } from './UI'
import type { Workspace } from '../lib/workspace'
import type { WorkspaceFile } from '../lib/files'
export default function CommandPalette({
  workspace,
  files,
  onClose,
  onNavigate,
  onTask,
  onNote,
  onNewTask,
  onNewNote,
}: {
  workspace: Workspace
  files: WorkspaceFile[]
  onClose: () => void
  onNavigate: (page: string) => void
  onTask: (id: string) => void
  onNote: (id: string) => void
  onNewTask: () => void
  onNewNote: () => void
}) {
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState(0),
    input = useRef<HTMLInputElement>(null)
  const actions = [
    { id: 'new-task', title: '新建任务', hint: '快捷操作', icon: Plus, action: onNewTask },
    { id: 'new-note', title: '新建笔记', hint: '快捷操作', icon: Plus, action: onNewNote },
    ...[
      { id: 'overview', title: '总览', icon: LayoutDashboard },
      { id: 'tasks', title: '任务中枢', icon: ListTodo },
      { id: 'notes', title: '个人档案', icon: FileText },
      { id: 'files', title: '文件资料库', icon: FolderOpen },
      { id: 'assistant', title: 'PRTS 助手', icon: Sparkles },
      { id: 'settings', title: '系统设置', icon: Settings2 },
    ].map((x) => ({ ...x, hint: '前往模块', action: () => onNavigate(x.id) })),
  ]
  const q = query.trim().toLowerCase()
  const results = [
    ...actions.filter((a) => !q || a.title.toLowerCase().includes(q)),
    ...(q
      ? workspace.tasks
          .filter((t) => t.title.toLowerCase().includes(q))
          .map((t) => ({
            id: t.id,
            title: t.title,
            hint: t.done ? '已完成任务' : '待办任务',
            icon: ListTodo,
            action: () => onTask(t.id),
          }))
      : []),
    ...(q
      ? workspace.notes
          .filter((n) => (n.title + ' ' + n.content).toLowerCase().includes(q))
          .map((n) => ({
            id: n.id,
            title: n.title,
            hint: '个人笔记',
            icon: FileText,
            action: () => onNote(n.id),
          }))
      : []),
    ...(q
      ? files
          .filter((f) => f.name.toLowerCase().includes(q))
          .map((f) => ({
            id: f.id,
            title: f.name,
            hint: '本地文件',
            icon: FolderOpen,
            action: () => onNavigate('files'),
          }))
      : []),
  ].slice(0, 16)
  useEffect(() => {
    setSelected(0)
  }, [query])
  useEffect(() => {
    document.getElementById(`command-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  function run(index: number) {
    const r = results[index]
    if (r) {
      onClose()
      r.action()
    }
  }
  return (
    <Modal title="终端快速检索" className="command-modal" onClose={onClose}>
      <div className="command-search">
        <Search size={20} />
        <input
          ref={input}
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-autocomplete="list"
          aria-activedescendant={results[selected] ? `command-${selected}` : undefined}
          aria-label="搜索任务、笔记、文件或模块"
          placeholder="搜索任务、笔记、文件或模块…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((i) => Math.min(i + 1, results.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((i) => Math.max(0, i - 1))
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              run(selected)
            }
          }}
        />
        <kbd>ESC</kbd>
      </div>
      <div className="command-results" id="command-results" role="listbox">
        {results.map((r, i) => (
          <button
            id={`command-${i}`}
            role="option"
            aria-selected={i === selected}
            tabIndex={-1}
            className={i === selected ? 'selected' : ''}
            key={r.id}
            onMouseMove={() => setSelected(i)}
            onClick={() => run(i)}
          >
            <r.icon size={17} />
            <span>{r.title}</span>
            <small>{r.hint}</small>
            <CornerDownLeft size={13} />
          </button>
        ))}
        {!results.length && (
          <div className="empty-state">
            <Search size={28} />
            <p>没有找到「{query}」</p>
            <span>换个关键词，或新建一条记录。</span>
          </div>
        )}
      </div>
      <div className="command-footer mono">
        <span>↑ ↓ 选择</span>
        <span>↵ 打开</span>
        <span>PRTS SEARCH SYSTEM</span>
      </div>
    </Modal>
  )
}
