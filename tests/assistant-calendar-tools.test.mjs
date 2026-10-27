import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatabase } from '../server/database.mjs'
import { createStorage } from '../server/storage.mjs'
import { createWorkspaceTools } from '../server/assistant-tools.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'
import { parseAssistantActions } from '../src/lib/assistantTools.ts'

const now = Date.parse('2026-10-27T04:00:00Z')
const stamp = new Date(now).toISOString()
const base = {
  title: '评审',
  description: '需要携带资料',
  location: '设计会议室',
  createdAt: stamp,
  updatedAt: stamp,
}
const timed = (id, startAt = '2026-10-27T09:00:00+08:00', endAt = '2026-10-27T10:00:00+08:00') => ({
  ...base,
  id,
  allDay: false,
  startAt,
  endAt,
})
function setup(t, events = [timed('event-a')]) {
  const db = createDatabase()
  const store = createStorage(db, { now: () => now })
  t.after(() => {
    store.close()
    db.close()
  })
  const value = createInitialWorkspace()
  value.calendarEvents = events
  store.putDocument('workspace', { value, expectedRevision: 0, mutationId: crypto.randomUUID() })
  const tools = createWorkspaceTools(db, store, { now: () => now })
  const save = (value) =>
    store.putDocument('workspace', {
      value,
      expectedRevision: store.getDocument('workspace').revision,
      mutationId: crypto.randomUUID(),
    })
  const session = () => tools.session({ timeZone: 'Asia/Shanghai' })
  const propose = (operation, fields = {}, id, agent = session()) =>
    agent.execute(
      'propose_workspace_change',
      JSON.stringify({ operation, fields, ...(id ? { id } : {}) }),
    )
  return { db, store, tools, save, session, propose }
}

test('calendar metadata, paged search and detail reads expose actual events without unbounded descriptions', (t) => {
  const { tools, session } = setup(
    t,
    Array.from({ length: 13 }, (_, i) => ({
      ...timed(`event-${i}`),
      title: `评审 ${i}`,
      description: '资料'.repeat(2000),
    })),
  )
  const summary = tools.overview('Asia/Shanghai')
  assert.equal(summary.timeZone, 'Asia/Shanghai')
  assert.equal(summary.counts.calendarEvents, 13)
  assert.equal(summary.calendarEvents.length, 10)
  assert.equal(summary.truncated.calendarEvents, true)
  assert.equal(summary.calendarEvents[0].description, undefined)
  const agent = session()
  const result = agent.execute(
    'search_workspace',
    JSON.stringify({ kind: 'events', query: '设计会议室', offset: 10, limit: 2 }),
  )
  assert.equal(result.total, 13)
  assert.deepEqual(
    result.results.map((item) => item.id),
    ['event-10', 'event-11'],
  )
  assert.equal(result.results[0].kind, 'event')
  assert.equal(result.hasMore, true)
  assert.ok(result.results[0].excerpt.length <= 601)
  const item = agent.execute(
    'read_workspace_item',
    JSON.stringify({ kind: 'event', id: 'event-10' }),
  )
  assert.equal(item.description.length, 4000)
  assert.equal(item.location, '设计会议室')
  const all = agent.execute('search_workspace', JSON.stringify({ query: '评审 12' }))
  assert.deepEqual(
    all.results.map((item) => item.id),
    ['event-12'],
  )
})

test('calendar date searches use the client timezone, inclusive all-day dates and exclusive midnight ends', (t) => {
  const { session } = setup(t, [
    timed('starts-today', '2026-10-26T16:00:00Z', '2026-10-26T17:00:00Z'),
    timed('ends-midnight', '2026-10-26T15:00:00Z', '2026-10-26T16:00:00Z'),
    { ...base, id: 'all-span', allDay: true, startDate: '2026-10-26', endDate: '2026-10-27' },
    { ...base, id: 'all-tomorrow', allDay: true, startDate: '2026-10-28', endDate: '2026-10-28' },
  ])
  const agent = session()
  const args = { kind: 'events', fromDate: '2026-10-27', toDate: '2026-10-27' }
  const result = agent.execute('search_workspace', JSON.stringify(args))
  assert.equal(result.error, undefined)
  assert.deepEqual(result.results.map((item) => item.id).sort(), ['all-span', 'starts-today'])
  const utc = agent.execute('search_workspace', JSON.stringify({ ...args, timeZone: 'UTC' }))
  assert.deepEqual(
    utc.results.map((item) => item.id),
    ['all-span'],
  )
  for (const extra of [
    { fromDate: '2026-02-30' },
    { fromDate: '2026-11-01' },
    { timeZone: '../private' },
  ])
    assert.ok(agent.execute('search_workspace', JSON.stringify({ ...args, ...extra })).error)
})

