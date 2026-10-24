import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  taskDeadline,
  taskLocalDate,
  taskLocalTime,
  reminderOffsets,
  qqReminderPayload,
  editedTaskDeadline,
} from '../src/lib/reminders.ts'
import { createInitialWorkspace, validateWorkspace } from '../src/lib/workspace.ts'

test('explicit deadlines survive workspace validation, backup import and time clearing', () => {
  const workspace = createInitialWorkspace()
  const task = workspace.tasks[0]
  Object.assign(task, { dueAt: '2026-10-25T10:30:00.000Z' })
  assert.equal(validateWorkspace(workspace).tasks[0].dueAt, '2026-10-25T10:30:00.000Z')
  assert.equal(taskDeadline(task, 'Asia/Shanghai'), Date.parse('2026-10-25T10:30:00Z'))
  Object.assign(task, { dueAt: 'not-a-date' })
  assert.throws(() => validateWorkspace(workspace), /截止时间/)
  delete task.dueAt
  assert.ok(!Object.hasOwn(validateWorkspace(workspace).tasks[0], 'dueAt'))
})

test('date-only tasks end at 23:59 in the selected timezone, including DST', () => {
  const task = { dueDate: '2026-10-25' }
  assert.equal(taskDeadline(task, 'Asia/Shanghai'), Date.parse('2026-10-25T15:59:00Z'))
  assert.equal(
    taskDeadline({ dueDate: '2026-07-01' }, 'America/New_York'),
    Date.parse('2026-07-02T03:59:00Z'),
  )
  assert.equal(
    taskDeadline({ dueDate: '2026-11-01' }, 'America/New_York'),
    Date.parse('2026-11-02T04:59:00Z'),
  )
  assert.equal(taskDeadline({ dueDate: '' }, 'Asia/Shanghai'), null)
  const precise = { dueDate: '2026-10-25', dueAt: '2026-10-25T10:30:00.000Z' }
  const date = new Date(precise.dueAt)
  assert.equal(
    taskLocalDate(precise),
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
  )
  assert.equal(
    taskLocalTime(precise),
    `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  )
})

test('advance days and minutes produce unique ordered checkpoints', () => {
  assert.deepEqual(
    reminderOffsets({ leadDays: [7, 3, 1], leadMinutes: 10 }),
    [10080, 4320, 1440, 10],
  )
  assert.deepEqual(reminderOffsets({ leadDays: [1, 1], leadMinutes: 1440 }), [1440])
  assert.deepEqual(reminderOffsets({ leadDays: [], leadMinutes: 0 }), [])
})

test('QQ payload obeys the supplied strict schema and stays below its combined 1900 character limit', () => {
  const payload = qqReminderPayload(
    { title: '任务'.repeat(150), dueAt: Date.parse('2026-10-25T10:30:00Z'), offsetMinutes: 1440 },
    { now: Date.parse('2026-10-24T10:30:00Z'), timeZone: 'Asia/Shanghai' },
  )
  const allowed = ['title', 'message', 'source', 'level', 'timestamp', 'fields', 'url']
  assert.ok(Object.keys(payload).every((key) => allowed.includes(key)))
  assert.equal(payload.source, 'PRTS')
  assert.equal(payload.level, 'warning')
  assert.equal(payload.timestamp, '2026-10-24T10:30:00.000Z')
  assert.equal(payload.fields['提前'], '1 天')
  assert.match(payload.fields['截止时间'], /18:30/)
  assert.ok(
    Object.values(payload.fields).every((v) => ['string', 'number', 'boolean'].includes(typeof v)),
  )
  assert.ok(JSON.stringify(payload).length < 1900)
})

test('unmodified deadline fields preserve the exact instant during the repeated DST hour', () => {
  const previous = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    const task = { dueDate: '2026-11-01', dueAt: '2026-11-01T06:30:00.000Z' }
    assert.equal(taskLocalTime(task), '01:30')
    assert.equal(editedTaskDeadline(task, taskLocalDate(task), taskLocalTime(task)), task.dueAt)
    assert.equal(editedTaskDeadline(task, '2026-11-01', '03:30'), '2026-11-01T08:30:00.000Z')
    assert.equal(editedTaskDeadline(task, '2026-11-01', ''), undefined)
    assert.throws(() => editedTaskDeadline(null, '2026-03-08', '02:30'), /不存在/)
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})
