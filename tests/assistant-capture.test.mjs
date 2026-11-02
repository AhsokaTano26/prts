import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatabase } from '../server/database.mjs'
import { createStorage } from '../server/storage.mjs'
import { createWorkspaceTools } from '../server/assistant-tools.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'
import { parseAssistantActions } from '../src/lib/assistantTools.ts'

function setup(t) {
  const db = createDatabase()
  const storage = createStorage(db)
  t.after(() => {
    storage.close()
    db.close()
  })
  const value = createInitialWorkspace()
  value.tasks = []
  value.calendarEvents = []
  storage.putDocument('workspace', { value, expectedRevision: 0, mutationId: crypto.randomUUID() })
  const tools = createWorkspaceTools(db, storage)
  const agent = tools.session({ timeZone: 'Asia/Shanghai' })
  const batch = (changes) => agent.execute('propose_workspace_changes', JSON.stringify({ changes }))
  const single = (change) => agent.execute('propose_workspace_change', JSON.stringify(change))
  const state = () => storage.getDocument('workspace').value
  const apply = (actions) =>
    tools.decideBatch(
      actions.map((action) => action.id),
      'apply',
    )
  return { db, storage, tools, agent, batch, single, state, apply }
}
const task = (title = '提交报名材料') => ({
  operation: 'create_task',
  fields: { title, dueDate: '2026-11-04', priority: 'high' },
})
const event = (
  title = '项目例会',
  startAt = '2026-11-03T09:00:00+08:00',
  endAt = '2026-11-03T10:00:00+08:00',
) => ({
  operation: 'create_calendar_event',
  fields: { title, startAt, endAt, location: '会议室 A' },
})

test('one capture tool prepares mixed tasks and events and writes only after confirmation', (t) => {
  const { batch, agent, state, apply } = setup(t)
  const result = batch([task(), event(), task('核对参会名单')])
  assert.equal(result.error, undefined)
  assert.equal(result.actions.length, 3)
  assert.equal(result.requiresConfirmation, true)
  assert.equal(state().tasks.length, 0)
  assert.equal(state().calendarEvents.length, 0)
  assert.equal(agent.toolsUsed.length, 1)
  apply(result.actions)
  apply(result.actions)
  assert.deepEqual(
    state()
      .tasks.map((item) => item.title)
      .sort(),
    ['提交报名材料', '核对参会名单'],
  )
  assert.equal(state().calendarEvents[0].startAt, '2026-11-03T09:00:00+08:00')
})