test('calendar create, mode changes, partial updates and deletion use real confirmation cards', (t) => {
  const { store, tools, propose } = setup(t)
  const before = store.getDocument('workspace')
  let result = propose('create_calendar_event', {
    title: '新安排',
    startAt: '2026-10-28T09:00:00+08:00',
    endAt: '2026-10-28T10:00:00+08:00',
    location: '会议室',
  })
  assert.ok(result.action, JSON.stringify(result))
  assert.equal(result.requiresConfirmation, true)
  assert.equal(parseAssistantActions([result.action])[0].operation, 'create_calendar_event')
  assert.match(result.action.preview, /开始时间.*2026-10-28/)
  assert.deepEqual(store.getDocument('workspace'), before)
  tools.decide(result.action.id, 'apply')
  const created = store
    .getDocument('workspace')
    .value.calendarEvents.find((item) => item.title === '新安排')
  assert.equal(created.allDay, false)
  assert.equal(created.createdAt, stamp)
  result = propose(
    'update_calendar_event',
    { allDay: true, startDate: '2026-10-28', endDate: '2026-10-29' },
    created.id,
  )
  assert.ok(result.action, JSON.stringify(result))
  tools.decide(result.action.id, 'apply')
  let updated = store
    .getDocument('workspace')
    .value.calendarEvents.find((item) => item.id === created.id)
  assert.equal(updated.endDate, '2026-10-29')
  assert.equal(updated.startAt, undefined)
  result = propose(
    'update_calendar_event',
    { allDay: false, startAt: '2026-10-28T13:00:00+08:00', endAt: '2026-10-28T14:00:00+08:00' },
    created.id,
  )
  tools.decide(result.action.id, 'apply')
  result = propose(
    'update_calendar_event',
    { title: '改名', description: '保留起止时间', location: '线上' },
    created.id,
  )
  tools.decide(result.action.id, 'apply')
  updated = store
    .getDocument('workspace')
    .value.calendarEvents.find((item) => item.id === created.id)
  assert.equal(updated.startAt, '2026-10-28T13:00:00+08:00')
  assert.equal(updated.startDate, undefined)
  assert.equal(updated.createdAt, stamp)
  assert.equal(updated.location, '线上')
  result = propose('delete_calendar_event', {}, created.id)
  tools.decide(result.action.id, 'apply')
  tools.decide(result.action.id, 'apply')
  assert.deepEqual(
    store.getDocument('workspace').value.calendarEvents.map((item) => item.id),
    ['event-a'],
  )
  assert.deepEqual(store.getDocument('workspace').value.tasks, before.value.tasks)
})

