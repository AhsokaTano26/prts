import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dateKey,
  monthDays,
  shiftMonth,
  eventOnDate,
  eventFromDraft,
  eventStartDate,
  eventTimeLabel,
  dayBounds,
} from '../src/lib/calendar.ts'
import type { CalendarEvent } from '../src/lib/workspace.ts'

const base = {
  id: 'test',
  title: '讨论',
  description: '',
  location: '',
  createdAt: '2026-10-26T00:00:00Z',
  updatedAt: '2026-10-26T00:00:00Z',
}
const draft = {
  title: '  新日程  ',
  description: '记录',
  location: '',
  allDay: false,
  startDate: '2026-10-26',
  endDate: '2026-10-26',
  startTime: '09:00',
  endTime: '10:00',
}

test('the final supported month keeps valid distinct adjacent dates and midnight boundaries', () => {
  const days = monthDays('9999-12-01')
  assert.equal(new Set(days).size, 42)
  assert.ok(days.every((day) => Number.isFinite(new Date(`${day}T12:00:00Z`).getTime())))
  assert.ok(dayBounds('9999-12-31').every(Number.isFinite))
})

test('time labels distinguish next-day midnight from an event ending several days later', () => {
  const event: CalendarEvent = {
    ...base,
    allDay: false,
    startAt: new Date('2026-10-26T23:00:00').toISOString(),
    endAt: new Date('2026-10-28T10:00:00').toISOString(),
  }
  assert.equal(eventTimeLabel(event, '2026-10-26'), '23:00 — 10/28 10:00')
  assert.equal(
    eventTimeLabel(
      { ...event, endAt: new Date('2026-10-27T00:00:00').toISOString() },
      '2026-10-26',
    ),
    '23:00 — 24:00',
  )
})

test('month grids contain six Monday-based weeks, including leap day and neighboring months', () => {
  const days = monthDays('2024-02-15')
  assert.equal(days.length, 42)
  assert.equal(days[0], '2024-01-29')
  assert.equal(days.at(-1), '2024-03-10')
  assert.ok(days.includes('2024-02-29'))
  assert.equal(new Set(days).size, 42)
  assert.equal(monthDays('2026-06-15')[0], '2026-06-01')
})

test('month switching clamps the day instead of overflowing into the following month', () => {
  assert.equal(shiftMonth('2024-01-31', 1), '2024-02-29')
  assert.equal(shiftMonth('2026-01-31', 1), '2026-02-28')
  assert.equal(shiftMonth('2026-01-31', -1), '2025-12-31')
  assert.equal(shiftMonth('2026-12-31', 1), '2027-01-31')
})

test('all-day ranges include both endpoint dates without timezone conversion', () => {
  const event: CalendarEvent = {
    ...base,
    allDay: true,
    startDate: '2026-10-30',
    endDate: '2026-11-02',
  }
  for (const day of ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    assert.equal(eventOnDate(event, day), true)
  assert.equal(eventOnDate(event, '2026-11-03'), false)
  assert.equal(eventOnDate(event, '2026-10-29'), false)
  assert.equal(eventStartDate(event), '2026-10-30')
})

test('timed events cross dates but an exclusive midnight end never occupies the next date', () => {
  const event: CalendarEvent = {
    ...base,
    allDay: false,
    startAt: new Date('2026-10-26T23:00:00').toISOString(),
    endAt: new Date('2026-10-28T00:00:00').toISOString(),
  }
  assert.equal(eventOnDate(event, '2026-10-26'), true)
  assert.equal(eventOnDate(event, '2026-10-27'), true)
  assert.equal(eventOnDate(event, '2026-10-28'), false)
  assert.equal(eventOnDate(event, '2026-10-25'), false)
})

test('local input produces absolute times; editing text preserves original timestamp precision and offset', () => {
  const event = eventFromDraft(draft)
  assert.equal(event.title, '新日程')
  assert.equal(event.allDay, false)
  if (event.allDay) return
  assert.equal(dateKey(new Date(event.startAt)), draft.startDate)
  const original: CalendarEvent = {
    ...event,
    startAt: event.startAt.replace('.000Z', '.123Z'),
    endAt: event.endAt.replace('.000Z', '.456Z'),
  }
  const updated = eventFromDraft({ ...draft, title: '改标题' }, original)
  assert.equal(updated.allDay, false)
  if (updated.allDay) return
  assert.equal(updated.startAt, original.startAt)
  assert.equal(updated.endAt, original.endAt)
  assert.equal(updated.id, original.id)
  assert.equal(updated.createdAt, original.createdAt)
})

test('invalid dates, incomplete times and reversed ranges are rejected', () => {
  for (const changes of [
    { startDate: '2026-02-30' },
    { startTime: '' },
    { startTime: '24:30' },
    { endTime: '09:00' },
    { endDate: '2026-10-25' },
  ])
    assert.throws(() => eventFromDraft({ ...draft, ...changes }))
  const allDay = eventFromDraft({ ...draft, allDay: true })
  assert.equal(allDay.allDay, true)
  assert.ok(!Object.hasOwn(allDay, 'startAt'))
})

test('DST gaps are rejected and 23/25-hour calendar days use local boundaries', (t) => {
  const previous = process.env.TZ
  t.after(() => {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  })
  process.env.TZ = 'America/New_York'
  assert.throws(
    () =>
      eventFromDraft({
        ...draft,
        startDate: '2026-03-08',
        endDate: '2026-03-08',
        startTime: '02:30',
        endTime: '04:00',
      }),
    /不存在/,
  )
  const event: CalendarEvent = {
    ...base,
    allDay: false,
    startAt: '2026-11-02T04:30:00Z',
    endAt: '2026-11-02T05:00:00Z',
  }
  assert.equal(eventOnDate(event, '2026-11-01'), true)
  assert.equal(eventOnDate(event, '2026-11-02'), false)
})
