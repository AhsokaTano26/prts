import {
  ArrowUpRight,
  Plus,
  FileText,
  CheckSquare,
  ListTodo,
  Clock3,
  Pin,
  ArrowRight,
} from 'lucide-react'
import type { Workspace, Task } from '../lib/workspace'
import { relativeTime } from '../lib/workspace'
import type { FocusTimer } from '../lib/useFocusTimer'
import { SectionTitle } from './UI'
import { TaskRow } from './TasksView'
import FocusPanel from './FocusPanel'
import '../styles/amiya.css'

type Props = {
  workspace: Workspace
  timer: FocusTimer
  onNewTask: () => void
  onToggleTask: (id: string) => void
  onEditTask: (t: Task) => void
  onNavigate: (page: string) => void
  onNote: (id: string) => void
}
export default function Overview({
  workspace: w,
  timer,
  onNewTask,
  onToggleTask,
  onEditTask,
  onNavigate,
  onNote,
}: Props) {
  const tasks = w.tasks.filter((t) => !t.done).slice(0, 3)
  const notes = [...w.notes]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 2)
  const stats = [
    {
      label: '待办任务',
      value: w.tasks.filter((t) => !t.done).length,
      icon: ListTodo,
      page: 'tasks',
      sub: 'PENDING',
    },
    {
      label: '已完成',
      value: w.tasks.filter((t) => t.done).length,
      icon: CheckSquare,
      page: 'tasks',
      sub: 'COMPLETED',
    },
    { label: '个人笔记', value: w.notes.length, icon: FileText, page: 'notes', sub: 'ARCHIVED' },
    {
      label: '专注次数',
      value: w.focusSessions,
      icon: Clock3,
      page: 'settings',
      sub: 'FOCUS SESSIONS',
    },
  ]
  return (
    <div className="page-content overview">
      <div className="view-heading">
        <div>
          <h1>
            欢迎回来，博士<span className="heading-dot">。</span>
          </h1>
          <p>
            今天，也向前一步。<span className="welcome-divider">/</span>
            <span className="mono welcome-en">A NEW DAY. A NEW POSSIBILITY.</span>
          </p>
        </div>
        <button className="button button-primary" onClick={onNewTask}>
          <Plus size={17} />
          新建任务
        </button>
      </div>
      <section className="hero-panel hero-panel--amiya">
        <div className="hero-grid" />
        <div className="corner top-left" />
        <div className="corner top-right" />
        <div className="corner bottom-left" />
        <div className="corner bottom-right" />
        <div className="hero-copy">
          <div className="hero-label mono">
            <span />
            RHODES ISLAND
          </div>
          <h2>
            ALL SYSTEMS
            <br />
            <em>READY.</em>
          </h2>
          <p>你的思绪，于此汇集。</p>
          <div className="hero-foot mono">
            <span />
            PERSONAL RHODES ISLAND TERMINAL SYSTEM
          </div>
        </div>
        <figure className="amiya-visual">
          <img
            className="amiya-portrait"
            src="/assets/amiya.png"
            alt="《明日方舟》阿米娅游戏立绘"
            width={1024}
            height={1024}
            loading="eager"
            decoding="async"
            draggable={false}
          />
          <figcaption className="amiya-caption">
            <strong>阿米娅</strong>
            <span className="mono">AMIYA / RHODES ISLAND</span>
          </figcaption>
        </figure>
        <div className="hero-status mono">
          <span>TERMINAL ONLINE</span>
          <strong>
            <i />
            终端已就绪
          </strong>
        </div>
        <div className="hero-index mono">P / 001</div>
      </section>
      <div className="stat-strip">
        {stats.map((s) => (
          <button key={s.label} className="stat" onClick={() => onNavigate(s.page)}>
            <s.icon size={25} strokeWidth={1.2} />
            <div>
              <span>{s.label}</span>
              <strong className={`${s.label === '已完成' ? 'success' : ''} mono`}>
                {String(s.value).padStart(2, '0')}
              </strong>
            </div>
            <span className="stat-sub mono">{s.sub}</span>
            <ArrowUpRight className="stat-arrow" size={13} />
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-main">
          <section className="panel today-panel">
            <SectionTitle
              title="当前任务"
              english="OBJECTIVES"
              action="查看全部"
              onAction={() => onNavigate('tasks')}
            />
            <div className="overview-task-list">
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} onToggle={onToggleTask} onEdit={onEditTask} compact />
              ))}
              {!tasks.length && (
                <div className="small-empty">
                  <CheckSquare size={24} />
                  <p>任务已全部完成，给自己一点休息时间。</p>
                </div>
              )}
            </div>
            <button className="inline-add" onClick={onNewTask}>
              <Plus size={14} />
              添加一个新目标<span className="mono">NEW OBJECTIVE</span>
            </button>
          </section>
          <section className="panel recent-notes">
            <SectionTitle
              title="最近笔记"
              english="RECENT NOTES"
              action="查看全部"
              onAction={() => onNavigate('notes')}
            />
            <div className="note-previews">
              {notes.map((n) => (
                <button key={n.id} className="note-preview" onClick={() => onNote(n.id)}>
                  <div className="note-preview-top">
                    <FileText size={21} strokeWidth={1.3} />
                    <span className="note-tag">{n.tag || '笔记'}</span>
                    {n.pinned && <Pin size={12} />}
                  </div>
                  <h3>{n.title.trim() || '未命名笔记'}</h3>
                  <p>
                    {n.content
                      .replace(/^#+\s.*$/gm, '')
                      .replace(/[*_>#-]/g, '')
                      .trim()
                      .slice(0, 85) || '还没有正文，写下你的第一个想法。'}
                  </p>
                  <div className="note-preview-bottom">
                    <time>{relativeTime(n.updatedAt)}</time>
                    <ArrowUpRight size={16} />
                  </div>
                </button>
              ))}
              {!notes.length && (
                <button className="empty-note" onClick={() => onNavigate('notes')}>
                  <Plus size={20} />
                  记录你的第一个想法
                </button>
              )}
            </div>
          </section>
        </div>
        <div className="dashboard-side">
          <FocusPanel timer={timer} onSettings={() => onNavigate('settings')} />
          <section className="panel activity-panel">
            <SectionTitle title="终端动态" english="ACTIVITY LOG" />
            <div className="activity-list">
              {w.activities.slice(0, 4).map((a) => (
                <div className={`activity-row ${a.type}`} key={a.id}>
                  <i />
                  <p>{a.text}</p>
                  <time>{relativeTime(a.time)}</time>
                </div>
              ))}
              {!w.activities.length && <p className="muted">这里将记录你的每一次进展。</p>}
            </div>
            <div className="activity-bottom mono">
              <span className="live-dot" />
              ALL CHANGES LOGGED
              <ArrowRight size={12} />
            </div>
          </section>
        </div>
      </div>
      <div className="overview-end mono">
        <span>END OF OVERVIEW</span>
        <span>TAKE A BREATH. KEEP MOVING.</span>
      </div>
    </div>
  )
}
