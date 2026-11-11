import { PrtsButton, PrtsForm, PrtsInput } from './PrtsFormControls'
import { useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff, MapPinned, RotateCcw, Save } from 'lucide-react'
import {
  DEFAULT_MAP_CONFIG,
  parseMapConfig,
  validateMapConfig,
  type MapConfig,
} from '../lib/placeMaps'
import { useServerStore } from '../lib/serverStore'
import PlacesMap from './PlacesMap'
import PrtsSelect from './PrtsSelect'
import { SectionTitle } from './UI'
import '../styles/map-settings.css'

function fields(config: MapConfig) {
  return {
    apiKey: config.apiKey,
    longitude: String(config.center.lng),
    latitude: String(config.center.lat),
    zoom: String(config.zoom),
    layer: config.layer,
  }
}

export default function MapSettings({ active }: { active: boolean }) {
  const store = useServerStore()
  const preferences = store.documents.preferences.value
  const [draft, setDraft] = useState(() => fields(parseMapConfig(preferences.map)))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [revealKey, setRevealKey] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<MapConfig | null>(null)

  useEffect(() => {
    if (!dirty) setDraft(fields(parseMapConfig(preferences.map)))
  }, [preferences.map, dirty])

  function change(value: Partial<typeof draft>) {
    setDraft((previous) => ({ ...previous, ...value }))
    setDirty(true)
    setNotice('')
    setError('')
    setPreview(null)
  }

  function value(): MapConfig {
    if (!draft.longitude.trim() || !draft.latitude.trim() || !draft.zoom.trim())
      throw new Error('请填写默认中心的经纬度和缩放级别。')
    return validateMapConfig({
      apiKey: draft.apiKey,
      center: { lng: Number(draft.longitude), lat: Number(draft.latitude) },
      zoom: Number(draft.zoom),
      layer: draft.layer,
    })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setNotice('')
    setError('')
    try {
      const map = value()
      setSaving(true)
      if (await store.save('preferences', { ...preferences, map })) {
        setDirty(false)
        setNotice('地图设置已保存，将用于想去的地图总览与选点。')
      } else setError('地图设置尚未保存，输入已保留，请按页面提示重试。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '地图设置保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  function openPreview() {
    setError('')
    try {
      const next = value()
      if (!next.apiKey) throw new Error('请先填写天地图浏览器密钥，再预览地图。')
      setPreview(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法预览地图，请检查填写内容。')
    }
  }

  return (
    <section className="panel settings-section map-settings" aria-label="天地图设置">
      <SectionTitle title="天地图连接" english="TIANDITU MAP SERVICE" />
      <p className="map-settings-intro">
        为「想去」提供地点总览、地图搜索与选点。未配置地图时，仍可收藏地点、筛选和记录到访。
      </p>
      <PrtsForm onSubmit={(event) => void save(event)} noValidate>
        <fieldset disabled={saving} className="map-settings-fields">
          <legend className="sr-only">天地图配置</legend>
          <label className="form-label" htmlFor="map-api-key">
            天地图浏览器密钥
          </label>
          <div className="map-settings-key-row">
            <PrtsInput
              id="map-api-key"
              className="field"
              type={revealKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              maxLength={128}
              value={draft.apiKey}
              placeholder="粘贴天地图浏览器端应用的 tk"
              aria-describedby="map-key-help"
              onChange={(event) => change({ apiKey: event.target.value })}
            />
            <PrtsButton
              type="button"
              className="icon-button"
              aria-label={revealKey ? '隐藏密钥' : '显示密钥'}
              onClick={() => setRevealKey((previous) => !previous)}
            >
              {revealKey ? <EyeOff size={18} /> : <Eye size={18} />}
            </PrtsButton>
            <PrtsButton
              type="button"
              className="button button-ghost"
              disabled={!draft.apiKey}
              onClick={() => change({ apiKey: '' })}
            >
              清空密钥
            </PrtsButton>
          </div>
          <p className="field-hint" id="map-key-help">
            在{' '}
            <a href="https://console.tianditu.gov.cn/" target="_blank" rel="noopener noreferrer">
              天地图控制台
            </a>{' '}
            创建浏览器端应用，填写应用密钥，并按控制台要求配置工作台访问域名。此密钥会随地图请求发送给天地图，浏览器中可见，请勿填写服务器专用密钥。
          </p>
          <div className="form-row map-settings-coordinates">
            <div>
              <label className="form-label" htmlFor="map-center-lng">
                默认中心经度
              </label>
              <PrtsInput
                id="map-center-lng"
                className="field"
                type="number"
                min={-180}
                max={180}
                step="any"
                value={draft.longitude}
                onChange={(event) => change({ longitude: event.target.value })}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="map-center-lat">
                默认中心纬度
              </label>
              <PrtsInput
                id="map-center-lat"
                className="field"
                type="number"
                min={-85}
                max={85}
                step="any"
                value={draft.latitude}
                onChange={(event) => change({ latitude: event.target.value })}
              />
            </div>
          </div>
          <p className="field-hint">
            WGS84 经纬度，用于没有地点坐标时的初始视野；有地点时可自动查看其分布。
          </p>
          <div className="form-row">
            <div>
              <label className="form-label" htmlFor="map-default-zoom">
                默认缩放级别
              </label>
              <PrtsInput
                id="map-default-zoom"
                className="field"
                type="number"
                min={1}
                max={18}
                step={1}
                value={draft.zoom}
                onChange={(event) => change({ zoom: event.target.value })}
              />
              <p className="field-hint">1–18，数字越大，地图显示越细。</p>
            </div>
            <div>
              <label className="form-label" htmlFor="map-default-layer">
                默认底图
              </label>
              <PrtsSelect
                id="map-default-layer"
                value={draft.layer}
                onValueChange={(layer) => change({ layer: layer as MapConfig['layer'] })}
                options={[
                  { value: 'vector', label: '电子地图' },
                  { value: 'satellite', label: '影像地图' },
                ]}
              />
            </div>
          </div>
          <div className="map-settings-secondary-actions">
            <PrtsButton
              type="button"
              className="button button-ghost"
              onClick={() =>
                change({
                  longitude: String(DEFAULT_MAP_CONFIG.center.lng),
                  latitude: String(DEFAULT_MAP_CONFIG.center.lat),
                  zoom: String(DEFAULT_MAP_CONFIG.zoom),
                  layer: DEFAULT_MAP_CONFIG.layer,
                })
              }
            >
              <RotateCcw size={15} />
              恢复默认视野
            </PrtsButton>
            <PrtsButton type="button" className="button button-ghost" onClick={openPreview}>
              <MapPinned size={15} />
              预览地图
            </PrtsButton>
          </div>
        </fieldset>
        <div className="map-settings-save-row">
          <span>{dirty ? '有尚未保存的地图设置' : '配置保存在服务器，登录其他设备后可用'}</span>
          <PrtsButton type="submit" className="button button-primary" disabled={saving}>
            <Save size={16} />
            {saving ? '正在保存…' : '保存地图设置'}
          </PrtsButton>
        </div>
        {notice && (
          <p className="map-settings-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="map-settings-error" role="alert">
            {error}
          </p>
        )}
      </PrtsForm>
      <p className="field-hint">
        仅在打开地图或点击预览时连接天地图。预览使用当前草稿，不会自动保存，也不代表密钥的所有权限均已验证。
      </p>
      {preview && active && (
        <div className="map-settings-preview">
          <div className="map-settings-preview-heading">
            <strong>地图预览</strong>
            <PrtsButton className="text-button" onClick={() => setPreview(null)}>
              关闭预览
            </PrtsButton>
          </div>
          <PlacesMap places={[]} config={preview} />
        </div>
      )}
    </section>
  )
}
