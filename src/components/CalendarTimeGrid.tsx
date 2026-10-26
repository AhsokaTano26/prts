import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import type { CalendarEvent, Task } from '../lib/workspace'
import { dateKey, eventOnDate, eventTimeLabel, timeText } from '../lib/calendar'
import { taskLocalDate } from '../lib/reminders'
import {
  HOUR_HEIGHT,
  MIN_BLOCK_HEIGHT,
  layoutTimeline,
  timelineSlotRange,
} from '../lib/calendarTimeline'
import '../styles/calendar-timeline.css'

const minuteText = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`
const dateLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('zh-CN', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

export default function CalendarTimeGrid({
  span,
  days,
  selected,
  events,
  tasks,
  onSelect,
  onNew,
  onEdit,
  onEditTask,
}: {
  span: 'month' | 'week' | 'day'
  days: string[]
  selected: string
  events: CalendarEvent[]
  tasks: Task[]
  onSelect: (day: string) => void
  onNew: (day: string, minute: number) => void
  onEdit: (event: CalendarEvent) => void
  onEditTask: (task: Task) => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const slots = useRef(new Map<string, HTMLButtonElement>())
  const [activeSlot, setActiveSlot] = useState({ day: selected, minute: 540 })
  const [now, setNow] = useState(() => new Date())
  const period = days.join(',')
  const model = useMemo(
    () =>
      days.map((day) => ({
        day,
        blocks: layoutTimeline(events, tasks, day),
        allDay: events.filter((event) => event.allDay && eventOnDate(event, day)),
        dateTasks: tasks.filter((task) => !task.dueAt && taskLocalDate(task) === day),
        slots: Array.from({ length: 48 }, (_, index) => ({
          minute: index * 30,
          available: timelineSlotRange(day, index * 30) !== null,
        })),
      })),
    [period, events, tasks],
  )
  const floatingRows = Math.max(
    0,
    ...model.map((column) => column.allDay.length + column.dateTasks.length),
  )
  const floatingHeight = Math.min(3, Math.max(1, floatingRows)) * 26 + 12
  const maxLanes = model.reduce(
    (maximum, column) =>
      column.blocks.reduce((count, block) => Math.max(count, block.columns), maximum),
    1,
  )
  const minDayWidth = Math.max(days.length > 1 ? 108 : 0, maxLanes * 32)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => setActiveSlot({ day: selected, minute: 540 }), [selected])
  useLayoutEffect(() => {
    // Keep scroll on edits; only a different displayed period starts at its earliest work.
    const first = model.reduce(
      (earliest, column) =>
        column.blocks.reduce((minute, block) => Math.min(minute, block.startMinute), earliest),
      480,
    )
    if (scroll.current)
      scroll.current.scrollTop = (Math.max(0, Math.min(420, first - 60)) / 60) * HOUR_HEIGHT
  }, [period])
  useLayoutEffect(() => {
    const alignSelectedDay = () => {
      const viewport = scroll.current
      const heading = viewport?.querySelector<HTMLButtonElement>(
        `.timeline-day-heading[data-day="${selected}"]`,
      )
      if (!viewport || !heading) return
      const left = heading.offsetLeft,
        right = left + heading.offsetWidth
      if (left < viewport.scrollLeft + 52) viewport.scrollLeft = Math.max(0, left - 52)
      else if (right > viewport.scrollLeft + viewport.clientWidth)
        viewport.scrollLeft = right - viewport.clientWidth
    }
    alignSelectedDay()
    window.addEventListener('resize', alignSelectedDay)
    return () => window.removeEventListener('resize', alignSelectedDay)
  }, [period, selected, minDayWidth])
  function revealFocus(button: HTMLButtonElement) {
    // Native focus scrolling does not account for the pinned axis and headers.
    const viewport = scroll.current
    if (!viewport) return
    viewport.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const frame = viewport.getBoundingClientRect()
    const box = button.getBoundingClientRect()
    const insetTop = button.classList.contains('timeline-day-heading')
      ? 0
      : button.closest('.timeline-all-day')
        ? 56
        : 56 + floatingHeight
    const left = frame.left + 52,
      right = frame.left + viewport.clientWidth,
      top = frame.top + insetTop,
      bottom = frame.top + viewport.clientHeight
    if (box.width > right - left || box.left < left) viewport.scrollLeft += box.left - left
    else if (box.right > right) viewport.scrollLeft += box.right - right
    if (box.height > bottom - top || box.top < top) viewport.scrollTop += box.top - top
    else if (box.bottom > bottom) viewport.scrollTop += box.bottom - bottom
  }
  function moveFocus(e: KeyboardEvent<HTMLButtonElement>, day: string, minute: number) {
    let index = days.indexOf(day),
      next = minute
    if (e.key === 'ArrowDown') next += 30
    else if (e.key === 'ArrowUp') next -= 30
    else if (e.key === 'ArrowLeft') index--
    else if (e.key === 'ArrowRight') index++
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = 1410
    else return
    e.preventDefault()
    const direction = next >= minute ? 30 : -30
    while (next >= 0 && next < 1440 && index >= 0 && index < days.length) {
      const button = slots.current.get(`${days[index]}:${next}`)
      if (button && !button.disabled) {
        button.focus({ preventScroll: true })
        return
      }
      next += direction
    }
  }
  const today = dateKey(now)
  const nowMinute = now.getHours() * 60 + now.getMinutes()
  return (
    <div
      className="timeline-scroll"
      ref={scroll}
      tabIndex={0}
      role="region"
      aria-label={
        span === 'day'
          ? '日时间网格，可纵向滚动'
          : `${span === 'month' ? '月' : '周'}时间网格，可横向及纵向滚动`
      }
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLButtonElement && event.target.matches(':focus-visible'))
          revealFocus(event.target)
      }}
    >
      <div
        className={`timeline-grid is-${span}`}
        style={
          {
            gridTemplateColumns: `52px repeat(${days.length}, minmax(${minDayWidth}px, 1fr))`,
            minWidth: 52 + days.length * minDayWidth,
            gridTemplateRows: `56px ${floatingHeight}px auto`,
          } as CSSProperties
        }
      >
        <div className="timeline-corner mono">时间</div>
        {model.map(({ day }) => (
          <button
            key={`heading-${day}`}
            className={`timeline-day-heading${day === today ? ' is-today' : ''}${day === selected ? ' is-selected' : ''}`}
            data-day={day}
            aria-label={`选择 ${dateLabel(day)}`}
            aria-pressed={day === selected}
            disabled={day.length !== 10 || day < '0001-01-01' || day > '9999-12-31'}
            onClick={() => onSelect(day)}
          >
            <span>
              {new Date(`${day}T12:00:00Z`).toLocaleDateString('zh-CN', {
                timeZone: 'UTC',
                weekday: 'short',
              })}
            </span>
            <strong>{Number(day.slice(-2))}</strong>
          </button>
        ))}
        <div className="timeline-all-day-label" style={{ height: floatingHeight }}>
          全天
        </div>
        {model.map(({ day, allDay, dateTasks }) => (
          <div
            className="timeline-all-day"
            key={`floating-${day}`}
            style={{ height: floatingHeight }}
            aria-label={`${dateLabel(day)}全天安排`}
          >
            {allDay.map((event) => (
              <button
                key={event.id}
                aria-label={event.title}
                title={event.title}
                onClick={() => onEdit(event)}
              >
                {event.title}
              </button>
            ))}
            {dateTasks.map((task) => (
              <button
                className={`timeline-floating-task${task.done ? ' is-done' : ''}`}
                key={`task-${task.id}`}
                aria-label={task.title}
                title={`当天截止：${task.title}`}
                onClick={() => onEditTask(task)}
              >
                截止 · {task.title}
              </button>
            ))}
            {!allDay.length && !dateTasks.length && (
              <span className="timeline-floating-empty">—</span>
            )}
          </div>
        ))}
        <div
          className="timeline-axis"
          style={{ height: 24 * HOUR_HEIGHT + MIN_BLOCK_HEIGHT }}
          aria-hidden="true"
        >
          {Array.from({ length: 25 }, (_, hour) => (
            <span className="timeline-hour mono" style={{ top: hour * HOUR_HEIGHT }} key={hour}>
              {String(hour).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {model.map(({ day, blocks, slots: daySlots }) => (
          <div
            className="timeline-day-column"
            key={day}
            style={{ height: 24 * HOUR_HEIGHT + MIN_BLOCK_HEIGHT }}
            role="group"
            aria-label={`${dateLabel(day)}时间线`}
          >
            {daySlots.map(({ minute, available }) => (
              <button
                key={minute}
                ref={(button) => {
                  if (button) slots.current.set(`${day}:${minute}`, button)
                  else slots.current.delete(`${day}:${minute}`)
                }}
                className={`timeline-slot${minute % 60 === 0 ? ' is-hour' : ''}`}
                style={{ top: (minute / 60) * HOUR_HEIGHT, height: HOUR_HEIGHT / 2 }}
                data-day={day}
                data-minute={minute}
                disabled={!available}
                tabIndex={activeSlot.day === day && activeSlot.minute === minute ? 0 : -1}
                aria-label={`${day} ${minuteText(minute)} 新建日程`}
                title={available ? `${minuteText(minute)} 新建日程` : '此时刻在当前时区不存在'}
                onFocus={() => setActiveSlot({ day, minute })}
                onKeyDown={(e) => moveFocus(e, day, minute)}
                onClick={() => {
                  onSelect(day)
                  onNew(day, minute)
                }}
              />
            ))}
            {blocks.map((block) => {
              const title = block.kind === 'event' ? block.event.title : block.task.title
              const label =
                block.kind === 'event'
                  ? eventTimeLabel(block.event, day)
                  : `${timeText(new Date(block.task.dueAt!))} 截止`
              const height = Math.max(
                ((block.endMinute - block.startMinute) / 60) * HOUR_HEIGHT - 2,
                MIN_BLOCK_HEIGHT,
              )
              return (
                <button
                  className={`timeline-block${block.kind === 'task' ? ' timeline-task' : ''}${height < 42 ? ' is-short' : ''}${block.kind === 'task' && block.task.done ? ' is-done' : ''}`}
                  key={block.key}
                  data-event-id={block.kind === 'event' ? block.event.id : undefined}
                  data-task-id={block.kind === 'task' ? block.task.id : undefined}
                  style={{
                    top: (block.startMinute / 60) * HOUR_HEIGHT,
                    height,
                    left: `calc(${(block.column / block.columns) * 100}% + 2px)`,
                    width: `calc(${100 / block.columns}% - 4px)`,
                  }}
                  aria-label={`${title}，${label}${block.offsetLabel ? `，${block.offsetLabel}` : ''}`}
                  title={`${title} · ${label}${block.offsetLabel ? ` · ${block.offsetLabel}` : ''}`}
                  onClick={() =>
                    block.kind === 'event' ? onEdit(block.event) : onEditTask(block.task)
                  }
                >
                  <strong>{title}</strong>
                  <span className="timeline-block-time mono">
                    {block.kind === 'event'
                      ? `${minuteText(block.startMinute)}–${minuteText(block.endMinute)}`
                      : label}
                  </span>
                  {block.offsetLabel && (
                    <span className="timeline-block-offset mono">{block.offsetLabel}</span>
                  )}
                </button>
              )
            })}
            {day === today && (
              <div
                className="timeline-now"
                style={{ top: (nowMinute / 60) * HOUR_HEIGHT }}
                role="img"
                aria-label={`当前时间 ${timeText(now)}`}
              >
                <span className="mono">{timeText(now)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
