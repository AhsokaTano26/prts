import { PrtsButton, PrtsInput } from './PrtsFormControls'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle, MapPin, RefreshCw, Search, Settings2 } from 'lucide-react'
import type { Place } from '../lib/places'
import {
  loadTianditu,
  mapCoordinates,
  needsMapReload,
  parseSearchPois,
  type MapConfig,
  type MapCoordinates,
  type MapSearchPoi,
  type TiandituEvent,
  type TiandituMap,
  type TiandituMarker,
  type TiandituSdk,
  type TiandituSearch,
} from '../lib/placeMaps'
import '../styles/places-map.css'

export interface PlacesMapProps {
  places: Place[]
  config: MapConfig
  selectedId?: string
  onSelect?: (id: string) => void
  onPick?: (coordinates: MapCoordinates, info?: { name?: string; address?: string }) => void
}

export default function PlacesMap({
  places,
  config,
  selectedId,
  onSelect,
  onPick,
}: PlacesMapProps) {
  const canvas = useRef<HTMLDivElement>(null)
  const map = useRef<TiandituMap | null>(null)
  const sdk = useRef<TiandituSdk | null>(null)
  const search = useRef<TiandituSearch | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pickMarker = useRef<TiandituMarker | null>(null)
  const callbacks = useRef({ onSelect, onPick })
  callbacks.current = { onSelect, onPick }
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [tileWarning, setTileWarning] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [results, setResults] = useState<MapSearchPoi[]>([])
  const [picked, setPicked] = useState<MapCoordinates | null>(null)
  const inputId = useId()
  const mapped = useMemo(
    () => places.filter((place) => mapCoordinates(place.coordinates)),
    [places],
  )
  const missing = places.length - mapped.length
  const { apiKey, layer, zoom, center } = config

  useEffect(() => {
    if (!apiKey || !canvas.current) return
    let active = true
    const host = canvas.current
    // Every mount gets a fresh vendor-owned container; React never manages its children.
    const element = document.createElement('div')
    element.className = 'places-map-vendor'
    host.replaceChildren(element)
    let current: TiandituMap | null = null
    let observer: ResizeObserver | null = null
    let tileTimer: ReturnType<typeof setTimeout> | null = null
    let receivedTiles = 0
    let failedTiles = 0
    const onTileLoad = (event: Event) => {
      if (event.target instanceof HTMLImageElement && event.target.classList.contains('tdt-tile')) {
        receivedTiles += 1
        if (active) setTileWarning('')
      }
    }
    const onTileError = (event: Event) => {
      if (event.target instanceof HTMLImageElement && event.target.classList.contains('tdt-tile')) {
        failedTiles += 1
        if (active && failedTiles >= 3 && receivedTiles === 0)
          setTileWarning('地图底图未能加载，请检查天地图密钥、访问域名与网络后重试。')
      }
    }
    const click = (event: TiandituEvent) => {
      if (!active || !event.lnglat || !callbacks.current.onPick) return
      const point = mapCoordinates({ lng: event.lnglat.getLng(), lat: event.lnglat.getLat() })
      if (point) {
        setPicked(point)
        callbacks.current.onPick(point)
      }
    }
    setStatus('loading')
    setError('')
    setTileWarning('')
    setResults([])
    setSearchError('')
    setSearching(false)
    host.addEventListener('load', onTileLoad, true)
    host.addEventListener('error', onTileError, true)
    void loadTianditu(apiKey)
      .then((loaded) => {
        if (!active) return
        sdk.current = loaded
        current = new loaded.Map(element, { minZoom: 1, maxZoom: 18 })
        map.current = current
        current.centerAndZoom(new loaded.LngLat(center.lng, center.lat), zoom)
        current.setMapType(layer === 'satellite' ? window.TMAP_HYBRID_MAP : window.TMAP_NORMAL_MAP)
        current.addEventListener('click', click)
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => current?.checkResize())
          observer.observe(host)
        }
        setStatus('ready')
        tileTimer = setTimeout(() => {
          if (active && receivedTiles === 0)
            setTileWarning(
              '暂未收到地图底图，请检查密钥权限、访问域名或网络。地点资料仍可正常使用。',
            )
        }, 15_000)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : '天地图加载失败，请稍后重试。')
        setStatus('error')
      })
    return () => {
      active = false
      observer?.disconnect()
      if (tileTimer) clearTimeout(tileTimer)
      if (searchTimer.current) clearTimeout(searchTimer.current)
      search.current?.setSearchCompleteCallback(() => {})
      search.current?.clearResults()
      search.current = null
      current?.removeEventListener('click', click)
      current?.disableAutoResize?.()
      current?.disableKeyboard?.()
      current?.clearOverLays()
      current?.remove?.()
      if (map.current === current) map.current = null
      pickMarker.current = null
      host.removeEventListener('load', onTileLoad, true)
      host.removeEventListener('error', onTileError, true)
      element.remove()
    }
  }, [apiKey, layer, center.lng, center.lat, zoom, attempt])

  useEffect(() => {
    const current = map.current
    const loaded = sdk.current
    if (status !== 'ready' || !current || !loaded) return
    const markers: {
      marker: TiandituMarker
      click: (event: TiandituEvent) => void
      key?: (event: KeyboardEvent) => void
    }[] = []
    try {
      for (const place of mapped) {
        const point = place.coordinates!
        const marker = new loaded.Marker(new loaded.LngLat(point.lng, point.lat), {
          title: place.name,
          zIndexOffset: place.id === selectedId ? 1000 : 0,
        })
        const click = () => callbacks.current.onSelect?.(place.id)
        marker.addEventListener('click', click)
        current.addOverLay(marker)
        const target = marker.getElement?.()
        let key: ((event: KeyboardEvent) => void) | undefined
        if (target && callbacks.current.onSelect) {
          target.setAttribute('role', 'button')
          target.setAttribute('aria-label', `查看地点：${place.name}`)
          target.setAttribute('aria-pressed', String(place.id === selectedId))
          target.tabIndex = 0
          key = (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              click()
            }
          }
          target.addEventListener('keydown', key)
        }
        markers.push({ marker, click, key })
      }
      const selected = mapped.find((place) => place.id === selectedId)
      if (selected?.coordinates)
        current.panTo(new loaded.LngLat(selected.coordinates.lng, selected.coordinates.lat))
      else if (mapped.length === 1)
        current.centerAndZoom(
          new loaded.LngLat(mapped[0].coordinates!.lng, mapped[0].coordinates!.lat),
          Math.max(zoom, 13),
        )
      else if (mapped.length > 1)
        current.setViewport(
          mapped.map((place) => new loaded.LngLat(place.coordinates!.lng, place.coordinates!.lat)),
        )
    } catch {
      setTileWarning('地图标记暂时不可用，请重试或在地点清单查看资料。')
    }
    return () => {
      for (const { marker, click, key } of markers) {
        marker.removeEventListener('click', click)
        if (key) marker.getElement?.()?.removeEventListener('keydown', key)
        current.removeOverLay(marker)
      }
    }
  }, [mapped, selectedId, status, zoom, attempt])

  useEffect(() => {
    const current = map.current
    const loaded = sdk.current
    if (!current || !loaded || !picked || status !== 'ready') return
    if (pickMarker.current) current.removeOverLay(pickMarker.current)
    const marker = new loaded.Marker(new loaded.LngLat(picked.lng, picked.lat), {
      title: '当前选点',
      zIndexOffset: 2000,
    })
    current.addOverLay(marker)
    pickMarker.current = marker
    return () => {
      current.removeOverLay(marker)
      if (pickMarker.current === marker) pickMarker.current = null
    }
  }, [picked, status, attempt])

  function fitPlaces() {
    const current = map.current
    const loaded = sdk.current
    if (!current || !loaded) return
    if (mapped.length === 1)
      current.centerAndZoom(
        new loaded.LngLat(mapped[0].coordinates!.lng, mapped[0].coordinates!.lat),
        14,
      )
    else if (mapped.length > 1)
      current.setViewport(
        mapped.map((place) => new loaded.LngLat(place.coordinates!.lng, place.coordinates!.lat)),
      )
    else current.centerAndZoom(new loaded.LngLat(center.lng, center.lat), zoom)
  }

  function find() {
    const current = map.current
    const loaded = sdk.current
    if (!query.trim() || !current || !loaded || searching) return
    if (!loaded.LocalSearch) {
      setSearchError('天地图搜索服务尚未就绪，请稍后再试，或直接点击地图选点。')
      return
    }
    setSearching(true)
    setResults([])
    setSearchError('')
    if (searchTimer.current) clearTimeout(searchTimer.current)
    search.current?.setSearchCompleteCallback(() => {})
    const currentSearch = new loaded.LocalSearch(current, {
      pageCapacity: 10,
      onSearchComplete(result) {
        if (search.current !== currentSearch) return
        if (searchTimer.current) clearTimeout(searchTimer.current)
        const points = parseSearchPois(result.getPois())
        setResults(points)
        setSearching(false)
        if (!points.length)
          setSearchError('没有找到可选地点，请加上城市或详细地址再试，也可以直接点击地图。')
      },
    })
    search.current = currentSearch
    searchTimer.current = setTimeout(() => {
      currentSearch.setSearchCompleteCallback(() => {})
      setSearching(false)
      setSearchError('地点搜索超时，请检查密钥的搜索权限和网络后重试。')
    }, 12_000)
    try {
      // The vendor builds its JSON request from this value; escape JSON string contents.
      currentSearch.search(JSON.stringify(query.trim()).slice(1, -1), 1)
    } catch {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      setSearching(false)
      setSearchError('地点搜索失败，请直接点击地图选点或稍后重试。')
    }
  }

  function choose(poi: MapSearchPoi) {
    const current = map.current
    const loaded = sdk.current
    if (!current || !loaded) return
    setPicked(poi.coordinates)
    current.centerAndZoom(new loaded.LngLat(poi.coordinates.lng, poi.coordinates.lat), 15)
    callbacks.current.onPick?.(poi.coordinates, { name: poi.name, address: poi.address })
    setResults([])
  }

  if (!apiKey)
    return (
      <section className="places-map-unavailable" aria-label="地点地图">
        <div className="places-map-symbol">
          <MapPin size={28} aria-hidden="true" />
        </div>
        <span className="mono">TIANDITU / 地点分布</span>
        <h3>配置天地图后查看地点分布</h3>
        <p>
          在设置中填写天地图浏览器端密钥，即可查看收藏地点、搜索位置和选点。地点清单可以继续使用。
        </p>
        <a className="button button-primary" href="#settings/maps">
          <Settings2 size={16} />
          配置地图服务
        </a>
      </section>
    )

  return (
    <section
      className={`places-map${onPick ? ' places-map-picker' : ''}`}
      aria-label="天地图地点分布"
    >
      {onPick && (
        <div className="places-map-search" role="search">
          <label className="sr-only" htmlFor={inputId}>
            在天地图搜索地点
          </label>
          <Search size={17} aria-hidden="true" />
          <PrtsInput
            id={inputId}
            value={query}
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入城市、地点名称或地址"
            disabled={status !== 'ready'}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                find()
              }
            }}
          />
          <PrtsButton
            className="button button-ghost"
            disabled={status !== 'ready' || searching || !query.trim()}
            type="button"
            onClick={find}
          >
            {searching ? '搜索中…' : '搜索'}
          </PrtsButton>
        </div>
      )}
      {searchError && (
        <p className="places-map-message" role="status">
          {searchError}
        </p>
      )}
      {results.length > 0 && (
        <ul className="places-map-results" aria-label="天地图搜索结果">
          {results.map((poi, index) => (
            <li key={`${poi.coordinates.lng},${poi.coordinates.lat},${index}`}>
              <PrtsButton type="button" onClick={() => choose(poi)}>
                <MapPin size={16} aria-hidden="true" />
                <span>
                  <strong>{poi.name}</strong>
                  <small>{poi.address || '地址未提供'}</small>
                </span>
                <span>选用</span>
              </PrtsButton>
            </li>
          ))}
        </ul>
      )}
      <div className="places-map-stage">
        <div
          className="places-map-canvas"
          ref={canvas}
          aria-label={onPick ? '天地图，点击选择地点坐标' : '天地图，选择标记查看地点'}
        />
        {status === 'loading' && (
          <div className="places-map-overlay" role="status">
            <LoaderCircle size={24} className="workspace-spin" aria-hidden="true" />
            <span>正在加载天地图…</span>
          </div>
        )}
        {status === 'error' && (
          <div className="places-map-overlay places-map-error" role="alert">
            <MapPin size={26} aria-hidden="true" />
            <strong>地图暂时不可用</strong>
            <p>{error}</p>
            <div>
              <PrtsButton
                type="button"
                className="button button-ghost"
                onClick={() =>
                  needsMapReload(apiKey) ? window.location.reload() : setAttempt((n) => n + 1)
                }
              >
                <RefreshCw size={15} />
                {needsMapReload(apiKey) ? '刷新页面' : '重试加载'}
              </PrtsButton>
              <a className="button button-ghost" href="#settings/maps">
                检查地图设置
                <ExternalLink size={14} />
              </a>
            </div>
          </div>
        )}
        {status === 'ready' && (
          <div className="places-map-controls" aria-label="地图操作">
            <PrtsButton
              type="button"
              onClick={() => map.current?.setZoom(Math.min(18, map.current.getZoom() + 1))}
              aria-label="放大地图"
            >
              +
            </PrtsButton>
            <PrtsButton
              type="button"
              onClick={() => map.current?.setZoom(Math.max(1, map.current.getZoom() - 1))}
              aria-label="缩小地图"
            >
              −
            </PrtsButton>
            <PrtsButton type="button" onClick={fitPlaces} aria-label="查看所有地点">
              <MapPin size={17} />
            </PrtsButton>
          </div>
        )}
      </div>
      {tileWarning && (
        <div className="places-map-message" role="status">
          {tileWarning}{' '}
          <PrtsButton
            type="button"
            className="text-button"
            onClick={() => setAttempt((n) => n + 1)}
          >
            重试加载
          </PrtsButton>{' '}
          <a href="#settings/maps">检查地图设置</a>
        </div>
      )}
      <div className="places-map-footer">
        <span>地图来源：天地图 · WGS84</span>
        <span>
          {onPick
            ? picked
              ? `已选 ${picked.lng.toFixed(6)}, ${picked.lat.toFixed(6)}`
              : '搜索地点，或点击地图选点'
            : `${mapped.length} 个地点已定位${missing ? ` · ${missing} 个待补充坐标` : ''}`}
        </span>
      </div>
    </section>
  )
}
