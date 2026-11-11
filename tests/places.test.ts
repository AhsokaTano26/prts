import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInitialWorkspace, validateWorkspace } from '../src/lib/workspace.ts'
import {
  createPlace,
  validatePlace,
  filterPlaces,
  placeMatchesTab,
  placeStatus,
  sortedVisits,
  placeEventDraft,
} from '../src/lib/places.ts'

const at = '2026-11-11T01:00:00.000Z'
const visit = (id: string, visitedOn = '2026-11-10') => ({
  id,
  visitedOn,
  note: '',
  createdAt: at,
  updatedAt: at,
})

test('legacy workspaces gain an empty place list without changing input', () => {
  const input: Record<string, unknown> = { ...createInitialWorkspace() }
  delete input.places
  const original = structuredClone(input)
  assert.deepEqual(validateWorkspace(input).places, [])
  assert.deepEqual(input, original)
})

test('place backups round trip complete visits, archive, coordinates and intent', () => {
  const place = createPlace({
    name: '山间书屋',
    city: '成都',
    coordinates: { lng: 104.1, lat: 30.6 },
    visits: [visit('v1')],
    wantAgain: true,
    archivedAt: at,
  })
  const workspace = { ...createInitialWorkspace(), places: [place] }
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(workspace))), workspace)
})

test('place validation rejects malformed location, date, URL, duplicate IDs and incompatible intent', () => {
  const place = createPlace({ name: '饭馆' })
  for (const change of [
    { name: ' ' },
    { name: 'x'.repeat(201) },
    { type: 'wrong' },
    { desire: 'wrong' },
    { note: 'x'.repeat(5001) },
    { coordinates: { lng: 181, lat: 0 } },
    { coordinates: { lng: 104 } },
    { coordinates: { lng: 104, lat: NaN } },
    { sourceUrl: 'javascript:alert(1)' },
    { mapUrl: 'https://u:p@example.com' },
    { sourceUrl: 'https://example.com/\ntrick' },
    { wantAgain: true },
    { visits: [visit('v1', '2026-02-30')] },
    { visits: [visit('v1'), visit('v1')] },
    { visits: [{ ...visit('v1'), rating: 0 }] },
    { visits: [{ ...visit('v1'), rating: 1.5 }] },
    { visits: [{ ...visit('v1'), note: 'x'.repeat(2001) }] },
    { tags: ['x'.repeat(21)] },
    { tags: Array.from({ length: 11 }, (_, i) => String(i)) },
    { visits: Array.from({ length: 201 }, (_, i) => visit(String(i))) },
    { createdAt: '2026-02-30T01:00:00Z' },
  ])
    assert.throws(
      () => validatePlace({ ...place, ...change }),
      /地点|到访|标签|链接|坐标|意愿|日期|评分/,
    )
  assert.throws(
    () => validateWorkspace({ ...createInitialWorkspace(), places: [place, place] }),
    /重复/,
  )
  assert.throws(() => validateWorkspace({ ...createInitialWorkspace(), places: null }), /地点/)
  assert.deepEqual(validatePlace({ ...place, tags: [' 早餐 ', '早餐', 'ＣＡＦＥ', 'cafe'] }).tags, [
    '早餐',
    'ＣＡＦＥ',
  ])
})

test('revisit appears in both wanted and visited tabs but only once in all; archive retains history', () => {
  const wanted = createPlace({ id: 'a', name: '未去' })
  const done = createPlace({ id: 'b', name: '去过', visits: [visit('v1')] })
  const again = createPlace({ id: 'c', name: '再去', visits: [visit('v2')], wantAgain: true })
  const archived = { ...again, id: 'd', archivedAt: at }
  assert.equal(placeStatus(again), '想再去')
  assert.equal(placeStatus(done), '去过')
  assert.equal(placeMatchesTab(archived, 'want'), false)
  assert.deepEqual(
    filterPlaces([wanted, done, again, archived], { tab: 'want', sort: 'name' })
      .map((p) => p.id)
      .sort(),
    ['a', 'c'],
  )
  assert.equal(filterPlaces([wanted, done, again, archived], { tab: 'visited' }).length, 2)
  assert.equal(filterPlaces([wanted, done, again, archived], { tab: 'all' }).length, 3)
  assert.equal(filterPlaces([wanted, done, again, archived], { tab: 'archived' }).length, 1)
})

test('filters intersect across tokens, tags, country, city, type and intent with deterministic order', () => {
  const a = createPlace({
    id: 'a',
    name: '桥下饭馆',
    city: '成都',
    country: '中国',
    type: 'restaurant',
    desire: 'high',
    tags: ['聚餐'],
    visits: [{ ...visit('v1'), note: '砂锅 很好吃' }],
  })
  const b = createPlace({ ...a, id: 'b', desire: 'normal', createdAt: '2026-11-12T01:00:00Z' })
  assert.deepEqual(
    filterPlaces([b, a], {
      tab: 'all',
      q: '桥下 砂锅',
      city: '成都',
      country: '中国',
      type: 'restaurant',
      tag: '聚餐',
      desire: 'high',
    }).map((p) => p.id),
    ['a'],
  )
  assert.deepEqual(
    filterPlaces([b, a], { tab: 'all' }).map((p) => p.id),
    ['a', 'b'],
  )
  assert.deepEqual(
    filterPlaces([a, b], { tab: 'all', sort: 'newest' }).map((p) => p.id),
    ['b', 'a'],
  )
})

test('visit dates sort before unknown dates, newest dates first and same-day timestamps break ties', () => {
  const place = createPlace({
    name: '饭馆',
    visits: [
      { ...visit('old', '2026-10-01'), rating: 5 },
      visit('unknown', ''),
      visit('latest', '2026-11-10'),
      { ...visit('same', '2026-11-10'), createdAt: '2026-11-11T02:00:00Z' },
    ],
  })
  assert.deepEqual(
    sortedVisits(place).map((v) => v.id),
    ['same', 'latest', 'old', 'unknown'],
  )
  assert.equal(sortedVisits(place)[0].rating, undefined)
})

test('calendar snapshot respects limits, omits private long notes, and preserves complete URL lines', () => {
  const place = createPlace({
    name: '长'.repeat(200),
    address: '址'.repeat(200),
    note: '私密'.repeat(1000),
    mapUrl: 'https://example.com/' + 'a'.repeat(2000),
    sourceUrl: 'https://example.net/' + 'b'.repeat(2000),
    budget: '预算'.repeat(50),
    openingHours: '营业'.repeat(150),
    city: '城'.repeat(80),
    district: '区'.repeat(80),
  })
  const draft = placeEventDraft(place)
  assert.equal(draft.title, place.name)
  assert.equal(draft.location, place.address)
  assert.ok(draft.description.length <= 5000)
  assert.ok(draft.description.includes(place.mapUrl))
  assert.ok(!draft.description.includes('私密'))
  for (const line of draft.description.split('\n'))
    if (line.includes('https://'))
      assert.ok(line.endsWith(place.mapUrl) || line.endsWith(place.sourceUrl))
})
