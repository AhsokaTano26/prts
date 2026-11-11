import { makeId } from './workspace.ts'

export const PLACE_TYPES = {
  restaurant: '饭馆',
  cafe: '咖啡茶饮',
  attraction: '景点',
  shop: '店铺',
  stay: '住宿',
  other: '其他地点',
} as const
export const DESIRES = { high: '必去', normal: '感兴趣', low: '有空再去' } as const
export type PlaceType = keyof typeof PLACE_TYPES
export type PlaceDesire = keyof typeof DESIRES
export type PlaceTab = 'want' | 'visited' | 'all' | 'archived'
export type PlaceSort = 'desire' | 'newest' | 'updated' | 'name' | 'visited'
export interface PlaceVisit {
  id: string
  visitedOn: string
  rating?: 1 | 2 | 3 | 4 | 5
  note: string
  createdAt: string
  updatedAt: string
}
export interface Place {
  id: string
  name: string
  type: PlaceType
  desire: PlaceDesire
  country: string
  city: string
  district: string
  address: string
  tags: string[]
  note: string
  budget: string
  openingHours: string
  phone: string
  sourceUrl: string
  mapUrl: string
  coordinates?: { lng: number; lat: number }
  visits: PlaceVisit[]
  wantAgain: boolean
  archivedAt?: string
  createdAt: string
  updatedAt: string
}
export const MAX_PLACES = 10_000
export const MAX_PLACE_VISITS = 200