test('date queries include repeated DST hours while excluding the following local midnight', (t) => {
  const { session } = setup(t, [
    timed('fold', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'),
    timed('ends-next-midnight', '2026-11-02T02:00:00Z', '2026-11-02T05:00:00Z'),
    timed('next-day', '2026-11-02T05:00:00Z', '2026-11-02T06:00:00Z'),
  ])
  const result = session().execute(
    'search_workspace',
    JSON.stringify({
      kind: 'events',
      fromDate: '2026-11-01',
      toDate: '2026-11-01',
      timeZone: 'America/New_York',
    }),
  )
  assert.equal(result.error, undefined)
  assert.deepEqual(
    result.results.map((item) => item.id),
    ['fold', 'ends-next-midnight'],
  )
})

test('invalid calendar mutations never create actionable cards or write workspace state', (t) => {
  const { propose, store } = setup(t)
  const before = store.getDocument('workspace')
  for (const fields of [
    { title: '无时间' },
    { title: '逆序', startAt: '2026-10-27T10:00:00Z', endAt: '2026-10-27T09:00:00Z' },
    { title: '无时区', startAt: '2026-10-27T09:00:00', endAt: '2026-10-27T10:00:00' },
    { title: '错误全天', allDay: true, startDate: '2026-02-30', endDate: '2026-03-01' },
    {
      title: '混合格式',
      allDay: true,
      startDate: '2026-10-27',
      endDate: '2026-10-27',
      startAt: '2026-10-27T00:00:00Z',
    },
    { title: '修改内部ID', id: 'override' },
  ]) {
    const result = propose('create_calendar_event', fields)
    assert.ok(result.error)
    assert.doesNotMatch(result.error, /不支持此操作/)
    assert.equal(result.action, undefined)
  }
  assert.ok(propose('update_calendar_event', { allDay: true }, 'event-a').error)
  assert.ok(propose('delete_calendar_event', { title: '隐含修改' }, 'event-a').error)
  assert.ok(propose('update_calendar_event', { title: '未知目标' }, 'missing').error)
  assert.deepEqual(store.getDocument('workspace'), before)
})

test('calendar guards reject concurrent changes and roll back mixed batches', (t) => {
  const { propose, store, save, tools } = setup(t)
  const event = propose('update_calendar_event', { title: 'AI 修改' }, 'event-a').action
  const task = propose('create_task', { title: '不应落库' }).action
  assert.ok(event)
  const current = store.getDocument('workspace').value
  current.calendarEvents[0].location = '另一页面修改'
  save(current)
  const before = store.getDocument('workspace')
  assert.throws(() => tools.decideBatch([task.id, event.id], 'apply'), { status: 409 })
  assert.deepEqual(store.getDocument('workspace'), before)
  const first = propose('update_calendar_event', { title: '批量改名' }, 'event-a').action
  const second = propose('update_calendar_event', { location: '新地点' }, 'event-a').action
  tools.decideBatch([first.id, second.id], 'apply')
  const changed = store.getDocument('workspace').value.calendarEvents[0]
  assert.equal(changed.title, '批量改名')
  assert.equal(changed.location, '新地点')
})

test('automatic confirmation applies calendar actions only when the successful reply is finalized', (t) => {
  const { store, session } = setup(t)
  store.putDocument('preferences', {
    value: {
      motionEnabled: true,
      assistant: { persona: 'prts', knowledge: 'none' },
      assistantMode: 'ai',
      assistantAutoConfirm: true,
    },
    expectedRevision: 0,
    mutationId: crypto.randomUUID(),
  })
  const agent = session()
  const proposed = agent.execute(
    'propose_workspace_change',
    JSON.stringify({ operation: 'delete_calendar_event', id: 'event-a' }),
  )
  assert.ok(proposed.action, JSON.stringify(proposed))
  assert.equal(store.getDocument('workspace').value.calendarEvents.length, 1)
  assert.equal(proposed.requiresConfirmation, false)
  const result = agent.finalize()
  assert.equal(result.actionConfirmation, 'automatic')
  assert.equal(result.actions[0].status, 'applied')
  assert.equal(store.getDocument('workspace').value.calendarEvents.length, 0)
})

test('legacy stored workspaces without calendarEvents remain readable and accept new schedules', (t) => {
  const { db, store, tools, propose } = setup(t)
  const legacy = store.getDocument('workspace').value
  delete legacy.calendarEvents
  db.prepare("UPDATE prts_documents SET data=? WHERE key='workspace'").run(JSON.stringify(legacy))
  assert.equal(tools.overview().counts.calendarEvents, 0)
  const proposed = propose('create_calendar_event', {
    title: '兼容日程',
    allDay: true,
    startDate: '2026-10-27',
    endDate: '2026-10-27',
  })
  assert.ok(proposed.action, JSON.stringify(proposed))
  tools.decide(proposed.action.id, 'apply')
  assert.equal(store.getDocument('workspace').value.calendarEvents.length, 1)
})