test('a batch with a missing event end time leaves no partial proposals and can be corrected', (t) => {
  const { batch, db, agent, state } = setup(t)
  const incomplete = event()
  delete incomplete.fields.endAt
  const failed = batch([task(), incomplete])
  assert.match(failed.error, /第 2 项/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prts_assistant_actions').get().n, 0)
  assert.equal(agent.actions.length, 0)
  assert.equal(state().tasks.length, 0)
  const fixed = batch([task(), event()])
  assert.equal(fixed.actions.length, 2)
})

test('duplicate captures reuse pending actions and skip already recorded tasks and events', (t) => {
  const { batch, single, agent, state, apply } = setup(t)
  const first = batch([task(), event(), task()])
  assert.equal(first.error, undefined)
  assert.equal(first.actions.length, 2)
  assert.equal(first.skipped.length, 1)
  const repeated = single({
    operation: 'create_task',
    fields: { priority: 'high', title: ' 提交报名材料 ', dueDate: '2026-11-04' },
  })
  assert.equal(repeated.action.id, first.actions[0].id)
  assert.equal(agent.actions.length, 2)
  apply(first.actions)
  const recorded = batch([task(), event()])
  assert.equal(recorded.actions.length, 0)
  assert.equal(recorded.skipped.length, 2)
  assert.equal(state().tasks.length, 1)
  assert.equal(state().calendarEvents.length, 1)
})

test('explicit duplicate creation stays possible and confirmation detects concurrent duplicate recording', (t) => {
  const { tools, single, apply, state } = setup(t)
  const pending = single(task()).action
  const peer = tools.session().execute('propose_workspace_change', JSON.stringify(task())).action
  apply([peer])
  assert.throws(() => apply([pending]), /已存在/)
  assert.equal(state().tasks.length, 1)
  const intentional = single({ ...task(), allowDuplicate: true })
  assert.equal(intentional.error, undefined)
  apply([intentional.action])
  assert.equal(state().tasks.length, 2)
})

test('overlapping events show durable warnings while adjacent events and task deadlines do not', (t) => {
  const { batch, single, tools, state, apply } = setup(t)
  const seed = single(event('已安排会议')).action
  apply([seed])
  const result = batch([
    event('另一场讨论', '2026-11-03T09:30:00+08:00', '2026-11-03T10:30:00+08:00'),
    event('紧邻讨论', '2026-11-03T10:30:00+08:00', '2026-11-03T11:00:00+08:00'),
    task(),
  ])
  assert.equal(result.error, undefined)
  const parsed = parseAssistantActions(result.actions)
  assert.ok(parsed[0].warnings.some((warning) => warning.includes('已安排会议')))
  assert.equal(parsed[1].warnings, undefined)
  assert.equal(parsed[2].warnings, undefined)
  assert.deepEqual(tools.getAction(parsed[0].id).warnings, parsed[0].warnings)
  apply(parsed)
  assert.equal(
    state().calendarEvents.length,
    3,
    'overlap warnings must not silently reject intended events',
  )
})

test('all-day overlap checks use local dates and exclude a timed event ending at midnight', (t) => {
  const { batch } = setup(t)
  const result = batch([
    {
      operation: 'create_calendar_event',
      fields: { title: '外出', allDay: true, startDate: '2026-11-03', endDate: '2026-11-03' },
    },
    event('午夜结束', '2026-11-02T23:00:00+08:00', '2026-11-03T00:00:00+08:00'),
    event('本地凌晨', '2026-11-02T16:30:00Z', '2026-11-02T17:30:00Z'),
  ])
  assert.equal(result.error, undefined)
  assert.equal(result.actions[1].warnings, undefined)
  assert.ok(result.actions[2].warnings.some((warning) => warning.includes('外出')))
})

test('overlap warnings display the source event in the client timezone', (t) => {
  const { single, apply } = setup(t)
  apply([single(event('UTC 会议', '2026-11-03T01:00:00Z', '2026-11-03T02:00:00Z')).action])
  const warning = single(
    event('后续讨论', '2026-11-03T09:30:00+08:00', '2026-11-03T10:30:00+08:00'),
  ).action.warnings[0]
  assert.match(warning, /09:00/)
  assert.match(warning, /10:00/)
  assert.doesNotMatch(warning, /01:00|02:00/)
})

test('capture bounds and invalid fields never leave excess or partial operations', (t) => {
  const { batch, db } = setup(t)
  for (const changes of [
    [],
    Array.from({ length: 51 }, (_, i) => task(`任务 ${i}`)),
    [
      ...Array.from({ length: 49 }, (_, i) => task(`任务 ${i}`)),
      { operation: 'execute_sql', fields: {} },
    ],
    [task(), { ...task(), allowDuplicate: 'yes' }],
    [task(), { operation: 'execute_sql', fields: {} }],
  ]) {
    assert.ok(batch(changes).error)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prts_assistant_actions').get().n, 0)
  }
  const first = batch(Array.from({ length: 30 }, (_, i) => task(`任务 ${i}`)))
  assert.equal(first.error, undefined)
  assert.equal(first.actions.length, 30)
  assert.equal(
    batch(Array.from({ length: 20 }, (_, i) => task(`后续任务 ${i}`))).actions.length,
    20,
  )
  assert.ok(batch([task('第五十一项')]).error)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prts_assistant_actions').get().n, 50)
})

test('fifty operations survive frontend parsing, atomic confirmation and idempotent replay', (t) => {
  const { batch, tools, agent, state, apply } = setup(t)
  const result = batch(Array.from({ length: 50 }, (_, index) => task(`批量任务 ${index}`)))
  assert.equal(result.error, undefined)
  const actions = parseAssistantActions(result.actions)
  assert.equal(actions.length, 50)
  assert.equal(state().tasks.length, 0)
  assert.equal(tools.getActions(actions.map((item) => item.id)).length, 50)
  apply(actions)
  apply(actions)
  assert.equal(state().tasks.length, 50)
  assert.equal(agent.finalize().actions.length, 50)
})

test('fifty automatic operations execute only at finalization and do not repeat', (t) => {
  const { storage, tools, state } = setup(t)
  storage.putDocument('preferences', {
    value: {
      motionEnabled: false,
      assistant: { persona: 'prts', knowledge: 'none' },
      assistantMode: 'ai',
      assistantAutoConfirm: true,
    },
    expectedRevision: 0,
    mutationId: crypto.randomUUID(),
  })
  const agent = tools.session()
  const prepared = agent.execute(
    'propose_workspace_changes',
    JSON.stringify({
      changes: Array.from({ length: 50 }, (_, index) => task(`自动批量任务 ${index}`)),
    }),
  )
  assert.equal(prepared.actions.length, 50)
  assert.equal(state().tasks.length, 0)
  const result = agent.finalize()
  assert.equal(result.actionConfirmation, 'automatic')
  assert.equal(result.actions.filter((item) => item.status === 'applied').length, 50)
  assert.equal(state().tasks.length, 50)
  agent.finalize()
  assert.equal(state().tasks.length, 50)
})

test('a conflict at the final item rolls back every earlier write in a fifty-item confirmation', (t) => {
  const { batch, tools, state, apply } = setup(t)
  const changes = Array.from({ length: 50 }, (_, index) => task(`冲突批次任务 ${index}`))
  const prepared = batch(changes)
  const peer = tools.session().execute('propose_workspace_change', JSON.stringify(changes[49]))
  apply([peer.action])
  assert.throws(() => apply(prepared.actions), /已存在/)
  assert.equal(state().tasks.length, 1)
  assert.ok(
    tools
      .getActions(prepared.actions.map((item) => item.id))
      .every((item) => item.status === 'pending'),
  )
})

test('same-title entries with different source details are preserved as separate records', (t) => {
  const { batch, state, apply } = setup(t)
  const secondEvent = event()
  secondEvent.fields.location = '会议室 B'
  secondEvent.fields.description = '另一场面试，携带作品集'
  const secondTask = task()
  secondTask.fields.priority = 'low'
  const result = batch([event(), secondEvent, task(), secondTask])
  assert.equal(result.error, undefined)
  assert.equal(result.actions.length, 4)
  assert.equal(result.skipped.length, 0)
  apply(result.actions)
  assert.equal(state().calendarEvents.length, 2)
  assert.ok(
    state().calendarEvents.some(
      (item) => item.location === '会议室 B' && item.description === '另一场面试，携带作品集',
    ),
  )
  assert.deepEqual(
    state()
      .tasks.map((item) => item.priority)
      .sort(),
    ['high', 'low'],
  )
})

test('deduplication and previews follow earlier deletes and updates in the same recording plan', (t) => {
  const { batch, single, state, apply } = setup(t)
  apply([single(event()).action, single(task()).action])
  const oldEvent = state().calendarEvents[0],
    oldTask = state().tasks[0]
  const result = batch([
    { operation: 'delete_calendar_event', id: oldEvent.id },
    event(),
    { operation: 'update_task', id: oldTask.id, fields: { done: true } },
    task(),
  ])
  assert.equal(result.error, undefined)
  assert.equal(result.actions.length, 4)
  assert.equal(result.skipped.length, 0)
  apply(result.actions)
  assert.equal(state().calendarEvents.length, 1)
  assert.notEqual(state().calendarEvents[0].id, oldEvent.id)
  assert.equal(state().tasks.length, 2)
  assert.equal(state().tasks.filter((item) => !item.done).length, 1)
})

test('a later edit cannot invalidate skipped material, including across tool calls', (t) => {
  const { batch, single, state, apply } = setup(t)
  apply([single(event()).action, single(task()).action])
  const oldEvent = state().calendarEvents[0],
    oldTask = state().tasks[0]
  const invalid = batch([
    task(),
    { operation: 'update_task', id: oldTask.id, fields: { done: true } },
  ])
  assert.match(invalid.error, /跳过/)
  assert.equal(state().tasks[0].done, false)
  assert.equal(single(event()).actions.length, 0)
  const laterDelete = single({ operation: 'delete_calendar_event', id: oldEvent.id })
  assert.match(laterDelete.error, /跳过/)
  assert.equal(state().calendarEvents.length, 1)
  const corrected = batch([
    { operation: 'delete_calendar_event', id: oldEvent.id },
    event(),
    { operation: 'update_task', id: oldTask.id, fields: { done: true } },
    task(),
  ])
  assert.equal(corrected.error, undefined)
  assert.equal(corrected.actions.length, 4)
  apply(corrected.actions)
  assert.equal(state().calendarEvents.length, 1)
  assert.equal(state().tasks.filter((item) => !item.done).length, 1)
})
