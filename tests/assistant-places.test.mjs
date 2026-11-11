import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatabase } from '../server/database.mjs'
import { createStorage } from '../server/storage.mjs'
import { createWorkspaceTools } from '../server/assistant-tools.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'
import { createPlace } from '../src/lib/places.ts'
import { parseAssistantActions } from '../src/lib/assistantTools.ts'
import { sameCapture } from '../server/assistant-capture.mjs'
import { systemMessage } from '../server/personality.mjs'

const initialTime = Date.parse('2026-11-11T03:00:00Z')
const stamp = new Date(initialTime).toISOString()

test('AI keeps same-name branches distinct when map links, districts or coordinates identify different locations', () => {
  const original = createPlace({
    name: '河畔饭馆',
    city: '成都',
    mapUrl: 'https://example.com/map/a',
  })
  assert.equal(
    sameCapture('create_place', original, { ...original, mapUrl: 'https://example.com/map/b' }),
    false,
  )
  const noLink = { ...original, mapUrl: '', district: '锦江区' }
  assert.equal(sameCapture('create_place', noLink, { ...noLink, district: '青羊区' }), false)
  const point = { ...noLink, coordinates: { lng: 104.06, lat: 30.57 } }
  assert.equal(
    sameCapture('create_place', point, { ...point, coordinates: { lng: 104.08, lat: 30.57 } }),
    false,
  )
  assert.equal(sameCapture('create_place', point, { ...point }), true)
})
const place = (name = '河畔饭馆', fields = {}) => ({
  operation: 'create_place',
  fields: { name, ...fields },
})
function setup(t, options = {}) {
  let clock = initialTime
  const database = createDatabase()
  const storage = createStorage(database, { now: () => clock })
  t.after(() => {
    storage.close()
    database.close()
  })
  const workspace = createInitialWorkspace()
  workspace.places = options.places || []
  storage.putDocument('workspace', {
    value: workspace,
    expectedRevision: 0,
    mutationId: crypto.randomUUID(),
  })
  if (options.autoConfirm)
    storage.putDocument('preferences', {
      value: {
        motionEnabled: false,
        assistant: { persona: 'prts', knowledge: 'none' },
        assistantMode: 'ai',
        assistantAutoConfirm: true,
        map: {
          apiKey: '1234567890abcdef1234567890abcdef',
          center: { lng: 104, lat: 35 },
          zoom: 4,
          layer: 'vector',
        },
      },
      expectedRevision: 0,
      mutationId: crypto.randomUUID(),
    })
  const tools = createWorkspaceTools(database, storage, { now: () => clock })
  const agent = tools.session({ timeZone: 'Asia/Shanghai' })
  const single = (change, session = agent) =>
    session.execute('propose_workspace_change', JSON.stringify(change))
  const batch = (changes) => agent.execute('propose_workspace_changes', JSON.stringify({ changes }))
  const state = () => storage.getDocument('workspace').value
  const save = (value) =>
    storage.putDocument('workspace', {
      value,
      expectedRevision: storage.getDocument('workspace').revision,
      mutationId: crypto.randomUUID(),
    })
  const apply = (actions) =>
    tools.decideBatch(
      actions.map((action) => action.id),
      'apply',
    )
  return {
    database,
    storage,
    tools,
    agent,
    single,
    batch,
    state,
    save,
    apply,
    advance: (millis) => {
      clock += millis
    },
  }
}

