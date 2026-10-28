import { useCallback, useRef, useState, type FormEvent } from 'react'
import {
  Plus,
  Search,
  Check,
  Pencil,
  Trash2,
  ListFilter,
  ClipboardCheck,
  FolderOpen,
} from 'lucide-react'
import type { Task, TaskCategory } from '../lib/workspace'
import { Modal } from './UI'
import PrtsSelect from './PrtsSelect'
import { PrtsDatePicker, PrtsTimePicker } from './PrtsDateTimePicker'
import TaskCategoriesDialog from './TaskCategoriesDialog'
import { taskLocalDate, taskLocalTime, editedTaskDeadline } from '../lib/reminders'
import { transitionView } from '../lib/motion'
import { useTaskCompletion } from '../lib/useTaskCompletion'
import TaskCompletionCheck from './TaskCompletionCheck'
import '../styles/task-board.css'

const priorityNames = { high: '高优先级', medium: '中优先级', low: '低优先级' }
export function TaskRow({
  task,
  onToggle,
  onEdit,
  compact = false,
}: {
  task: Task
  onToggle: (id: string) => void
  onEdit: (task: Task) => void
  compact?: boolean
}) {
  const localToday = new Date().toLocaleDateString('en-CA')
  const dueDate = taskLocalDate(task)
  const due =
    dueDate === localToday ? '今天' : dueDate ? dueDate.slice(5).replace('-', '/') : '未设日期'
  const overdue =
    !task.done &&
    (task.dueAt ? Date.parse(task.dueAt) < Date.now() : Boolean(dueDate && dueDate < localToday))
  return (
    <div className={`task-row ${task.done ? 'is-done' : ''} ${compact ? 'compact' : ''}`}>
      <button
        className="task-check"
        role="checkbox"
        aria-checked={task.done}
        aria-label={`${task.done ? '恢复' : '完成'}任务：${task.title}`}
        onClick={() => onToggle(task.id)}
      >
        {task.done && <Check size={13} strokeWidth={2.5} />}
      </button>
      <button className="task-title" onClick={() => onEdit(task)}>
        {task.title}
      </button>
      <span className={`priority ${task.priority}`}>
        <i />
        {priorityNames[task.priority]}
      </span>
      <span className={`task-due mono ${overdue ? 'overdue' : ''}`}>
        {overdue ? '已逾期 · ' : ''}
        {due}
        {task.dueAt ? ` ${taskLocalTime(task)}` : ''}
      </span>
      <button
        className="icon-button task-edit"
        aria-label={`编辑任务：${task.title}`}
        onClick={() => onEdit(task)}
      >
        <Pencil size={14} />
      </button>
    </div>
  )
}
export function TaskDialog({
  task,
  categories = [],
  defaultCategoryId = '',
  onSave,
  onDelete,
  onClose,
}: {
  task: Task | null
  categories: TaskCategory[]
  defaultCategoryId?: string
  onSave: (value: Pick<Task, 'title' | 'priority' | 'dueDate' | 'dueAt' | 'categoryId'>) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [priority, setPriority] = useState<Task['priority']>(task?.priority ?? 'medium')
  const [dueDate, setDueDate] = useState(
    task ? taskLocalDate(task) : new Date().toLocaleDateString('en-CA'),
  )
  const [dueTime, setDueTime] = useState(task ? taskLocalTime(task) : '')
  const [timeError, setTimeError] = useState('')
  const [categoryId, setCategoryId] = useState(task?.categoryId ?? defaultCategoryId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const validCategoryId = categories.some((category) => category.id === categoryId)
    ? categoryId
    : ''
  function submit(e: FormEvent) {
    e.preventDefault()
    let dueAt
    try {
      dueAt = editedTaskDeadline(task, dueDate, dueTime)
    } catch (cause) {
      setTimeError(cause instanceof Error ? cause.message : '截止时间无效。')
      return
    }
    if (title.trim())
      onSave({ title: title.trim(), priority, dueDate, dueAt, categoryId: validCategoryId })
  }
  return (
    <Modal title={task ? '编辑任务' : '新建任务'} onClose={onClose} className="task-editor-dialog">
      <form onSubmit={submit}>
        <p className="form-intro mono">MISSION {task ? 'UPDATE' : 'REGISTRATION'} // TASK CENTER</p>
        <label className="form-label" htmlFor="task-title">
          任务内容
        </label>
        <input
          autoFocus
          id="task-title"
          className="field"
          placeholder="接下来，你想完成什么？"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <label className="form-label" htmlFor="task-category">
          任务分类
        </label>
        <PrtsSelect
          id="task-category"
          aria-label="任务分类"
          value={validCategoryId}
          onValueChange={setCategoryId}
          options={[
            { value: '', label: '未分类' },
            ...categories.map((category) => ({ value: category.id, label: category.name })),
          ]}
        />
        <div className="form-row">
          <div>
            <label className="form-label" htmlFor="task-priority">
              优先级
            </label>
            <PrtsSelect
              id="task-priority"
              aria-label="优先级"
              value={priority}
              onValueChange={(value) => setPriority(value as Task['priority'])}
              options={[
                { value: 'high', label: '高优先级' },
                { value: 'medium', label: '中优先级' },
                { value: 'low', label: '低优先级' },
              ]}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="task-date">
              截止日期
            </label>
            <PrtsDatePicker
              id="task-date"
              label="截止日期"
              value={dueDate}
              onValueChange={(value) => {
                setDueDate(value)
                setTimeError('')
              }}
            />
          </div>
        </div>
        <label className="form-label" htmlFor="task-time">
          截止时间（可选）
        </label>
        <PrtsTimePicker
          id="task-time"
          label="截止时间"
          value={dueTime}
          onValueChange={(value) => {
            setDueTime(value)
            setTimeError('')
          }}
        />
        <p className="field-hint">
          按本机时区保存具体时刻；留空则按通知设置时区的当天 23:59 计算。
        </p>
        {timeError && (
          <p role="alert" className="inline-error">
            {timeError}
          </p>
        )}
        <div className="modal-actions">
          {task && onDelete && (
            <button
              type="button"
              className={`button button-ghost danger ${confirmDelete ? 'confirming' : ''}`}
              onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            >
              <Trash2 size={15} />
              {confirmDelete ? '确认删除' : '删除任务'}
            </button>
          )}
          <div className="action-spacer" />
          <button type="button" className="button button-ghost" onClick={onClose}>
            取消
          </button>
          <button className="button button-primary" disabled={!title.trim()} type="submit">
            {task ? '保存修改' : '创建任务'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function TaskCard({
  task,
  onToggle,
  onEdit,
  completing,
  leaving,
}: {
  task: Task
  onToggle: (id: string) => void
  onEdit: (task: Task) => void
  completing: boolean
  leaving: boolean
}) {
  const localToday = new Date().toLocaleDateString('en-CA')
  const dueDate = taskLocalDate(task)
  const overdue =
    !task.done &&
    (task.dueAt ? Date.parse(task.dueAt) < Date.now() : Boolean(dueDate && dueDate < localToday))
  const due = dueDate === localToday ? '今天' : dueDate || '未设日期'
  return (
    <article
      className={`task-card task-completion-target${task.done ? ' is-done' : ''}${completing ? ' is-completing' : ''}${leaving ? ' task-card--leaving' : ''}`}
      data-task-id={task.id}
      data-completing={completing ? 'true' : undefined}
    >
      <div className="task-card-main">
        <TaskCompletionCheck task={task} completing={completing} onToggle={onToggle} />
        <button type="button" className="task-card-title" onClick={() => onEdit(task)}>
          {task.title}
        </button>
        <button
          type="button"
          className="icon-button task-card-edit"
          aria-label={`编辑任务：${task.title}`}
          onClick={() => onEdit(task)}
        >
          <Pencil size={14} />
        </button>
      </div>
      <div className="task-card-meta">
        <span className={`priority ${task.priority}`}>
          <i aria-hidden="true" />
          {priorityNames[task.priority]}
        </span>
        <span className={`task-due mono${overdue ? ' overdue' : ''}`}>
          {overdue ? '已逾期 · ' : ''}
          <time dateTime={task.dueAt || dueDate || undefined}>
            {due}
            {task.dueAt ? ` ${taskLocalTime(task)}` : ''}
          </time>
        </span>
      </div>
    </article>
  )
}

export default function TasksView({
  tasks,
  categories = [],
  onNew,
  onToggle,
  onEdit,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
}: {
  tasks: Task[]
  categories: TaskCategory[]
  onNew: (categoryId?: string) => void
  onToggle: (id: string) => void
  onEdit: (task: Task) => void
  onCreateCategory: (name: string) => string | undefined
  onRenameCategory: (id: string, name: string) => string | undefined
  onDeleteCategory: (id: string) => string | undefined
}) {
  const [filter, setFilter] = useState('pending'),
    [query, setQuery] = useState(''),
    [priority, setPriority] = useState('all')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const requestedView = useRef({
    category: null as string | null,
    filter: 'pending',
    priority: 'all',
  })
  const board = useRef<HTMLDivElement>(null)
  const pendingFilter = useRef<HTMLButtonElement>(null)

  const focusAfterRemoval = useCallback((ids: string[]) => {
    const active = document.activeElement
    if (active instanceof HTMLElement) {
      const card = active.closest<HTMLElement>('.task-card')
      if (card && board.current?.contains(card) && ids.includes(card.dataset.taskId || '')) {
        const cards = Array.from(board.current?.querySelectorAll<HTMLElement>('.task-card') || [])
        const index = cards.indexOf(card)
        const next = [...cards.slice(index + 1), ...cards.slice(0, index).reverse()].find(
          (item) =>
            !item.hasAttribute('data-completing') && !ids.includes(item.dataset.taskId || ''),
        )
        const target =
          next?.querySelector<HTMLButtonElement>('[role="checkbox"]') || pendingFilter.current
        target?.focus({ preventScroll: true })
        if (document.documentElement.dataset.input === 'keyboard')
          target?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
      }
    }
  }, [])

  const beforeCompletionFinish = useCallback(
    (ids: string[]) => {
      if (filter === 'pending') focusAfterRemoval(ids)
    },
    [filter, focusAfterRemoval],
  )
  const { completingIds, toggleWithFeedback } = useTaskCompletion(
    tasks,
    onToggle,
    beforeCompletionFinish,
  )
  function changeView(patch: Partial<typeof requestedView.current>, direction = 1) {
    const previous = requestedView.current
    const next = { ...previous, ...patch }
    if (
      next.category === previous.category &&
      next.filter === previous.filter &&
      next.priority === previous.priority
    )
      return
    requestedView.current = next
    // Commit the whole requested view: independently clicked criteria must compose.
    transitionView(
      () => {
        setSelectedCategory(next.category)
        setFilter(next.filter)
        setPriority(next.priority)
      },
      { scope: 'collection', direction },
    )
  }
  const [manageCategories, setManageCategories] = useState(false)
  const categoryIds = new Set(categories.map((category) => category.id))
  const taskCategory = (task: Task) => (categoryIds.has(task.categoryId) ? task.categoryId : '')
  const currentCategory =
    selectedCategory && !categoryIds.has(selectedCategory) ? null : selectedCategory
  const unclassified: TaskCategory = { id: '', name: '未分类' }
  const allCategories = [...categories, unclassified]
  const categoryCounts = new Map<string, number>()
  for (const task of tasks) {
    const id = taskCategory(task)
    categoryCounts.set(id, (categoryCounts.get(id) || 0) + 1)
  }
  const columns =
    currentCategory === null
      ? [...categories, ...(!categories.length || categoryCounts.has('') ? [unclassified] : [])]
      : allCategories.filter((category) => category.id === currentCategory)
  const scopedTasks =
    currentCategory === null
      ? tasks
      : tasks.filter((task) => taskCategory(task) === currentCategory)
  const visible = scopedTasks
    .filter(
      (t) =>
        (filter === 'all' || (filter === 'done' ? t.done : !t.done || completingIds.has(t.id))) &&
        (priority === 'all' || t.priority === priority) &&
        t.title.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(a.done && !completingIds.has(a.id)) - Number(b.done && !completingIds.has(b.id)) ||
        { high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority],
    )
  return (
    <div className="page-content tasks-page">
      <div className="view-heading">
        <div>
          <div className="page-index mono">01 / TASK CENTER</div>
          <h1>
            任务中枢<span className="heading-dot">.</span>
          </h1>
          <p>把目标分解，让每一步都有方向。</p>
        </div>
        <div className="task-heading-actions">
          <button
            type="button"
            className="button button-ghost"
            onClick={() => setManageCategories(true)}
          >
            <FolderOpen size={16} />
            管理分类
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => onNew(currentCategory ?? '')}
          >
            <Plus size={17} />
            新建任务
          </button>
        </div>
      </div>
      <div className="task-summary">
        <strong>{String(tasks.filter((t) => !t.done).length).padStart(2, '0')}</strong>
        <span>项任务待完成</span>
        <div className="task-progress">
          <span
            style={{
              width: `${tasks.length ? (tasks.filter((t) => t.done).length / tasks.length) * 100 : 0}%`,
            }}
          />
        </div>
        <span className="mono">
          {tasks.filter((t) => t.done).length} / {tasks.length} COMPLETE
        </span>
      </div>
      <nav className="task-category-navigation" aria-label="任务分类视图">
        <div className="task-category-chips" role="group" aria-label="选择任务分类">
          <button
            type="button"
            className="task-category-chip"
            aria-pressed={currentCategory === null}
            onClick={() => changeView({ category: null }, -1)}
          >
            <span className="task-category-chip-name">总栏</span>
            <span className="task-category-chip-count mono" aria-hidden="true">
              {tasks.length}
            </span>
          </button>
          {allCategories.map((category) => (
            <button
              type="button"
              key={category.id}
              className="task-category-chip"
              aria-pressed={currentCategory === category.id}
              onClick={() => changeView({ category: category.id })}
            >
              <span className="task-category-chip-name">{category.name}</span>
              <span className="task-category-chip-count mono" aria-hidden="true">
                {categoryCounts.get(category.id) || 0}
              </span>
            </button>
          ))}
        </div>
      </nav>
      <div className="toolbar">
        <div className="segmented" aria-label="任务状态">
          {[
            ['all', '全部任务'],
            ['pending', '进行中'],
            ['done', '已完成'],
          ].map(([id, label]) => (
            <button
              key={id}
              ref={id === 'pending' ? pendingFilter : undefined}
              aria-pressed={filter === id}
              className={filter === id ? 'active' : ''}
              onClick={() => changeView({ filter: id })}
            >
              {label}
              <span>
                {
                  scopedTasks.filter((t) => id === 'all' || (id === 'done' ? t.done : !t.done))
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <div className="toolbar-controls">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="搜索任务"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索任务…"
            />
          </label>
          <div className="select-field">
            <ListFilter size={16} />
            <PrtsSelect
              aria-label="筛选优先级"
              value={priority}
              onValueChange={(value) => changeView({ priority: value })}
              options={[
                { value: 'all', label: '全部优先级' },
                { value: 'high', label: '高优先级' },
                { value: 'medium', label: '中优先级' },
                { value: 'low', label: '低优先级' },
              ]}
            />
          </div>
        </div>
      </div>
      <p className="task-board-summary" role="status">
        {currentCategory === null ? '总栏' : columns[0]?.name} · 显示 {visible.length} 项任务
      </p>
      {!visible.length && (query.trim() || priority !== 'all' || filter !== 'all') && (
        <p className="task-board-no-results">
          没有找到符合筛选条件的任务，请调整关键词、状态或优先级。
        </p>
      )}
      <div
        ref={board}
        className={`task-board-grid motion-collection${currentCategory !== null ? ' task-board-grid--single' : ''}`}
      >
        {columns.map((category) => {
          const columnTasks = visible.filter((task) => taskCategory(task) === category.id)
          return (
            <section
              className="panel task-board-column"
              key={category.id}
              aria-label={category.id ? `${category.name}分类` : '未分类任务'}
            >
              <header className="task-category-column-heading">
                <div>
                  <h2>{category.name}</h2>
                  <span>{columnTasks.length} 项任务</span>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`新建${category.name}任务`}
                  onClick={() => onNew(category.id)}
                >
                  <Plus size={17} />
                </button>
              </header>
              <div className="task-category-cards">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onToggle={toggleWithFeedback}
                    onEdit={onEdit}
                    completing={completingIds.has(task.id) && task.done}
                    leaving={filter === 'pending' && completingIds.has(task.id) && task.done}
                  />
                ))}
                {!columnTasks.length && (
                  <div className="task-category-empty">
                    <ClipboardCheck size={26} aria-hidden="true" />
                    <p>
                      {categoryCounts.get(category.id)
                        ? '当前筛选下没有任务'
                        : '这个分类还没有任务'}
                    </p>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="task-category-add"
                aria-label={`在${category.name}中添加任务`}
                onClick={() => onNew(category.id)}
              >
                <Plus size={15} />
                添加任务
              </button>
            </section>
          )
        })}
      </div>
      <p className="section-footnote mono">ONE STEP AT A TIME. EVERY OBJECTIVE MATTERS.</p>
      {manageCategories && (
        <TaskCategoriesDialog
          categories={categories}
          onCreate={onCreateCategory}
          onRename={onRenameCategory}
          onDelete={(id) => {
            const error = onDeleteCategory(id)
            if (error === undefined && selectedCategory === id) setSelectedCategory(null)
            return error
          }}
          onClose={() => setManageCategories(false)}
        />
      )}
    </div>
  )
}