function invalid(label: string): never {
  throw new Error(`工作台数据无效：${label}`)
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label}格式错误`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value.includes('\0') ||
    (required && !value.trim())
  )
    invalid(`${label}应为${required ? '非空' : ''}文本，且不超过 ${max} 个字符`)
  return value
}
function stamp(value: unknown, label: string): string {
  const result = text(value, label, 40, true)
  if (
    !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(
      result,
    ) ||
    !Number.isFinite(Date.parse(result))
  )
    invalid(`${label}不是有效 ISO 日期时间`)
  validDate(result.slice(0, 10), label)
  return result
}
function validDate(value: string, label: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  if (
    !/^\d{4}-\d\d-\d\d$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    invalid(`${label}不是有效日期`)
  return value
}
export function normalizePlaceText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}
function link(value: unknown, label: string): string {
  const raw = text(value, label, 2048)
  if (/[\x00-\x1f\x7f]/.test(raw)) invalid(`${label}不能包含控制字符`)
  const result = raw.trim()
  if (!result) return ''
  try {
    const parsed = new URL(result)
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname
    )
      invalid(`${label}应为 HTTP(S) 链接，且不能包含账号密码`)
  } catch {
    invalid(`${label}应为有效 HTTP(S) 链接`)
  }
  return result
}
export function validatePlaceVisit(value: unknown): PlaceVisit {
  const item = object(value, '到访记录')
  const visitedOn = text(item.visitedOn, '到访日期', 10)
  if (visitedOn) validDate(visitedOn, '到访日期')
  if (
    item.rating !== undefined &&
    (!Number.isInteger(item.rating) || Number(item.rating) < 1 || Number(item.rating) > 5)
  )
    invalid('到访评分应为 1–5 的整数')
  return {
    id: text(item.id, '到访记录 ID', 200, true),
    visitedOn,
    ...(item.rating !== undefined ? { rating: item.rating as PlaceVisit['rating'] } : {}),
    note: text(item.note, '到访体验', 2000),
    createdAt: stamp(item.createdAt, '到访创建时间'),
    updatedAt: stamp(item.updatedAt, '到访更新时间'),
  }
}
export function validatePlace(value: unknown): Place {
  const item = object(value, '地点')
  if (typeof item.type !== 'string' || !Object.hasOwn(PLACE_TYPES, item.type))
    invalid('地点类型错误')
  if (typeof item.desire !== 'string' || !Object.hasOwn(DESIRES, item.desire))
    invalid('地点意愿错误')
  if (!Array.isArray(item.tags) || item.tags.length > 10) invalid('地点标签最多 10 个')
  const tags = item.tags.map((tag) => text(tag, '地点标签', 20, true).trim())
  const uniqueTags = tags.filter(
    (tag, index) =>
      tags.findIndex((other) => normalizePlaceText(other) === normalizePlaceText(tag)) === index,
  )
  if (!Array.isArray(item.visits) || item.visits.length > MAX_PLACE_VISITS)
    invalid('每个地点最多 200 条到访记录')
  const visits = item.visits.map(validatePlaceVisit)
  if (new Set(visits.map((visit) => visit.id)).size !== visits.length)
    invalid('到访记录包含重复 ID')
  if (typeof item.wantAgain !== 'boolean' || (!visits.length && item.wantAgain))
    invalid('地点再访意愿无效：尚未到访的地点不能标为再访')
  let coordinates: Place['coordinates']
  if (item.coordinates !== undefined) {
    const point = object(item.coordinates, '地点坐标')
    if (
      typeof point.lng !== 'number' ||
      !Number.isFinite(point.lng) ||
      point.lng < -180 ||
      point.lng > 180 ||
      typeof point.lat !== 'number' ||
      !Number.isFinite(point.lat) ||
      point.lat < -90 ||
      point.lat > 90
    )
      invalid('地点坐标应为有效 WGS84 经纬度')
    coordinates = { lng: point.lng, lat: point.lat }
  }
  return {
    id: text(item.id, '地点 ID', 200, true),
    name: text(item.name, '地点名称', 200, true).trim(),
    type: item.type as PlaceType,
    desire: item.desire as PlaceDesire,
    country: text(item.country, '地点国家/地区', 80).trim(),
    city: text(item.city, '地点城市', 80).trim(),
    district: text(item.district, '地点区县', 80).trim(),
    address: text(item.address, '地点地址', 200).trim(),
    tags: uniqueTags,
    note: text(item.note, '地点备注', 5000),
    budget: text(item.budget, '地点预算', 100),
    openingHours: text(item.openingHours, '地点营业时间', 300),
    phone: text(item.phone, '地点电话', 80),
    sourceUrl: link(item.sourceUrl, '地点来源链接'),
    mapUrl: link(item.mapUrl, '地点地图链接'),
    ...(coordinates ? { coordinates } : {}),
    visits,
    wantAgain: item.wantAgain,
    ...(item.archivedAt !== undefined
      ? { archivedAt: stamp(item.archivedAt, '地点归档时间') }
      : {}),
    createdAt: stamp(item.createdAt, '地点收藏时间'),
    updatedAt: stamp(item.updatedAt, '地点更新时间'),
  }
}
export function createPlace(input: Partial<Place> = {}): Place {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    name: '',
    type: 'other',
    desire: 'normal',
    country: '',
    city: '',
    district: '',
    address: '',
    tags: [],
    note: '',
    budget: '',
    openingHours: '',
    phone: '',
    sourceUrl: '',
    mapUrl: '',
    visits: [],
    wantAgain: false,
    createdAt: now,
    updatedAt: now,
    ...input,
  }
}
export function placeMatchesTab(place: Place, tab: PlaceTab): boolean {
  if (tab === 'archived') return Boolean(place.archivedAt)
  if (place.archivedAt) return false
  if (tab === 'all') return true
  if (tab === 'visited') return place.visits.length > 0
  return place.visits.length === 0 || place.wantAgain
}
export function placeStatus(place: Place): string {
  if (place.archivedAt) return '已归档'
  if (!place.visits.length) return '想去'
  return place.wantAgain ? '想再去' : '去过'
}
export function sortedVisits(place: Place): PlaceVisit[] {
  return [...place.visits].sort(
    (a, b) =>
      b.visitedOn.localeCompare(a.visitedOn) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      a.id.localeCompare(b.id),
  )
}
export function placeSearchText(place: Place): string {
  return normalizePlaceText(
    [
      place.name,
      place.country,
      place.city,
      place.district,
      place.address,
      ...place.tags,
      place.note,
      ...place.visits.map((visit) => visit.note),
    ].join(' '),
  )
}
export function placeMatchesQuery(place: Place, query: string): boolean {
  const haystack = placeSearchText(place)
  return normalizePlaceText(query)
    .split(' ')
    .filter(Boolean)
    .every((token) => haystack.includes(token))
}
export interface PlaceFilters {
  tab: PlaceTab
  q?: string
  country?: string
  city?: string
  type?: string
  tag?: string
  desire?: string
  sort?: string
}
const nameOrder = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
export function filterPlaces(places: Place[], filters: PlaceFilters): Place[] {
  const rank = { high: 0, normal: 1, low: 2 }
  const result = places.filter(
    (place) =>
      placeMatchesTab(place, filters.tab) &&
      (!filters.q || placeMatchesQuery(place, filters.q)) &&
      (!filters.country ||
        normalizePlaceText(place.country) === normalizePlaceText(filters.country)) &&
      (!filters.city || normalizePlaceText(place.city) === normalizePlaceText(filters.city)) &&
      (!filters.type || place.type === filters.type) &&
      (!filters.desire || place.desire === filters.desire) &&
      (!filters.tag ||
        place.tags.some((tag) => normalizePlaceText(tag) === normalizePlaceText(filters.tag!))),
  )
  const visitedDates = new Map(
    result.map((place) => [place.id, sortedVisits(place)[0]?.visitedOn || '']),
  )
  return result.sort((a, b) => {
    let order = 0
    if (filters.sort === 'name') order = 0
    else if (filters.sort === 'newest') order = Date.parse(b.createdAt) - Date.parse(a.createdAt)
    else if (filters.sort === 'updated') order = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    else if (filters.sort === 'visited')
      order = (visitedDates.get(b.id) || '').localeCompare(visitedDates.get(a.id) || '')
    else if (filters.tab === 'archived')
      order = Date.parse(b.archivedAt!) - Date.parse(a.archivedAt!)
    else
      order = rank[a.desire] - rank[b.desire] || Date.parse(b.createdAt) - Date.parse(a.createdAt)
    return order || nameOrder.compare(a.name, b.name) || a.id.localeCompare(b.id)
  })
}
export function duplicatePlaces(places: Place[], candidate: Place): Place[] {
  return places.filter((place) => {
    if (place.id === candidate.id) return false
    if (place.mapUrl && candidate.mapUrl) {
      try {
        if (new URL(place.mapUrl).href === new URL(candidate.mapUrl).href) return true
      } catch {
        /* validated when saved */
      }
    }
    return (
      normalizePlaceText(place.name) === normalizePlaceText(candidate.name) &&
      normalizePlaceText(place.city) === normalizePlaceText(candidate.city) &&
      normalizePlaceText(place.country) === normalizePlaceText(candidate.country)
    )
  })
}
export function placeEventDraft(place: Place): {
  title: string
  location: string
  description: string
} {
  const rows = [
    `地点：${place.name}`,
    [place.country, place.city, place.district].filter(Boolean).join(' · '),
    place.address && `地址：${place.address}`,
    place.mapUrl && `地图：${place.mapUrl}`,
    place.budget && `预算参考：${place.budget}`,
    place.openingHours && `营业时间参考：${place.openingHours}`,
    place.sourceUrl && `来源：${place.sourceUrl}`,
  ].filter(Boolean) as string[]
  let description = ''
  for (const row of rows)
    if (description.length + (description ? 1 : 0) + row.length <= 5000)
      description += (description ? '\n' : '') + row
  return { title: place.name, location: place.address || place.city, description }
}
