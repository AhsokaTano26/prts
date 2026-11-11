/** TianDiTu JS API 4.0: https://lbs.tianditu.gov.cn/api/js4.0/guide.html */
export interface MapCoordinates {
  lng: number
  lat: number
}

export interface MapConfig {
  apiKey: string
  center: MapCoordinates
  zoom: number
  layer: 'vector' | 'satellite'
}

export const DEFAULT_MAP_CONFIG: MapConfig = {
  apiKey: '',
  center: { lng: 104.1954, lat: 35.8617 },
  zoom: 4,
  layer: 'vector',
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The standard base map uses Web Mercator; polar points cannot be displayed. */
export function mapCoordinates(value: unknown): MapCoordinates | undefined {
  if (!record(value)) return undefined
  const { lng, lat } = value
  return typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180 &&
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -85 &&
    lat <= 85
    ? { lng, lat }
    : undefined
}

export function validateMapConfig(value: unknown): MapConfig {
  if (!record(value)) throw new Error('地图配置格式无效。')
  if (typeof value.apiKey !== 'string' || !/^(?:[a-fA-F0-9]{32})?$/.test(value.apiKey.trim()))
    throw new Error('天地图密钥应为 32 位十六进制字符，也可以留空。')
  const center = mapCoordinates(value.center)
  if (!center) throw new Error('地图默认中心应为有效经纬度：经度 -180–180，纬度 -85–85。')
  if (!Number.isInteger(value.zoom) || (value.zoom as number) < 1 || (value.zoom as number) > 18)
    throw new Error('地图默认缩放应为 1–18 的整数。')
  if (value.layer !== 'vector' && value.layer !== 'satellite')
    throw new Error('地图底图应为矢量地图或卫星影像。')
  return { apiKey: value.apiKey.trim(), center, zoom: value.zoom as number, layer: value.layer }
}

/** Missing/legacy preferences use defaults; mutations use strict validation above. */
export function parseMapConfig(value: unknown): MapConfig {
  try {
    return validateMapConfig(value)
  } catch {
    return { ...DEFAULT_MAP_CONFIG, center: { ...DEFAULT_MAP_CONFIG.center } }
  }
}

export function mapSdkUrl(apiKey: string): string {
  if (!/^[a-fA-F0-9]{32}$/.test(apiKey)) throw new Error('请先配置有效的天地图密钥。')
  const url = new URL('https://api.tianditu.gov.cn/api')
  url.searchParams.set('v', '4.0')
  url.searchParams.set('tk', apiKey)
  return url.href
}

export interface MapSearchPoi {
  name: string
  address: string
  coordinates: MapCoordinates
}

export function parseSearchPois(value: unknown): MapSearchPoi[] {
  if (!Array.isArray(value)) return []
  const points: MapSearchPoi[] = []
  for (const item of value) {
    if (!record(item) || typeof item.lonlat !== 'string' || typeof item.name !== 'string') continue
    const parts = item.lonlat.split(',')
    if (parts.length !== 2 || parts.some((part) => !part.trim())) continue
    const coordinates = mapCoordinates({ lng: Number(parts[0]), lat: Number(parts[1]) })
    if (!coordinates) continue
    points.push({
      name: item.name.slice(0, 200),
      address: typeof item.address === 'string' ? item.address.slice(0, 200) : '',
      coordinates,
    })
    if (points.length === 10) break
  }
  return points
}

export interface TiandituLngLat {
  getLng(): number
  getLat(): number
}
export type TiandituEvent = { lnglat?: TiandituLngLat }
type EventListener = (event: TiandituEvent) => void
export interface TiandituMarker {
  addEventListener(name: string, callback: EventListener): void
  removeEventListener(name: string, callback: EventListener): void
  getElement?(): HTMLElement
}
export interface TiandituMap {
  centerAndZoom(point: TiandituLngLat, zoom: number): void
  panTo(point: TiandituLngLat): void
  getZoom(): number
  setZoom(zoom: number): void
  setViewport(points: TiandituLngLat[]): void
  setMapType(type: unknown): void
  addOverLay(marker: TiandituMarker): void
  removeOverLay(marker: TiandituMarker): void
  clearOverLays(): void
  addEventListener(name: string, callback: EventListener): void
  removeEventListener(name: string, callback: EventListener): void
  checkResize(): void
  disableAutoResize?(): void
  disableKeyboard?(): void
  remove?(): void
}
export interface TiandituSearch {
  search(keyword: string, type?: number): void
  clearResults(): void
  setSearchCompleteCallback(callback: (result: { getPois(): unknown }) => void): void
}
export interface TiandituSdk {
  Map: new (element: HTMLElement, options?: Record<string, unknown>) => TiandituMap
  LngLat: new (lng: number, lat: number) => TiandituLngLat
  Marker: new (point: TiandituLngLat, options?: Record<string, unknown>) => TiandituMarker
  LocalSearch?: new (
    map: TiandituMap,
    options: { pageCapacity: number; onSearchComplete: (result: { getPois(): unknown }) => void },
  ) => TiandituSearch
}

declare global {
  interface Window {
    T?: TiandituSdk
    TMAP_AUTHKEY?: string
    TMAP_NORMAL_MAP?: unknown
    TMAP_HYBRID_MAP?: unknown
  }
}

let sdkKey = ''
let sdkPromise: Promise<TiandituSdk> | undefined

/** The vendor stores its key globally. A changed key requires a fresh document. */
export function needsMapReload(apiKey: string): boolean {
  return Boolean(sdkKey && sdkKey !== apiKey)
}

export function loadTianditu(apiKey: string): Promise<TiandituSdk> {
  const src = mapSdkUrl(apiKey)
  if (needsMapReload(apiKey))
    return Promise.reject(new Error('地图密钥已更改，请刷新页面以使用新的密钥。'))
  if (sdkPromise) return sdkPromise
  if (window.T?.Map && window.TMAP_AUTHKEY !== apiKey)
    return Promise.reject(new Error('页面已加载其他地图密钥，请刷新页面后重试。'))
  sdkKey = apiKey
  sdkPromise = new Promise<TiandituSdk>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset.prtsTianditu = 'true'
    let complete = false
    const finish = (error?: Error) => {
      if (complete) return
      complete = true
      clearTimeout(timeout)
      clearInterval(poll)
      script.onerror = null
      if (error) {
        script.remove()
        sdkPromise = undefined
        reject(error)
      } else resolve(window.T!)
    }
    const timeout = setTimeout(
      () => finish(new Error('天地图加载超时，请检查密钥、访问域名和网络后重试。')),
      15_000,
    )
    const poll = setInterval(() => {
      if (window.T?.Map && window.T?.LngLat && window.T?.Marker && window.TMAP_AUTHKEY === apiKey)
        finish()
    }, 80)
    script.onerror = () => finish(new Error('天地图加载失败，请检查网络或内容拦截设置后重试。'))
    document.head.appendChild(script)
  })
  return sdkPromise
}
