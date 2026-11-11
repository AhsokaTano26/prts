import { PrtsButton, PrtsInput } from './PrtsFormControls'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus,
  Search,
  MapPin,
  List,
  Map,
  ChevronRight,
  Compass,
  SlidersHorizontal,
  X,
  Star,
} from 'lucide-react'
import {
  filterPlaces,
  placeMatchesTab,
  placeStatus,
  sortedVisits,
  PLACE_TYPES,
  DESIRES,
  type Place,
  type PlaceTab,
  type PlaceVisit,
} from '../lib/places'
import { parseMapConfig, type MapConfig } from '../lib/placeMaps'
import PrtsSelect from './PrtsSelect'
import PlaceDialog from './PlaceDialog'
import PlaceVisitDialog from './PlaceVisitDialog'
import PlaceDetail from './PlaceDetail'
import PlacesMap from './PlacesMap'
import '../styles/places.css'

const TABS: { value: PlaceTab; label: string }[] = [
  { value: 'want', label: '想去' },
  { value: 'visited', label: '去过' },
  { value: 'all', label: '全部' },
  { value: 'archived', label: '已归档' },
]
const PAGE_SIZE = 30
const paramsNow = () => location.hash.split('?')[1] || ''
const noMapConfig = parseMapConfig(undefined)
export default function PlacesView({
  places,
  config = noMapConfig,
  onSave,
  onDelete,
  onEvent,
  onNotify,
}: {
  places: Place[]
  config?: MapConfig
  onSave: (place: Place, message: string) => Promise<boolean>
  onDelete: (place: Place) => Promise<boolean>
  onEvent: (place: Place) => void
  onNotify: (message: string) => void
}) {
  const [paramsText, setParamsText] = useState(paramsNow)
  const params = useMemo(() => new URLSearchParams(paramsText), [paramsText])
  const [editor, setEditor] = useState<Place | null | undefined>(undefined)
  const [showEditorMap, setShowEditorMap] = useState(false)
  const [visiting, setVisiting] = useState<{ place: Place; visit: PlaceVisit | null } | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const selected = places.find((place) => place.id === params.get('place'))
  const tab = TABS.some((item) => item.value === params.get('tab'))
    ? (params.get('tab') as PlaceTab)
    : 'want'
  const map = params.get('view') === 'map'
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
  const filtered = useMemo(
    () =>
      filterPlaces(places, {
        tab,
        q: params.get('q') || '',
        city: params.get('city') || '',
        country: params.get('country') || '',
        type: params.get('type') || '',
        desire: params.get('desire') || '',
        tag: params.get('tag') || '',
        sort: params.get('sort') || 'desire',
      }),
    [places, tab, params],
  )
  const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, maxPage)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const cityOptions = useMemo(
    () =>
      [
        ...new Set(
          places
            .map((place) => JSON.stringify([place.country, place.city]))
            .filter((key) => JSON.parse(key)[1]),
        ),
      ]
        .sort()
        .map((value) => {
          const [country, city] = JSON.parse(value)
          return { value, label: country ? `${city} · ${country}` : city }
        }),
    [places],
  )
  const tags = useMemo(() => [...new Set(places.flatMap((place) => place.tags))].sort(), [places])
  function change(changes: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(paramsNow())
    for (const [key, value] of Object.entries(changes))
      value ? next.set(key, value) : next.delete(key)
    if (resetPage) next.delete('page')
    const query = next.toString()
    location.hash = `places${query ? `?${query}` : ''}`
  }
  function select(id: string) {
    change({ place: id }, false)
  }
  useEffect(() => {
    const handler = () => {
      setParamsText(paramsNow())
    }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  useEffect(() => {
    if (params.get('new') === '1') {
      setEditor(null)
      change({ new: null }, false)
    }
  }, [paramsText])
  useEffect(() => {
    if (selected && window.innerWidth < 1100)
      detailRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [selected?.id])
  async function save(place: Place, message: string) {
    if (busy) return false
    setBusy(true)
    try {
      return await onSave({ ...place, updatedAt: new Date().toISOString() }, message)
    } finally {
      setBusy(false)
    }
  }
  const filters = ['city', 'type', 'desire', 'country', 'tag', 'q'].filter((key) =>
    Boolean(params.get(key)),
  )
  const counts = Object.fromEntries(
    TABS.map((item) => [
      item.value,
      places.filter((place) => placeMatchesTab(place, item.value)).length,
    ]),
  )
  return (
    <div
      className={`page-content places-page${selected || params.has('place') ? ' has-place-selection' : ''}`}
    >
      <div className="view-heading places-heading">
        <div>
          <div className="page-index mono">PLACES / COLLECTION</div>
          <h1>
            想去
            <span aria-hidden="true" className="heading-dot">
              .
            </span>
          </h1>
          <p>把想去的地方先记下来，等有空时出发。</p>
        </div>
        <PrtsButton className="button button-primary" onClick={() => setEditor(null)}>
          <Plus size={17} />
          添加地点
        </PrtsButton>
      </div>
      <div className="places-toolbar">
        <div className="places-tabs" role="tablist" aria-label="地点状态">
          {TABS.map((item) => (
            <PrtsButton
              key={item.value}
              role="tab"
              aria-selected={tab === item.value}
              onClick={() =>
                change({ tab: item.value === 'want' ? null : item.value, place: null })
              }
            >
              {item.label}
              <span className="mono">{counts[item.value]}</span>
            </PrtsButton>
          ))}
        </div>
        <div className="places-view-switch" aria-label="地点视图">
          <PrtsButton
            aria-label="清单视图"
            aria-pressed={!map}
            onClick={() => change({ view: null }, false)}
          >
            <List size={16} />
            <span>清单</span>
          </PrtsButton>
          <PrtsButton
            aria-label="地图视图"
            aria-pressed={map}
            onClick={() => change({ view: 'map' }, false)}
          >
            <Map size={16} />
            <span>地图</span>
          </PrtsButton>
        </div>
      </div>
      <div className="places-filters">
        <label className="workspace-search places-search">
          <Search size={17} />
          <PrtsInput
            type="search"
            aria-label="搜索地点"
            placeholder="搜索名称、地址、标签或备注"
            value={params.get('q') || ''}
            onChange={(e) => change({ q: e.target.value, place: null })}
          />
        </label>
        <PrtsSelect
          aria-label="筛选城市"
          value={
            params.get('city')
              ? JSON.stringify([params.get('country') || '', params.get('city')])
              : ''
          }
          onValueChange={(value) => {
            const [country, city] = value ? JSON.parse(value) : ['', '']
            change({ country, city, place: null })
          }}
          options={[{ value: '', label: '全部城市' }, ...cityOptions]}
        />
        <PrtsSelect
          aria-label="筛选类型"
          value={params.get('type') || ''}
          onValueChange={(value) => change({ type: value, place: null })}
          options={[
            { value: '', label: '全部类型' },
            ...Object.entries(PLACE_TYPES).map(([value, label]) => ({ value, label })),
          ]}
        />
        <PrtsSelect
          aria-label="筛选意愿"
          value={params.get('desire') || ''}
          onValueChange={(value) => change({ desire: value, place: null })}
          options={[
            { value: '', label: '全部意愿' },
            ...Object.entries(DESIRES).map(([value, label]) => ({ value, label })),
          ]}
        />
        <PrtsButton
          className={`button button-ghost places-more${more ? ' active' : ''}`}
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          <SlidersHorizontal size={15} />
          <span>筛选与排序</span>
        </PrtsButton>
      </div>
      {more && (
        <div className="places-extra-filters">
          <PrtsSelect
            aria-label="筛选标签"
            value={params.get('tag') || ''}
            onValueChange={(value) => change({ tag: value, place: null })}
            options={[
              { value: '', label: '全部标签' },
              ...tags.map((value) => ({ value, label: value })),
            ]}
          />
          <PrtsSelect
            aria-label="地点排序"
            value={params.get('sort') || 'desire'}
            onValueChange={(value) => change({ sort: value === 'desire' ? null : value })}
            options={[
              { value: 'desire', label: '意愿优先' },
              { value: 'newest', label: '最近收藏' },
              { value: 'updated', label: '最近更新' },
              { value: 'name', label: '名称顺序' },
              { value: 'visited', label: '最近到访' },
            ]}
          />
          <span>去过且想再去的地点，会同时出现在两个清单中。</span>
        </div>
      )}
      {filters.length > 0 && (
        <div className="places-filter-summary">
          <span>找到 {filtered.length} 个地点</span>
          <PrtsButton
            className="text-button"
            onClick={() => change(Object.fromEntries(filters.map((key) => [key, null])))}
          >
            <X size={13} />
            清除筛选
          </PrtsButton>
        </div>
      )}
      <div className={`places-workspace${map ? ' places-map-view' : ''}`}>
        <div className="places-collection" ref={listRef}>
          <div className="places-list-heading">
            <span>{map ? '地点分布' : '收藏清单'}</span>
            <span className="mono">{String(filtered.length).padStart(2, '0')} PLACES</span>
          </div>
          {map ? (
            <>
              <PlacesMap
                places={filtered}
                config={config}
                selectedId={selected?.id || params.get('focus') || undefined}
                onSelect={select}
              />
              {filtered.some((place) => !place.coordinates) && (
                <div className="places-unlocated">
                  <MapPin size={16} />
                  <div>
                    <strong>
                      {filtered.filter((place) => !place.coordinates).length} 个地点尚未设置地图位置
                    </strong>
                    <p>补充坐标后，它们就会出现在地图上。</p>
                    <div>
                      {filtered
                        .filter((place) => !place.coordinates)
                        .slice(0, 10)
                        .map((place) => (
                          <PrtsButton
                            className="text-button"
                            key={place.id}
                            onClick={() => {
                              select(place.id)
                              setEditor(place)
                            }}
                          >
                            {place.name}
                            <ChevronRight size={12} />
                          </PrtsButton>
                        ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : !filtered.length ? (
            <div className="places-empty">
              <div className="places-empty-icon">
                <Compass size={34} strokeWidth={1} />
              </div>
              <span className="mono">A PLACE TO LOOK FORWARD TO</span>
              <h2>
                {places.length === 0
                  ? '下一站，想去哪里？'
                  : filters.length
                    ? '没有找到符合条件的地点'
                    : tab === 'archived'
                      ? '还没有归档的地点'
                      : tab === 'visited'
                        ? '每一次到访，都值得记下'
                        : '清单里的地方都去过了'}
              </h2>
              <p>
                {places.length === 0
                  ? '先记下一个名字，地址和攻略以后再补。'
                  : filters.length
                    ? '换个关键词，或清除筛选再看看。'
                    : '收藏喜欢的地方，把期待留给下一次出发。'}
              </p>
              <PrtsButton
                className="button button-primary"
                onClick={() =>
                  filters.length
                    ? change(Object.fromEntries(filters.map((key) => [key, null])))
                    : setEditor(null)
                }
              >
                <Plus size={15} />
                {filters.length
                  ? '清除筛选'
                  : places.length === 0
                    ? '收藏第一个地点'
                    : '添加新地点'}
              </PrtsButton>
            </div>
          ) : (
            <>
              <div className="places-list">
                {visible.map((place) => {
                  const last = sortedVisits(place)[0]
                  const target = new URLSearchParams(params)
                  target.set('place', place.id)
                  return (
                    <article
                      className={`place-row${selected?.id === place.id ? ' selected' : ''}`}
                      key={place.id}
                    >
                      <div className={`place-type-symbol type-${place.type}`} aria-hidden="true">
                        <MapPin size={19} strokeWidth={1.5} />
                      </div>
                      <div className="place-row-content">
                        <div className="place-row-title">
                          <a
                            href={`#places?${target}`}
                            aria-current={selected?.id === place.id ? 'true' : undefined}
                          >
                            {place.name}
                          </a>
                          <span className={`place-desire desire-${place.desire}`}>
                            {DESIRES[place.desire]}
                          </span>
                        </div>
                        <div className="place-row-meta">
                          <span>{PLACE_TYPES[place.type]}</span>
                          <span>
                            {[place.city, place.district].filter(Boolean).join(' · ') ||
                              '位置待补充'}
                          </span>
                          {placeStatus(place) !== '想去' && (
                            <span className="place-row-status">{placeStatus(place)}</span>
                          )}
                        </div>
                        {place.address && <p className="place-row-address">{place.address}</p>}
                        {place.note && <p className="place-row-note">{place.note}</p>}
                        {place.tags.length > 0 && (
                          <div className="place-tags">
                            {place.tags.slice(0, 3).map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                            {place.tags.length > 3 && <span>+{place.tags.length - 3}</span>}
                          </div>
                        )}
                        {last && (
                          <div className="place-row-visited">
                            <span>
                              去过 {place.visits.length} 次 · {last.visitedOn || '日期未记录'}
                            </span>
                            {last.rating && (
                              <span>
                                <Star size={11} />
                                我的评分 {last.rating}/5
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <a
                        className="place-row-open"
                        href={`#places?${target}`}
                        aria-label={`查看地点：${place.name}`}
                      >
                        <ChevronRight size={18} />
                      </a>
                    </article>
                  )
                })}
              </div>
              <div className="places-pagination">
                <span>共 {filtered.length} 个地点</span>
                <div>
                  <PrtsButton
                    className="button button-ghost"
                    disabled={currentPage <= 1}
                    onClick={() => change({ page: String(currentPage - 1) }, false)}
                  >
                    上一页
                  </PrtsButton>
                  <span className="mono">
                    {currentPage} / {maxPage}
                  </span>
                  <PrtsButton
                    className="button button-ghost"
                    disabled={currentPage >= maxPage}
                    onClick={() => change({ page: String(currentPage + 1) }, false)}
                  >
                    下一页
                  </PrtsButton>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="places-detail-slot" ref={detailRef}>
          {selected ? (
            <PlaceDetail
              key={selected.id}
              place={selected}
              busy={busy}
              onClose={() => change({ place: null }, false)}
              onEdit={() => setEditor(selected)}
              onVisit={(visit) => setVisiting({ place: selected, visit })}
              onDeleteVisit={(visit) => {
                const visits = selected.visits.filter((item) => item.id !== visit.id)
                return save(
                  { ...selected, visits, wantAgain: visits.length ? selected.wantAgain : false },
                  '到访记录已删除',
                )
              }}
              onChange={save}
              onDelete={async () => {
                if (busy) return false
                setBusy(true)
                try {
                  const saved = await onDelete(selected)
                  if (saved) change({ place: null }, false)
                  return saved
                } finally {
                  setBusy(false)
                }
              }}
              onEvent={() => onEvent(selected)}
              onMap={() => {
                if (selected.coordinates)
                  change(
                    {
                      view: 'map',
                      focus: selected.id,
                      place: null,
                      tab: selected.archivedAt ? 'archived' : 'all',
                      q: null,
                      country: null,
                      city: null,
                      type: null,
                      tag: null,
                      desire: null,
                      page: null,
                    },
                    false,
                  )
                else {
                  setShowEditorMap(true)
                  setEditor(selected)
                }
              }}
              onNotify={onNotify}
            />
          ) : params.has('place') ? (
            <div className="places-detail-placeholder">
              <MapPin size={28} />
              <h2>这个地点不存在或已被删除</h2>
              <PrtsButton className="text-button" onClick={() => change({ place: null }, false)}>
                返回清单
              </PrtsButton>
            </div>
          ) : (
            <div className="places-detail-placeholder">
              <div className="places-detail-crosshair">
                <Compass size={45} strokeWidth={1} />
              </div>
              <span className="mono">YOUR NEXT DESTINATION</span>
              <h2>给期待留一个位置</h2>
              <p>
                选择一个地点，看看为什么想去，
                <br />
                或记下到访后的感受。
              </p>
              <div className="places-detail-key">
                <span>
                  <i />
                  想去 {counts.want}
                </span>
                <span>
                  <i />
                  去过 {counts.visited}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      {editor !== undefined && (
        <PlaceDialog
          place={editor}
          showMap={showEditorMap}
          places={places}
          config={config}
          defaults={{
            city: params.get('city') || '',
            country: params.get('country') || '',
            type: Object.hasOwn(PLACE_TYPES, params.get('type') || '')
              ? (params.get('type') as Place['type'])
              : 'other',
          }}
          onSave={async (place) => {
            const saved = await save(place, editor ? '地点已更新' : '已添加到想去')
            if (saved) {
              if (!placeMatchesTab(place, tab))
                onNotify('已保存，当前清单不包含这个地点，可在详情继续查看。')
            }
            return saved
          }}
          onSaved={(place) => {
            // Close the editor and release its draft guard before changing the route.
            setTimeout(() => select(place.id), 0)
          }}
          onClose={() => {
            setEditor(undefined)
            setShowEditorMap(false)
          }}
        />
      )}
      {visiting && (
        <PlaceVisitDialog
          visit={visiting.visit}
          onClose={() => setVisiting(null)}
          onSave={(visit, again) => {
            const current = places.find((place) => place.id === visiting.place.id)
            if (!current) return Promise.reject(new Error('这个地点已被删除，请重新打开清单。'))
            return save(
              {
                ...current,
                visits: visiting.visit
                  ? current.visits.map((item) => (item.id === visit.id ? visit : item))
                  : [...current.visits, visit],
                wantAgain: visiting.visit ? current.wantAgain : again,
              },
              visiting.visit ? '到访记录已更新' : '到访已记录',
            )
          }}
        />
      )}
    </div>
  )
}
