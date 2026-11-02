import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowRight, Grid2X2, Plus, Search, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import type { Priority, Task, TaskCategory } from '../lib/workspace'
import {
  buildTaskMatrix,
  matrixHash,
  parseMatrixOptions,
  QUADRANTS,
  taskMarkerColor,
  type MatrixOptions,
  type MatrixPoint,
  type QuadrantId,
} from '../lib/taskMatrix'
import { sortTasks } from '../lib/taskSorting'
import { taskDeadline } from '../lib/reminders'
import PrtsSelect from './PrtsSelect'
import '../styles/task-quadrants.css'

const priorityNames: Record<Priority, string> = {
  high: '高优先级',
  medium: '中优先级',
  low: '低优先级',
}
type Selection =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'quadrant'; quadrant: QuadrantId }
  | { kind: 'undated'; priority: Priority }
  | null

function TaskDot({ task, overdue }: { task: Task; overdue: boolean }) {
  return (
    <span
      className={`matrix-dot${overdue ? ' matrix-dot-overdue' : ''}`}
      data-task-id={task.id}
      aria-hidden="true"
      style={{ '--task-color': taskMarkerColor(task.id) } as CSSProperties}
    />
  )
}

export default function TaskQuadrantsView({
  tasks,
  categories,
  now,
  onNew,
  onEdit,
  onToggle,
}: {
  tasks: Task[]
  categories: TaskCategory[]
  now: number
  onNew: () => void
  onEdit: (task: Task) => void
  onToggle: (id: string) => void
}) {
  const [options, setOptions] = useState(() => parseMatrixOptions(location.hash))
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<Selection>(null)
  const [listPage, setListPage] = useState(0)
  const [columns, setColumns] = useState(12)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const plot = useRef<HTMLDivElement>(null)
  const inspector = useRef<HTMLElement>(null)
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const format = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    [timeZone],
  )
  const axisFormat = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    [timeZone],
  )
  useEffect(() => {
    const read = () => {
      setOptions(parseMatrixOptions(location.hash))
      setSelection(null)
      setListPage(0)
    }
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  useEffect(() => {
    if (!plot.current) return
    const measure = () =>
      setColumns(Math.max(2, Math.floor((plot.current?.clientWidth || 480) / 52)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(plot.current)
    return () => observer.disconnect()
  }, [])
  const filtered = useMemo(
    () =>
      tasks.filter((task) =>
        `${task.title}\n${task.description || ''}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      ),
    [tasks, query],
  )
  const pendingCount = useMemo(() => tasks.filter((task) => !task.done).length, [tasks])
  const model = useMemo(
    () => buildTaskMatrix(filtered, { ...options, now, timeZone, columns }),
    [filtered, options, now, timeZone, columns],
  )
  const selectedIds = useMemo(() => {
    if (!selection) return null
    if (selection.kind === 'ids') return new Set(selection.ids)
    const items =
      selection.kind === 'undated'
        ? model.undated.filter((task) => task.priority === selection.priority)
        : model.points
            .filter((point) => point.quadrant === selection.quadrant)
            .flatMap((point) => point.tasks)
    return new Set(items.map((task) => task.id))
  }, [selection, model])
  const selectionLabel = !selection
    ? '全部可见任务'
    : selection.kind === 'quadrant'
      ? QUADRANTS.find((quadrant) => quadrant.id === selection.quadrant)?.title
      : selection.kind === 'undated'
        ? `未设截止 · ${priorityNames[selection.priority]}`
        : '所选任务'
  const details = useMemo(
    () =>
      sortTasks(
        model.tasks.filter((task) => !selectedIds || selectedIds.has(task.id)),
        timeZone,
      ),
    [model.tasks, selectedIds, timeZone],
  )
  const lastPage = Math.max(0, Math.ceil(details.length / 20) - 1)
  const page = Math.min(listPage, lastPage)
  const shown = details.slice(page * 20, (page + 1) * 20)
  const select = (next: Selection) => {
    setSelection(next)
    setListPage(0)
    if (matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => {
        inspector.current?.focus({ preventScroll: true })
        inspector.current?.scrollIntoView({ block: 'start' })
      })
    }
  }
  const reset = () => {
    setSelection(null)
    setListPage(0)
  }
  function changeOptions(update: Partial<MatrixOptions>) {
    const next = { ...options, ...update }
    setOptions(next)
    reset()
    history.replaceState(history.state, '', matrixHash(next))
  }
  function pointName(point: MatrixPoint) {
    return point.tasks.length === 1
      ? `查看任务：${point.tasks[0].title}，${priorityNames[point.priority]}，截止 ${format.format(point.deadlineStart)}${point.overdueCount ? '，已逾期' : ''}`
      : `查看聚合任务：${priorityNames[point.priority]}，${point.tasks.length} 项，截止 ${format.format(point.deadlineStart)} 至 ${format.format(point.deadlineEnd)}${point.overdueCount ? `，含 ${point.overdueCount} 项已逾期` : ''}`
  }
  const undated = model.undated
  return (
    <div className="page-content matrix-page">
      <div className="view-heading">
        <div>
          <div className="page-index mono">PRIORITY × DEADLINE</div>
          <h1>
            四象限法<span className="heading-dot">.</span>
          </h1>
          <p>把截止时间和优先级放在一起，找到眼下值得先做的事。</p>
        </div>
        <button className="button button-primary" onClick={onNew}>
          <Plus size={17} />
          新建任务
        </button>
      </div>
      <button
        type="button"
        className="matrix-filter-toggle"
        aria-expanded={filtersOpen}
        aria-controls="matrix-controls"
        onClick={() => setFiltersOpen(!filtersOpen)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        筛选与界线
        <span>{filtersOpen ? '收起' : '展开'}</span>
      </button>
      <section
        id="matrix-controls"
        className={`matrix-controls panel${filtersOpen ? ' is-open' : ''}`}
        aria-label="四象限筛选"
      >
        <label className="matrix-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">搜索四象限任务</span>
          <input
            type="search"
            value={query}
            placeholder="搜索任务…"
            onChange={(event) => {
              setQuery(event.target.value)
              reset()
            }}
          />
        </label>
        <label>
          <span>紧急范围</span>
          <PrtsSelect
            aria-label="紧急范围"
            value={String(options.urgentDays)}
            onValueChange={(value) =>
              changeOptions({ urgentDays: Number(value) as MatrixOptions['urgentDays'] })
            }
            options={[
              { value: '1', label: '24 小时内' },
              { value: '3', label: '3 天内' },
              { value: '7', label: '7 天内' },
              { value: '14', label: '14 天内' },
            ]}
          />
        </label>
        <label>
          <span>重要界线</span>
          <PrtsSelect
            aria-label="重要界线"
            value={options.importantPriority}
            onValueChange={(value) =>
              changeOptions({ importantPriority: value as MatrixOptions['importantPriority'] })
            }
            options={[
              { value: 'high', label: '高优先级' },
              { value: 'medium', label: '中及以上' },
            ]}
          />
        </label>
      </section>
      <div className="matrix-summary">
        <span>
          <strong>{model.tasks.length}</strong> / {pendingCount} 项未完成任务
        </span>
        {model.overdueIds.size > 0 && (
          <span className="matrix-overdue-summary">
            <TriangleAlert size={14} aria-hidden="true" />
            已逾期 {model.overdueIds.size} 项
          </span>
        )}
        <span>
          紧急界线：{format.format(model.cutoff)} · {timeZone}
        </span>
      </div>
      <div className="matrix-layout">
        <section className="matrix-chart panel" aria-labelledby="matrix-chart-heading">
          <div className="matrix-chart-heading">
            <h2 id="matrix-chart-heading">任务坐标</h2>
            <span className="mono">优先级 ↑</span>
          </div>
          <div className="matrix-canvas">
            <div className="matrix-y-labels" aria-hidden="true">
              {(['high', 'medium', 'low'] as const).map((priority) => (
                <span key={priority} style={{ top: `${model.priorityY[priority]}%` }}>
                  {priorityNames[priority][0]}
                </span>
              ))}
            </div>
            <div
              ref={plot}
              className="matrix-plot"
              role="group"
              aria-label="截止时间与优先级坐标图"
              aria-describedby="matrix-help"
            >
              <div className="matrix-zones">
                {QUADRANTS.map((quadrant, index) => (
                  <div key={quadrant.id} className={`matrix-zone matrix-zone-${quadrant.id}`}>
                    <button
                      type="button"
                      className="matrix-zone-heading"
                      aria-label={`查看${quadrant.title}任务，${model.counts[quadrant.id]} 项`}
                      onClick={() => select({ kind: 'quadrant', quadrant: quadrant.id })}
                    >
                      <span className="mono">0{index + 1}</span>
                      <strong>{quadrant.title}</strong>
                      <span>{model.counts[quadrant.id]}</span>
                      <small>{quadrant.description}</small>
                    </button>
                  </div>
                ))}
              </div>
              {model.points.map((point) => (
                <Fragment key={point.id}>
                  {point.labelY !== point.y && (
                    <span
                      className="matrix-connector"
                      aria-hidden="true"
                      style={{
                        left: `${point.x}%`,
                        top: `${point.y}%`,
                        height: `${point.labelY - point.y}%`,
                      }}
                    />
                  )}
                  <button
                    type="button"
                    className={`matrix-point${point.tasks.length > 1 ? ' matrix-point-group' : ''}${point.overdueCount ? ' matrix-point-overdue' : ''}`}
                    style={{ left: `${point.x}%`, top: `${point.labelY}%` }}
                    aria-label={pointName(point)}
                    title={pointName(point)}
                    aria-pressed={Boolean(
                      selectedIds && point.tasks.some((task) => selectedIds.has(task.id)),
                    )}
                    onClick={() => select({ kind: 'ids', ids: point.tasks.map((task) => task.id) })}
                  >
                    <span className="matrix-dot-cluster" aria-hidden="true">
                      {point.tasks.slice(0, 4).map((task) => (
                        <TaskDot
                          key={task.id}
                          task={task}
                          overdue={model.overdueIds.has(task.id)}
                        />
                      ))}
                    </span>
                    {point.overdueCount > 0 && (
                      <span className="matrix-point-alert" aria-hidden="true">
                        !
                      </span>
                    )}
                  </button>
                </Fragment>
              ))}
              {!model.points.length && (
                <div className="matrix-plot-empty">
                  <Grid2X2 size={26} />
                  <strong>
                    {!model.tasks.length
                      ? pendingCount
                        ? '没有符合筛选的任务'
                        : tasks.length
                          ? '没有待处理任务'
                          : '还没有任务'
                      : '这些任务还没有截止时间'}
                  </strong>
                  <span>
                    {model.tasks.length
                      ? '在下方未设截止时间区域选择任务，补充日期后即可定位。'
                      : tasks.length && !pendingCount
                        ? '已完成任务保留在任务中枢；未完成任务会显示在这里。'
                        : '新建任务或调整筛选后，可在这里查看它们的位置。'}
                  </span>
                </div>
              )}
            </div>
            <div className="matrix-x-labels" aria-hidden="true">
              <span>{axisFormat.format(model.min)}</span>
              <span>紧急界线</span>
              <span>{axisFormat.format(model.max)}</span>
            </div>
          </div>
          <div className="matrix-axis-caption">
            <span>截止更早</span>
            <span>
              截止时间 <ArrowRight size={15} />
            </span>
            <span>截止更晚</span>
          </div>
          <p className="matrix-help" id="matrix-help">
            四个象限固定等大，彩色圆点与明细中的任务颜色对应。按真实截止时间定位，密集点簇显示代表色，
            点击圆点查看任务明细，再点击明细中的任务标题编辑。仅显示未完成任务，红色外圈和 !
            表示逾期，细线连接错开前的位置。
          </p>
          <div className="matrix-undated" role="group" aria-label="未设截止时间的任务">
            <div>
              <strong>
                未设截止时间 <span className="mono">{undated.length}</span>
              </strong>
              <small>待明确日期，不分配虚构坐标</small>
            </div>
            <div className="matrix-undated-actions">
              {(['high', 'medium', 'low'] as Priority[]).map((priority) => {
                const items = undated.filter((task) => task.priority === priority)
                return (
                  <button
                    key={priority}
                    type="button"
                    disabled={!items.length}
                    onClick={() => select({ kind: 'undated', priority })}
                  >
                    {priorityNames[priority]} <span>{items.length}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>
        <section
          ref={inspector}
          tabIndex={-1}
          className="matrix-inspector panel"
          aria-labelledby="matrix-details-heading"
        >
          <div className="matrix-inspector-heading">
            <div>
              <span className="workspace-eyebrow mono">TASK INDEX</span>
              <h2 id="matrix-details-heading">
                任务明细 <span>{details.length}</span>
              </h2>
            </div>
            {selection && (
              <button className="matrix-reset" onClick={reset}>
                查看全部
              </button>
            )}
          </div>
          <p className="matrix-selection" role="status">
            {selectionLabel}
          </p>
          <button
            className="matrix-return"
            type="button"
            onClick={() => plot.current?.scrollIntoView({ block: 'center' })}
          >
            返回坐标图 ↑
          </button>
          <ul className="matrix-task-list" aria-label="四象限任务明细">
            {shown.map((task) => {
              const deadline = taskDeadline(task, timeZone)
              const overdue = model.overdueIds.has(task.id)
              return (
                <li key={task.id} className={overdue ? 'matrix-task-overdue' : ''}>
                  <button
                    className="matrix-task-check"
                    type="button"
                    role="checkbox"
                    aria-checked={false}
                    aria-label={`完成任务：${task.title}`}
                    onClick={() => onToggle(task.id)}
                  />
                  <div>
                    <button
                      type="button"
                      className="matrix-task-title"
                      aria-label={`编辑任务：${task.title}`}
                      onClick={() => onEdit(task)}
                    >
                      <TaskDot task={task} overdue={overdue} />
                      <span>{task.title}</span>
                    </button>
                    <div className="matrix-task-meta">
                      <span className={`matrix-priority matrix-priority-${task.priority}`}>
                        {priorityNames[task.priority]}
                      </span>
                      <span>
                        {categories.find((category) => category.id === task.categoryId)?.name ||
                          '未分类'}
                      </span>
                      <span className={overdue ? 'matrix-overdue-label' : ''}>
                        {overdue ? '已逾期' : '进行中'}
                      </span>
                    </div>
                    <time
                      className={overdue ? 'matrix-overdue-time' : ''}
                      dateTime={deadline === null ? undefined : new Date(deadline).toISOString()}
                    >
                      {deadline === null ? '未设截止时间' : `截止 ${format.format(deadline)}`}
                    </time>
                    {task.description && (
                      <p className="matrix-task-description" tabIndex={0}>
                        {task.description}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {!shown.length && (
            <div className="matrix-details-empty">
              {selection ? '此区域没有符合当前筛选的任务。' : '暂无任务，可以新建一项或调整筛选。'}
            </div>
          )}
          {details.length > 20 && (
            <div className="matrix-pagination">
              <button disabled={!page} onClick={() => setListPage(page - 1)}>
                上一页
              </button>
              <span>
                {page + 1} / {lastPage + 1}
              </span>
              <button disabled={page === lastPage} onClick={() => setListPage(page + 1)}>
                下一页
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
