import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInitialWorkspace, validateWorkspace } from '../src/lib/workspace.ts'

const base = {
  id: 'event-1',
  title: '项目讨论',
  description: '',
  location: '会议室',
  createdAt: '2026-10-26T00:00:00Z',
  updatedAt: '2026-10-26T00:00:00Z',
}
const timed = {
  ...base,
  allDay: false,
  startAt: '2026-10-26T09:00:00Z',
  endAt: '2026-10-26T10:00:00Z',
}

test('old workspaces acquire an empty calendar without modifying their source', () => {
  const source: Record<string, unknown> = { ...createInitialWorkspace() }
  delete source.calendarEvents
  const original = structuredClone(source)
  const result = validateWorkspace(source) as unknown as Record<string, unknown>
  assert.deepEqual(result.calendarEvents, [])
  assert.deepEqual(source, original)
})

test('calendar events round-trip in workspace backups with both time representations', () => {
  const source = {
    ...createInitialWorkspace(),
    calendarEvents: [
      timed,
      {
        ...base,
        id: 'all-day',
        allDay: true,
        startDate: '2026-10-26',
        endDate: '2026-10-28',
      },
    ],
  }
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(source))), source)
})

test('invalid calendar ranges, fields, dates, limits and duplicate IDs are rejected', () => {
  for (const event of [
    { ...timed, title: ' ' },
    { ...timed, title: 'x'.repeat(201) },
    { ...timed, description: 'x'.repeat(5001) },
    { ...timed, location: 'x'.repeat(201) },
    { ...timed, allDay: 'false' },
    { ...timed, endAt: timed.startAt },
    { ...timed, endAt: '2026-10-25T09:00:00Z' },
    { ...timed, startAt: '2026-02-30T09:00:00Z' },
    { ...timed, startDate: '2026-10-26' },
    { ...base, allDay: true, startDate: '2026-02-30', endDate: '2026-03-01' },
    { ...base, allDay: true, startDate: '2026-10-27', endDate: '2026-10-26' },
    { ...base, allDay: true, startDate: '', endDate: '2026-10-26' },
  ])
    assert.throws(
      () => validateWorkspace({ ...createInitialWorkspace(), calendarEvents: [event] }),
      /日程/,
    )
  assert.throws(
    () => validateWorkspace({ ...createInitialWorkspace(), calendarEvents: [timed, timed] }),
    /重复/,
  )
  assert.throws(
    () => validateWorkspace({ ...createInitialWorkspace(), calendarEvents: null }),
    /日程/,
  )
})