test('create_place records only after confirmation, exposes complete meaningful preview and replays idempotently', (t) => {
  const { single, state, tools, apply } = setup(t)
  const result = single(
    place('河畔饭馆', {
      type: 'restaurant',
      desire: 'high',
      country: '中国',
      city: '成都',
      district: '锦江区',
      address: '示例路 18 号',
      tags: ['聚餐', '预约'],
      note: '想试砂锅',
      budget: '人均约 80 元',
      openingHours: '11:00–21:00',
      phone: '12345',
      sourceUrl: 'https://example.com/recommend',
      mapUrl: 'https://example.com/map',
      coordinates: { lng: 104.06, lat: 30.57 },
    }),
  )
  assert.equal(result.error, undefined)
  assert.equal(result.requiresConfirmation, true)
  assert.equal(parseAssistantActions([result.action])[0].operation, 'create_place')
  for (const text of [
    '饭馆',
    '必去',
    '成都',
    '锦江区',
    '示例路 18 号',
    '聚餐',
    '预约',
    '想试砂锅',
    '人均约 80 元',
    '11:00–21:00',
    '12345',
    'https://example.com/recommend',
    'https://example.com/map',
    '104.06',
    '30.57',
  ])
    assert.ok(result.action.preview.includes(text), text)
  assert.doesNotMatch(result.action.preview, /\[object Object\]/)
  assert.equal(state().places.length, 0)
  apply([result.action])
  tools.decide(result.action.id, 'apply')
  const saved = state().places[0]
  assert.equal(saved.name, '河畔饭馆')
  assert.equal(saved.createdAt, stamp)
  assert.equal(saved.updatedAt, stamp)
  assert.deepEqual(saved.visits, [])
  assert.equal(saved.wantAgain, false)
  assert.deepEqual(saved.coordinates, { lng: 104.06, lat: 30.57 })
  assert.equal(saved.tags.length, 2)
  assert.equal(state().places.length, 1)
  assert.match(state().activities[0].text, /河畔饭馆/)
})

test('name-only capture stays useful and never invents address, coordinates or past visits', (t) => {
  const { single, apply, state } = setup(t)
  const result = single(place('不知道地址的书店'))
  assert.equal(result.error, undefined)
  apply([result.action])
  const saved = state().places[0]
  assert.equal(saved.type, 'other')
  assert.equal(saved.desire, 'normal')
  assert.equal(saved.address, '')
  assert.equal(saved.coordinates, undefined)
  assert.deepEqual(saved.visits, [])
})

test('long place previews retain every field label and visibly disclose clipping', (t) => {
  const { single } = setup(t)
  const result = single(
    place('长资料', {
      note: '备注'.repeat(2500),
      sourceUrl: 'https://example.com/' + 'a'.repeat(2000),
      mapUrl: 'https://example.net/' + 'b'.repeat(2000),
      coordinates: { lng: 104, lat: 30 },
      tags: ['聚餐', '预约'],
    }),
  )
  assert.equal(result.error, undefined)
  assert.ok(result.action.preview.length <= 8000)
  for (const label of ['收藏备注', '推荐来源', '地图链接', '地图坐标', '地点标签'])
    assert.ok(result.action.preview.includes(label), label)
  assert.match(result.action.preview, /完整内容将保存/)
})

test('place summary/search are bounded, explicit reads paginate notes and never expose map credentials', (t) => {
  const places = Array.from({ length: 13 }, (_, index) =>
    createPlace({
      id: `place-${index}`,
      name: `河畔饭馆 ${index}`,
      city: '成都',
      note: '私密备注'.repeat(1000),
      visits: Array.from({ length: 8 }, (_, visit) => ({
        id: `v-${visit}`,
        visitedOn: '2026-11-10',
        note: '私密到访'.repeat(400),
        createdAt: stamp,
        updatedAt: stamp,
      })),
    }),
  )
  const { tools, agent } = setup(t, { places, autoConfirm: true })
  const summary = tools.overview()
  assert.equal(summary.counts.places, 13)
  assert.equal(summary.places.length, 10)
  assert.equal(summary.truncated.places, true)
  assert.ok(!JSON.stringify(summary).includes('私密备注'))
  assert.ok(!JSON.stringify(summary).includes('私密到访'))
  assert.ok(!JSON.stringify(summary).includes('1234567890abcdef1234567890abcdef'))
  const search = agent.execute(
    'search_workspace',
    JSON.stringify({ kind: 'places', query: '成都 河畔', offset: 10, limit: 2 }),
  )
  assert.equal(search.total, 13)
  assert.equal(search.results.length, 2)
  assert.equal(search.results[0].kind, 'place')
  assert.equal(search.results[0].id, 'place-10')
  assert.equal(search.hasMore, true)
  const read = agent.execute(
    'read_workspace_item',
    JSON.stringify({ kind: 'place', id: 'place-10', offset: 12, limit: 100 }),
  )
  assert.equal(read.name, '河畔饭馆 10')
  assert.equal(read.note.length, 100)
  assert.equal(read.totalCharacters, 4000)
  assert.equal(read.hasMore, true)
  assert.equal(read.visitCount, 8)
  assert.ok(read.visits.length <= 5)
  assert.equal(read.truncatedVisits, true)
  assert.ok(read.visits.every((visit) => visit.note.length <= 201))
  assert.ok(!JSON.stringify(read).includes('1234567890abcdef1234567890abcdef'))
})

