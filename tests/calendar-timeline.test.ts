import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  actualMonthDays,
  layoutTimeline,
  timelineSlotRange,
  weekDays,
} from '../src/lib/calendarTimeline.ts'
import { calendarDraft, eventFromDraft } from '../src/lib/calendar.ts'
import type { CalendarEvent, Task } from '../src/lib/workspace.ts'

const day = '2026-10-26'

test('a month timeline contains every actual date, including leap years and supported year limits', () => {
  for (const [month, count] of [
    ['2024-02', 29],
    ['2026-02', 28],
    ['2000-02', 29],
    ['2100-02', 28],
    ['2026-04', 30],
    ['2026-12', 31],
    ['0001-01', 31],
    ['9999-12', 31],
  ] as const) {
    const dates = actualMonthDays(`${month}-15`)
    assert.equal(dates.length, count)
    assert.deepEqual(
      dates,
      Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
    )
  }
})
const base = {
  title: '讨论',
  description: '',
  location: '',
  createdAt: '2026-10-26T00:00:00Z',
  updatedAt: '2026-10-26T00:00:00Z',
}
function event(id: string, start: string, end: string): CalendarEvent {
  return {
    ...base,
    id,
    allDay: false,
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
  }
}

test('a week starts on Monday and crosses year boundaries without changing the selected date', () => {
  assert.deepEqual(weekDays('2027-01-01'), [
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
  ])
})

test('timeline clips cross-day events, excludes midnight ends and leaves all-day events outside the grid', () => {
  const blocks = layoutTimeline(
    [
      event('overnight', '2026-10-25T23:00:00', '2026-10-26T01:00:00'),
      event('midnight', '2026-10-25T23:00:00', '2026-10-26T00:00:00'),
      { ...base, id: 'all-day', allDay: true, startDate: day, endDate: day },
    ],
    [],
    day,
  )
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].startMinute, 0)
  assert.equal(blocks[0].endMinute, 60)
})

test('overlap chains share columns while adjacent appointments reclaim the full width', () => {
  const events = [
    event('a', `${day}T09:00:00`, `${day}T10:00:00`),
    event('b', `${day}T09:30:00`, `${day}T11:00:00`),
    event('c', `${day}T10:00:00`, `${day}T10:30:00`),
    event('d', `${day}T11:00:00`, `${day}T12:00:00`),
  ]
  const source = structuredClone(events)
  const blocks = layoutTimeline(events, [], day)
  assert.deepEqual(
    blocks.map((block) => block.columns),
    [2, 2, 2, 1],
  )
  assert.notEqual(blocks[0].column, blocks[1].column)
  assert.equal(blocks[0].column, blocks[2].column)
  assert.deepEqual(events, source)
})

test('short events and task deadlines are separated according to their visible click targets', () => {
  const task: Task = {
    id: 'task',
    title: '截止',
    priority: 'medium',
    categoryId: '',
    done: false,
    dueDate: day,
    dueAt: new Date(`${day}T09:07:00`).toISOString(),
    createdAt: base.createdAt,
  }
  const blocks = layoutTimeline(
    [
      event('a', `${day}T09:00:00`, `${day}T09:05:00`),
      event('b', `${day}T09:05:00`, `${day}T09:10:00`),
    ],
    [task, { ...task, id: 'date-only', dueAt: undefined }],
    day,
  )
  assert.equal(blocks.length, 3)
  assert.deepEqual(
    blocks.map((block) => block.columns),
    [3, 3, 3],
  )
  assert.equal(new Set(blocks.map((block) => block.column)).size, 3)
  assert.equal(blocks[2].kind, 'task')
})

test('hour slots prefill absolute times and roll the end into the following date', () => {
  const range = timelineSlotRange(day, 23 * 60 + 30)!
  assert.equal(new Date(range.startAt).getHours(), 23)
  assert.equal(new Date(range.endAt).getDate(), 27)
  assert.equal(Date.parse(range.endAt) - Date.parse(range.startAt), 3600000)
  assert.equal(timelineSlotRange('2026-02-30', 9 * 60), null)
  assert.equal(timelineSlotRange(day, -1), null)
  assert.equal(timelineSlotRange(day, 1440), null)
})

test('DST jumps create separate wall-clock segments and unavailable hours cannot be selected', (t) => {
  const previous = process.env.TZ
  t.after(() => {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  })
  process.env.TZ = 'America/New_York'
  const spring = layoutTimeline(
    [event('spring', '2026-03-08T01:30:00-05:00', '2026-03-08T03:30:00-04:00')],
    [],
    '2026-03-08',
  )
  assert.deepEqual(
    spring.map((block) => [block.startMinute, block.endMinute]),
    [
      [90, 120],
      [180, 210],
    ],
  )
  assert.equal(timelineSlotRange('2026-03-08', 150), null)
  const fall = layoutTimeline(
    [event('fall', '2026-11-01T01:45:00-04:00', '2026-11-01T01:15:00-05:00')],
    [],
    '2026-11-01',
  )
  assert.deepEqual(
    fall.map((block) => [block.startMinute, block.endMinute]),
    [
      [60, 75],
      [105, 120],
    ],
  )
  assert.equal(new Set(fall.map((block) => block.offsetLabel)).size, 2)
  const range = timelineSlotRange('2026-11-01', 90)!
  const original: CalendarEvent = { ...base, id: 'preset', allDay: false, ...range }
  const saved = eventFromDraft(
    { ...calendarDraft(original, '2026-11-01'), title: '重复小时的日程' },
    original,
  )
  assert.equal(saved.allDay, false)
  if (!saved.allDay) assert.equal(Date.parse(saved.endAt) - Date.parse(saved.startAt), 3600000)
})
