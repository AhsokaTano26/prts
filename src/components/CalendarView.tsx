import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MapPin,
  ArrowUpRight,
  ListTodo,
  Rss,
} from 'lucide-react'
import type { CalendarEvent, Task, Workspace } from '../lib/workspace'
import {
  addDays,
  dateKey,
  dayBounds,
  eventTimeLabel,
  monthDays,
  shiftMonth,
  timeText,
} from '../lib/calendar'
import { taskLocalDate } from '../lib/reminders'
import { actualMonthDays, weekDays } from '../lib/calendarTimeline'
import CalendarTimeGrid from './CalendarTimeGrid'
import CalendarSubscriptionDialog from './CalendarSubscriptionDialog'
import TaskCompletionCheck from './TaskCompletionCheck'
import { useTaskCompletion } from '../lib/useTaskCompletion'
import '../styles/calendar.css'

function fullDate(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('zh-CN', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
}

export default function CalendarView({
  workspace,
  onNew,
  onEdit,
  onEditTask,
  onToggleTask,
}: {
  workspace: Workspace
  onNew: (day: string, minute?: number) => void
  onEdit: (event: CalendarEvent) => void
  onEditTask: (task: Task) => void
  onToggleTask: (id: string) => void
}) {
  const today = dateKey(new Date())
  const [selected, setSelected] = useState(today)
  const [view, setView] = useState<'month' | 'week' | 'day'>('month')
  const [monthLayout, setMonthLayout] = useState<'calendar' | 'timeline'>('calendar')
  const [subscriptionOpen, setSubscriptionOpen] = useState(false)
  const { completingIds, toggleWithFeedback } = useTaskCompletion(workspace.tasks, onToggleTask)
  const isMonthCalendar = view === 'month' && monthLayout === 'calendar'
  const month = selected.slice(0, 7)
  const days = useMemo(() => monthDays(`${month}-01`), [month])
  const displayedDays = useMemo(
    () =>
      view === 'month'
        ? monthLayout === 'calendar'
          ? days
          : actualMonthDays(selected)
        : view === 'week'
          ? weekDays(selected)
          : [selected],
    [view, monthLayout, days, selected],
  )
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef(false)
  const entries = useMemo(() => {
    const ranges = workspace.calendarEvents.map((event) => ({
      event,
      start: event.allDay ? 0 : Date.parse(event.startAt),
      end: event.allDay ? 0 : Date.parse(event.endAt),
    }))
    const tasks = new Map<string, Task[]>()
    for (const task of workspace.tasks) {
      const day = taskLocalDate(task)
      if (day) tasks.set(day, [...(tasks.get(day) || []), task])
    }
    return new Map(
      displayedDays.map((day) => {
        const [start, end] = dayBounds(day)
        const events = ranges
          .filter((item) =>
            item.event.allDay
              ? item.event.startDate <= day && item.event.endDate >= day
              : end > start && item.start < end && item.end > start,
          )
          .sort(
            (a, b) =>
              Number(b.event.allDay) - Number(a.event.allDay) ||
              a.start - b.start ||
              a.event.title.localeCompare(b.event.title, 'zh-CN'),
          )
          .map(({ event }) => event)
        return [
          day,
          {
            events,
            tasks: (tasks.get(day) || []).sort(
              (a, b) =>
                Number(a.done && !completingIds.has(a.id)) -
                  Number(b.done && !completingIds.has(b.id)) ||
                (a.dueAt || '').localeCompare(b.dueAt || ''),
            ),
          },
        ] as const
      }),
    )
  }, [displayedDays, workspace.calendarEvents, workspace.tasks, completingIds])
  useEffect(() => {
    if (pendingFocus.current) {
      buttons.current.get(selected)?.focus({ preventScroll: true })
      pendingFocus.current = false
    }
  }, [selected])
  function keyDown(e: KeyboardEvent<HTMLButtonElement>, day: string) {
    const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -weekday,
      End: 6 - weekday,
    }
    const next =
      e.key === 'PageUp'
        ? shiftMonth(day, -1)
        : e.key === 'PageDown'
          ? shiftMonth(day, 1)
          : e.key in moves
            ? addDays(day, moves[e.key])
            : ''
    if (!next || next.length !== 10 || next < '0001-01-01' || next > '9999-12-31') return
    e.preventDefault()
    pendingFocus.current = true
    setSelected(next)
  }
  const current = entries.get(selected) || { events: [], tasks: [] }
  const monthTitle = `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`
  const periodTitle =
    view === 'month'
      ? monthTitle
      : view === 'day'
        ? fullDate(selected)
        : `${new Date(`${displayedDays[0]}T12:00:00Z`).toLocaleDateString('zh-CN', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' })} — ${new Date(`${displayedDays[6]}T12:00:00Z`).toLocaleDateString('zh-CN', { timeZone: 'UTC', ...(displayedDays[0].slice(0, 4) !== displayedDays[6].slice(0, 4) ? { year: 'numeric' } : {}), month: 'long', day: 'numeric' })}`
  function movePeriod(direction: number) {
    if (view === 'month') {
      setSelected(shiftMonth(selected, direction))
      return
    }
    const day = addDays(selected, direction * (view === 'week' ? 7 : 1))
    setSelected(
      day.length !== 10
        ? direction > 0
          ? '9999-12-31'
          : '0001-01-01'
        : day < '0001-01-01'
          ? '0001-01-01'
          : day,
    )
  }
  return (
    <div className="page-content calendar-page">
      <div className="view-heading">
        <div>
          <div className="page-index mono">CALENDAR / SCHEDULE</div>
          <h1>
            日历日程<span aria-hidden="true">.</span>
          </h1>
          <p>为重要的事，留出时间。</p>
        </div>
        <div className="calendar-heading-actions">
          <button className="button button-ghost" onClick={() => setSubscriptionOpen(true)}>
            <Rss size={16} />
            订阅日历
          </button>
          <button className="button button-primary" onClick={() => onNew(selected)}>
            <Plus size={17} />
            新建日程
          </button>
        </div>
      </div>
      <div
        className={`calendar-layout${view === 'month' ? (monthLayout === 'timeline' ? ' is-month-timeline' : '') : ` is-${view}`}`}
      >
        <section
          className="calendar-month panel"
          aria-label={
            view === 'month'
              ? isMonthCalendar
                ? '月历'
                : '月时间线'
              : view === 'week'
                ? '周时间线'
                : '日时间线'
          }
        >
          <header className="calendar-toolbar">
            <div>
              <span className="calendar-kicker mono">TIME / OVERVIEW</span>
              <h2 className="calendar-month-title" aria-live="polite">
                {periodTitle}
              </h2>
            </div>
            <div className="calendar-view-switch" role="group" aria-label="日历视图">
              {(['month', 'week', 'day'] as const).map((mode) => (
                <button
                  key={mode}
                  aria-label={`${mode === 'month' ? '月' : mode === 'week' ? '周' : '日'}视图`}
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                >
                  {mode === 'month' ? '月' : mode === 'week' ? '周' : '日'}
                </button>
              ))}
            </div>
            <div className="calendar-month-controls">
              <button
                className="button button-ghost calendar-today"
                onClick={() => setSelected(today)}
              >
                今天
              </button>
              <button
                className="icon-button"
                aria-label={view === 'month' ? '上个月' : view === 'week' ? '上一周' : '前一天'}
                disabled={view === 'month' ? month === '0001-01' : selected === '0001-01-01'}
                onClick={() => movePeriod(-1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                aria-label={view === 'month' ? '下个月' : view === 'week' ? '下一周' : '后一天'}
                disabled={view === 'month' ? month === '9999-12' : selected === '9999-12-31'}
                onClick={() => movePeriod(1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </header>
          {view === 'month' && (
            <div className="calendar-month-layout-toolbar">
              <div className="calendar-month-layout-switch" role="group" aria-label="月视图布局">
                <button
                  aria-label="月历模式"
                  aria-pressed={monthLayout === 'calendar'}
                  onClick={() => setMonthLayout('calendar')}
                >
                  月历
                </button>
                <button
                  aria-label="月时间线模式"
                  aria-pressed={monthLayout === 'timeline'}
                  onClick={() => setMonthLayout('timeline')}
                >
                  时间线
                </button>
              </div>
              <p>
                {monthLayout === 'timeline'
                  ? '左右滚动浏览本月 · 点击空白时段新建'
                  : '切换时间线，按小时查看整月安排。'}
              </p>
            </div>
          )}
          {isMonthCalendar ? (
            <div className="calendar-grid" role="grid" aria-label={monthTitle}>
              <div className="calendar-week calendar-weekdays" role="row">
                {['一', '二', '三', '四', '五', '六', '日'].map((name) => (
                  <span role="columnheader" key={name}>
                    周{name}
                  </span>
                ))}
              </div>
              {Array.from({ length: 6 }, (_, row) => (
                <div className="calendar-week" role="row" key={row}>
                  {days.slice(row * 7, row * 7 + 7).map((day) => {
                    const items = entries.get(day)!
                    const count = items.events.length + items.tasks.length
                    return (
                      <div
                        role="gridcell"
                        aria-selected={day === selected}
                        key={day}
                        className="calendar-cell"
                      >
                        <button
                          ref={(el) => {
                            if (el) buttons.current.set(day, el)
                            else buttons.current.delete(day)
                          }}
                          className={`calendar-day${day.slice(0, 7) !== month ? ' is-outside' : ''}${day === today ? ' is-today' : ''}${day === selected ? ' is-selected' : ''}`}
                          data-date={day}
                          disabled={day.length !== 10 || day < '0001-01-01' || day > '9999-12-31'}
                          aria-current={day === today ? 'date' : undefined}
                          aria-pressed={day === selected}
                          aria-label={`${fullDate(day)}，${items.events.length} 项日程，${items.tasks.length} 项任务`}
                          tabIndex={day === selected ? 0 : -1}
                          onClick={() => {
                            pendingFocus.current = true
                            setSelected(day)
                          }}
                          onKeyDown={(e) => keyDown(e, day)}
                        >
                          <span className="calendar-day-number mono">
                            {Number(day.slice(-2))}
                            <span className="calendar-day-today">{day === today ? '今' : ''}</span>
                          </span>
                          <span className="calendar-day-previews">
                            {items.events.slice(0, 2).map((event) => (
                              <span className="calendar-preview" key={event.id}>
                                <i />
                                {event.allDay ? '全天 · ' : ''}
                                {event.title}
                              </span>
                            ))}
                            {items.events.length < 2 &&
                              items.tasks.slice(0, 2 - items.events.length).map((task) => (
                                <span
                                  className={`calendar-preview is-task${task.done ? ' is-done' : ''}`}
                                  key={task.id}
                                >
                                  <i />
                                  {task.title}
                                </span>
                              ))}
                            {count > 2 && <span className="calendar-more">+{count - 2} 项</span>}
                          </span>
                          <span className="calendar-day-markers" aria-hidden="true">
                            {items.events.length > 0 && <i />}
                            {items.tasks.length > 0 && <i className="is-task" />}
                            {count > 0 && <small>{count}</small>}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ) : (
            <CalendarTimeGrid
              span={view}
              days={displayedDays}
              selected={selected}
              events={workspace.calendarEvents}
              tasks={workspace.tasks}
              onSelect={setSelected}
              onNew={(day, minute) => onNew(day, minute)}
              onEdit={onEdit}
              onEditTask={onEditTask}
            />
          )}
          <div className="calendar-legend">
            <span>
              <i />
              日程
            </span>
            <span>
              <i className="is-task" />
              任务截止
            </span>
            <span className="calendar-timezone mono">
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </span>
          </div>
        </section>
        <div className="calendar-agenda panel">
          <header className="calendar-agenda-heading">
            <div>
              <span className="calendar-kicker mono">DAILY / AGENDA</span>
              <h2>{fullDate(selected)}</h2>
            </div>
            <span className="calendar-agenda-number mono" aria-hidden="true">
              {selected.slice(-2)}
            </span>
          </header>
          <section className="calendar-event-list" aria-label="当日日程">
            <div className="calendar-list-heading">
              <h3>
                <CalendarDays size={15} />
                日程
              </h3>
              <span className="mono">{String(current.events.length).padStart(2, '0')}</span>
            </div>
            {current.events.length === 0 ? (
              <div className="calendar-empty">
                <CalendarDays size={28} strokeWidth={1} />
                <p>这一天，还留有空白。</p>
                <button className="text-button" onClick={() => onNew(selected)}>
                  安排一项日程
                  <Plus size={14} />
                </button>
              </div>
            ) : (
              current.events.map((event) => (
                <button
                  className="calendar-event-card"
                  onClick={() => onEdit(event)}
                  key={event.id}
                >
                  <span className="calendar-event-time mono">
                    {eventTimeLabel(event, selected)}
                    <ArrowUpRight size={14} />
                  </span>
                  <strong>{event.title}</strong>
                  {event.location && (
                    <span className="calendar-event-location">
                      <MapPin size={12} />
                      {event.location}
                    </span>
                  )}
                  {event.description && (
                    <span className="calendar-event-description">{event.description}</span>
                  )}
                </button>
              ))
            )}
          </section>
          <section className="calendar-task-list" aria-label="当日任务">
            <div className="calendar-list-heading">
              <h3>
                <ListTodo size={15} />
                任务截止
              </h3>
              <span className="mono">{String(current.tasks.length).padStart(2, '0')}</span>
            </div>
            {current.tasks.length === 0 ? (
              <p className="calendar-no-tasks">当天没有截止任务。</p>
            ) : (
              current.tasks.map((task) => (
                <div
                  className={`calendar-task-row task-completion-target${task.done ? ' is-done' : ''}${task.done && completingIds.has(task.id) ? ' is-completing' : ''}`}
                  key={task.id}
                  data-task-id={task.id}
                  data-completing={task.done && completingIds.has(task.id) ? 'true' : undefined}
                >
                  <TaskCompletionCheck
                    task={task}
                    completing={task.done && completingIds.has(task.id)}
                    onToggle={toggleWithFeedback}
                  />
                  <button
                    className="calendar-task-title"
                    onClick={() => onEditTask(task)}
                    aria-label={task.title}
                  >
                    <strong>{task.title}</strong>
                    <small>
                      {task.dueAt ? timeText(new Date(task.dueAt)) : '当天截止'}
                      {task.done ? ' · 已完成' : ''}
                    </small>
                  </button>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </div>
              ))
            )}
          </section>
        </div>
      </div>
      {subscriptionOpen && (
        <CalendarSubscriptionDialog onClose={() => setSubscriptionOpen(false)} />
      )}
    </div>
  )
}