test('unknown/protected fields, invalid place data and place update/delete never prepare cards', (t) => {
  const { single, database } = setup(t)
  const invalid = [
    place(''),
    place('x'.repeat(201)),
    place('错误', { type: 'bar' }),
    place('错误', { note: 'x'.repeat(5001) }),
    place('错误', { sourceUrl: 'javascript:alert(1)' }),
    place('错误', { coordinates: { lng: 190, lat: 30 } }),
    place('错误', { coordinates: { lng: 104 } }),
    place('错误', { tags: ['x'.repeat(21)] }),
    place('错误', { id: 'chosen-id' }),
    place('错误', { createdAt: stamp }),
    place('错误', { updatedAt: stamp }),
    place('错误', { visits: [] }),
    place('错误', { wantAgain: true }),
    place('错误', { archivedAt: stamp }),
    place('错误', { map: { apiKey: 'secret' } }),
    { ...place(), id: 'chosen-id' },
    { operation: 'update_place', fields: { name: '改名' } },
    { operation: 'delete_place', id: 'old-place' },
  ]
  for (const change of invalid) assert.ok(single(change).error, JSON.stringify(change))
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM prts_assistant_actions').get().n, 0)
})

test('bulk captures mix places/tasks/events, deduplicate pending places and preserve distinct branches', (t) => {
  const { batch, single, agent, apply, state } = setup(t)
  const result = batch([
    place('河畔饭馆', { city: '成都', address: '甲路 1 号' }),
    place('河畔饭馆', { city: '成都', address: '乙路 2 号' }),
    place(' 河畔饭馆 ', { city: '成都', address: '甲路 1 号' }),
    { operation: 'create_task', fields: { title: '订位' } },
    {
      operation: 'create_calendar_event',
      fields: { title: '聚餐', allDay: true, startDate: '2026-11-15', endDate: '2026-11-15' },
    },
  ])
  assert.equal(result.error, undefined)
  assert.equal(result.actions.length, 4)
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].title, '河畔饭馆')
  const repeated = single(place('河畔饭馆', { city: '成都', address: '甲路 1 号' }))
  assert.equal(repeated.action.id, result.actions[0].id)
  assert.equal(agent.actions.length, 4)
  apply(result.actions)
  assert.equal(state().places.length, 2)
  assert.ok(state().tasks.some((item) => item.title === '订位'))
  assert.ok(state().calendarEvents.some((item) => item.title === '聚餐'))
  const existing = single(place('河畔饭馆', { city: '成都', address: '甲路 1 号' }))
  assert.equal(existing.actions.length, 0)
  assert.equal(existing.skipped[0].title, '河畔饭馆')
})

test('strict place identity handles normalized text and exact map links without merging different branches', () => {
  const base = createPlace({
    name: ' ＣＡＦＥ   Corner ',
    country: '中国',
    city: '成都',
    address: '甲路 1 号',
    mapUrl: 'https://EXAMPLE.com/a?id=1',
  })
  assert.equal(
    sameCapture('create_place', base, { ...base, name: 'cafe corner', note: '另一个备注' }),
    true,
  )
  assert.equal(
    sameCapture('create_place', base, {
      ...base,
      name: '不同名称',
      mapUrl: 'https://example.com/a?id=1',
    }),
    true,
  )
  assert.equal(
    sameCapture(
      'create_place',
      { ...base, mapUrl: '' },
      { ...base, address: '乙路 2 号', mapUrl: '' },
    ),
    false,
  )
  assert.equal(
    sameCapture('create_place', { ...base, mapUrl: '' }, { ...base, country: '法国', mapUrl: '' }),
    false,
  )
})

