import type { CalendarEvent, Task } from './workspace.ts'
import { addDays, dateKey, dayBounds } from './calendar.ts'

export const HOUR_HEIGHT = 64
export const MIN_BLOCK_HEIGHT = 24
export type TimeRange = { startAt: string; endAt: string }
type BlockPosition = {
  key: string
  startMinute: number
  endMinute: number
  column: number
  columns: number
  offsetLabel?: string
}
export type TimelineBlock = BlockPosition &
  ({ kind: 'event'; event: CalendarEvent } | { kind: 'task'; task: Task })

export function weekDays(day: string): string[] {
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
  const monday = addDays(day, -weekday)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export function actualMonthDays(day: string): string[] {
  const month = day.slice(0, 7)
  const last = new Date(`${month}-01T12:00:00Z`)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  return Array.from(
    { length: last.getUTCDate() },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
  )
}

const localMilliseconds = (instant: number) => {
  const date = new Date(instant)
  return (
    date.getHours() * 3600000 +
    date.getMinutes() * 60000 +
    date.getSeconds() * 1000 +
    date.getMilliseconds()
  )
}
const localMinute = (instant: number) => localMilliseconds(instant) / 60000
const offsetAt = (instant: number) => new Date(instant).getTimezoneOffset()
function offsetLabel(offset: number) {
  const absolute = Math.abs(offset)
  return `UTC${offset <= 0 ? '+' : '-'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
}

/** Split at clock changes, so both instances of a repeated hour remain visible. */
function clockSegments(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []
  const segments: { start: number; end: number; offset: number }[] = []
  let from = start,
    previous = start,
    offset = offsetAt(start)
  while (previous < end - 1) {
    const probe = Math.min(previous + 3600000, end - 1)
    const nextOffset = offsetAt(probe)
    if (nextOffset !== offset) {
      let low = previous,
        high = probe
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2)
        if (offsetAt(middle) === offset) low = middle
        else high = middle
      }
      segments.push({ start: from, end: high, offset })
      from = high
      offset = nextOffset
    }
    previous = probe
  }
  segments.push({ start: from, end, offset })
  return segments
}

type Lane = { end: number; column: number }
function pushLane(heap: Lane[], value: Lane) {
  heap.push(value)
  let index = heap.length - 1
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    if (heap[parent].end <= value.end) break
    heap[index] = heap[parent]
    index = parent
  }
  heap[index] = value
}
function popLane(heap: Lane[]): Lane {
  const first = heap[0]
  const last = heap.pop()!
  if (heap.length) {
    let index = 0
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1
      if (child + 1 < heap.length && heap[child + 1].end < heap[child].end) child++
      if (heap[child].end >= last.end) break
      heap[index] = heap[child]
      index = child
    }
    heap[index] = last
  }
  return first
}

export function layoutTimeline(
  events: CalendarEvent[],
  tasks: Task[],
  day: string,
): TimelineBlock[] {
  const [dayStart, dayEnd] = dayBounds(day)
  const segments = clockSegments(dayStart, dayEnd)
  const blocks: TimelineBlock[] = []
  for (const event of events) {
    if (event.allDay) continue
    const start = Date.parse(event.startAt),
      end = Date.parse(event.endAt)
    segments.forEach((segment, index) => {
      const from = Math.max(start, segment.start),
        to = Math.min(end, segment.end)
      if (to <= from) return
      blocks.push({
        kind: 'event',
        event,
        key: `event:${event.id}:${index}`,
        startMinute: localMinute(from),
        endMinute: Math.min(1440, (localMilliseconds(to - 1) + 1) / 60000),
        column: 0,
        columns: 1,
        ...(segments.length > 1 ? { offsetLabel: offsetLabel(segment.offset) } : {}),
      })
    })
  }
  for (const task of tasks) {
    if (!task.dueAt) continue
    const instant = Date.parse(task.dueAt)
    if (instant < dayStart || instant >= dayEnd || !Number.isFinite(instant)) continue
    blocks.push({
      kind: 'task',
      task,
      key: `task:${task.id}`,
      startMinute: localMinute(instant),
      endMinute: localMinute(instant),
      column: 0,
      columns: 1,
      ...(segments.length > 1 ? { offsetLabel: offsetLabel(offsetAt(instant)) } : {}),
    })
  }
  blocks.sort(
    (a, b) =>
      a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.key.localeCompare(b.key),
  )
  const lanes: Lane[] = []
  let group: TimelineBlock[] = [],
    groupEnd = -Infinity
  const flush = () => {
    for (const block of group) block.columns = lanes.length
    group = []
    lanes.length = 0
    groupEnd = -Infinity
  }
  for (const block of blocks) {
    if (block.startMinute >= groupEnd) flush()
    const visibleEnd = Math.max(
      block.endMinute,
      block.startMinute + (MIN_BLOCK_HEIGHT / HOUR_HEIGHT) * 60,
    )
    block.column =
      lanes.length && lanes[0].end <= block.startMinute ? popLane(lanes).column : lanes.length
    pushLane(lanes, { end: visibleEnd, column: block.column })
    groupEnd = Math.max(groupEnd, visibleEnd)
    group.push(block)
  }
  flush()
  return blocks
}

export function timelineSlotRange(day: string, minute: number): TimeRange | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    day < '0001-01-01' ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute >= 1440
  )
    return null
  const hour = Math.floor(minute / 60),
    minutes = minute % 60
  const start = new Date(
    `${day}T${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`,
  )
  if (
    !Number.isFinite(start.getTime()) ||
    dateKey(start) !== day ||
    start.getHours() !== hour ||
    start.getMinutes() !== minutes
  )
    return null
  const end = new Date(start.getTime() + 3600000)
  if (end.getFullYear() > 9999) end.setTime(new Date(`${day}T23:59:00`).getTime())
  const startAt = start.toISOString(),
    endAt = end.toISOString()
  if (!/^\d{4}-/.test(startAt) || !/^\d{4}-/.test(endAt) || end.getTime() <= start.getTime())
    return null
  return { startAt, endAt }
}
