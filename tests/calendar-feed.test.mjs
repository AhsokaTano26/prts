import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCalendarFeed } from '../server/calendar-feed.mjs'
import { validateCalendarEvent } from '../src/lib/workspace.ts'

const stamp = '2026-10-27T00:00:00.000Z'
const base = {
  id: 'event-1',
  title: '项目讨论',
  description: '',
  location: '会议室',
  createdAt: stamp,
  updatedAt: stamp,
}
const timed = {
  ...base,
  allDay: false,
  startAt: '2026-10-27T23:30:00+08:00',
  endAt: '2026-10-28T00:30:00+08:00',
}
const feed = (calendarEvents = [], tasks = [], namespace = 'instance-a') =>
  buildCalendarFeed({ workspace: { calendarEvents, tasks }, updatedAt: stamp, namespace })
const unfolded = (value) => value.replace(/\r\n /g, '')
const components = (value) =>
  unfolded(value)
    .split('BEGIN:VEVENT\r\n')
    .slice(1)
    .map((part) => part.split('END:VEVENT')[0])
const uid = (value) => /UID:([^\r\n]+)/.exec(unfolded(value))[1]

test('feeds contain a valid empty calendar and convert absolute event times to UTC', () => {
  assert.match(feed(), /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/)
  assert.ok(feed().endsWith('END:VCALENDAR\r\n'))
  const value = feed([timed])
  assert.match(value, /DTSTART:20261027T153000Z\r\n/)
  assert.match(value, /DTEND:20261027T163000Z\r\n/)
  assert.match(value, /LOCATION:会议室\r\n/)
  assert.match(value, /DTSTAMP:20261027T000000Z\r\n/)
  assert.doesNotMatch(value, /METHOD:REQUEST|VALARM|ATTENDEE|ORGANIZER/)
})

test('all-day events include their final date and handle leap years and the maximum year', () => {
  const event = (startDate, endDate) => ({ ...base, allDay: true, startDate, endDate })
  const value = feed([event('2024-02-28', '2024-02-29')])
  assert.match(value, /DTSTART;VALUE=DATE:20240228\r\n/)
  assert.match(value, /DTEND;VALUE=DATE:20240301\r\n/)
  assert.match(feed([event('9999-12-30', '9999-12-31')]), /DURATION:P2D\r\n/)
  assert.doesNotMatch(feed([event('9999-12-30', '9999-12-31')]), /DTEND:/)
})

test('sub-second intervals remain positive events in the second-precision feed', () => {
  const value = feed([
    { ...timed, startAt: '2026-10-27T10:00:00.100Z', endAt: '2026-10-27T10:00:00.200Z' },
  ])
  assert.match(value, /DTSTART:20261027T100000Z\r\nDURATION:PT1S\r\n/)
})

test('only unfinished tasks with deadlines become transparent deadline markers', () => {
  const task = {
    id: 'task-1',
    title: '提交结果',
    createdAt: stamp,
    done: false,
    dueDate: '2026-10-28',
  }
  const items = components(
    feed(
      [],
      [
        task,
        { ...task, id: 'time', dueAt: '2026-10-28T10:15:00+08:00' },
        { ...task, id: 'done', done: true },
        { ...task, id: 'undated', dueDate: '' },
      ],
    ),
  )
  assert.equal(items.length, 2)
  assert.ok(
    items.every(
      (item) =>
        item.includes('SUMMARY:截止 · 提交结果\r\n') && item.includes('TRANSP:TRANSPARENT\r\n'),
    ),
  )
  assert.match(items[0], /DTSTART;VALUE=DATE:20261028\r\nDTEND;VALUE=DATE:20261029\r\n/)
  assert.match(items[1], /DTSTART:20261028T021500Z\r\nDURATION:PT1M\r\n/)
})

test('IDs remain stable across edits and are distinct across instances and item types', () => {
  const first = uid(feed([timed]))
  assert.equal(
    uid(
      feed([
        {
          ...timed,
          title: '改名',
          startAt: '2026-10-28T09:00:00Z',
          updatedAt: '2026-10-28T00:00:00Z',
        },
      ]),
    ),
    first,
  )
  assert.notEqual(uid(feed([timed], [], 'instance-b')), first)
  assert.notEqual(uid(feed([], [{ ...base, dueDate: '2026-10-27', done: false }])), first)
  const revised = buildCalendarFeed({
    workspace: { calendarEvents: [timed] },
    updatedAt: stamp,
    namespace: 'instance-a',
    revision: 2,
  })
  assert.match(revised, /SEQUENCE:2\r\n/)
})

test('TEXT escaping and byte folding preserve Chinese and emoji without injecting properties', () => {
  const title = '中文😀'.repeat(40) + '\\,;\r\nBEGIN:VEVENT\rSUMMARY:伪造'
  const value = feed([{ ...timed, title, description: '备注\\,;\nEND:VEVENT' }])
  assert.equal(components(value).length, 1)
  assert.ok(value.includes('\r\n '))
  assert.ok(value.split('\r\n').every((line) => Buffer.byteLength(line) <= 75))
  assert.equal(value.includes('\uFFFD'), false)
  const normalized = unfolded(value)
  assert.ok(
    normalized.includes(
      'SUMMARY:' + '中文😀'.repeat(40) + '\\\\\\,\\;\\nBEGIN:VEVENT\\nSUMMARY:伪造\r\n',
    ),
  )
  assert.ok(normalized.includes('DESCRIPTION:备注\\\\\\,\\;\\nEND:VEVENT\r\n'))
  assert.equal(value.replace(/\r\n/g, '').includes('\n'), false)
})

test('accepted offset instants beyond UTC year limits use valid fixed-offset calendar times', () => {
  const upper = validateCalendarEvent({
    ...timed,
    startAt: '9999-12-31T23:00:00-01:00',
    endAt: '9999-12-31T23:30:00-01:00',
  })
  const lower = validateCalendarEvent({
    ...timed,
    id: 'lower',
    startAt: '0001-01-01T00:00:00+01:00',
    endAt: '0001-01-01T00:30:00+01:00',
  })
  const value = unfolded(feed([upper, lower]))
  assert.doesNotMatch(value, /DT(?:START|END):(?:\+010000|0000)/)
  assert.match(value, /BEGIN:VTIMEZONE\r\nTZID:PRTS\/FixedM0100\r\n/)
  assert.match(value, /TZOFFSETTO:-0100\r\n/)
  assert.match(value, /TZOFFSETTO:\+0100\r\n/)
  assert.match(value, /DTSTART;TZID=PRTS\/FixedM0100:99991231T230000\r\n/)
  assert.match(value, /DTEND;TZID=PRTS\/FixedP0100:00010101T003000\r\n/)
  const zero = validateCalendarEvent({
    ...timed,
    startAt: '0000-01-01T00:00:00Z',
    endAt: '0000-01-01T00:30:00Z',
  })
  assert.match(unfolded(feed([zero])), /DTSTART;TZID=PRTS\/FixedP0000:00000101T000000\r\n/)
})