test('commit-time duplicate guards roll back mixed batches; explicit allowDuplicate can still add another', (t) => {
  const { tools, single, batch, apply, state } = setup(t)
  const result = batch([{ operation: 'create_task', fields: { title: '不能部分写入' } }, place()])
  const peer = tools.session().execute('propose_workspace_change', JSON.stringify(place()))
  tools.decide(peer.action.id, 'apply')
  assert.throws(() => apply(result.actions), /已存在/)
  assert.equal(state().places.length, 1)
  assert.ok(!state().tasks.some((item) => item.title === '不能部分写入'))
  assert.ok(
    tools
      .getActions(result.actions.map((action) => action.id))
      .every((action) => action.status === 'pending'),
  )
  const intentional = single({ ...place(), allowDuplicate: true })
  apply([intentional.action])
  assert.equal(state().places.length, 2)
})

test('place guards ignore unrelated focus updates and reject an occupied proposed identity', (t) => {
  const { single, storage, apply, state, save, database } = setup(t)
  const pending = single(place('地点一'))
  storage.putDocument('focus', {
    value: { remaining: 1500, endAt: null, sessionId: null },
    expectedRevision: 0,
    mutationId: crypto.randomUUID(),
  })
  apply([pending.action])
  assert.equal(state().places.length, 1)
  const conflict = single(place('地点二'))
  const row = database
    .prepare('SELECT data FROM prts_assistant_actions WHERE id=?')
    .get(conflict.action.id)
  const occupiedId = JSON.parse(row.data).change.id
  save({
    ...state(),
    places: [...state().places, createPlace({ id: occupiedId, name: '其他页面使用的记录' })],
  })
  assert.throws(() => apply([conflict.action]), /数据已变化/)
  assert.equal(state().places.length, 2)
})

test('a later tool call cannot silently lose a previously skipped place that was removed meanwhile', (t) => {
  const existing = createPlace({ name: '书屋' })
  const { single, save, state, database } = setup(t, { places: [existing] })
  assert.equal(single(place('书屋')).skipped.length, 1)
  save({ ...state(), places: [] })
  const result = single({ operation: 'create_task', fields: { title: '后续事项' } })
  assert.match(result.error, /跳过.*书屋|书屋.*跳过/)
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM prts_assistant_actions').get().n, 0)
})

test('invalid bulk place fields leave no partial actions; automatic finalize and expiry preserve guarantees', (t) => {
  const invalid = setup(t)
  const result = invalid.batch([place('有效'), place('无效', { visits: [] })])
  assert.match(result.error, /第 2 项/)
  assert.equal(
    invalid.database.prepare('SELECT COUNT(*) AS n FROM prts_assistant_actions').get().n,
    0,
  )
  const auto = setup(t, { autoConfirm: true })
  const prepared = auto.batch([place('自动一'), place('自动二')])
  assert.equal(prepared.requiresConfirmation, false)
  assert.equal(auto.state().places.length, 0)
  assert.equal(auto.agent.finalize().actions.length, 2)
  assert.equal(auto.state().places.length, 2)
  auto.agent.finalize()
  assert.equal(auto.state().places.length, 2)
  const expired = invalid.single(place('过期操作'))
  invalid.advance(31 * 60_000)
  assert.throws(() => invalid.apply([expired.action]), /过期/)
  assert.equal(invalid.state().places.length, 0)
})

test('tool and persona instructions include place capture without granting coordinate invention or map settings access', (t) => {
  const { agent, tools } = setup(t)
  const definitions = JSON.stringify(agent.definitions)
  assert.match(definitions, /create_place/)
  assert.match(definitions, /places/)
  assert.match(definitions, /coordinates/)
  const prompt = systemMessage('prts', [], tools.overview()).content
  assert.match(prompt, /create_place/)
  assert.match(prompt, /坐标/)
  assert.match(prompt, /不得|不能|不要/)
  assert.doesNotMatch(definitions, /update_place|delete_place|tiandituKey/)
})
