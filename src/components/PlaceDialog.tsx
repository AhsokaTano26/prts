import { PrtsButton, PrtsForm, PrtsInput, PrtsTextarea } from './PrtsFormControls'
import { useState, type FormEvent } from 'react'
import { ChevronDown, MapPin, LoaderCircle } from 'lucide-react'
import {
  createPlace,
  validatePlace,
  duplicatePlaces,
  PLACE_TYPES,
  DESIRES,
  type Place,
} from '../lib/places'
import type { MapConfig } from '../lib/placeMaps'
import PrtsSelect from './PrtsSelect'
import PlaceDraftModal, { PlaceCancelButton } from './PlaceDraftModal'
import PlacesMap from './PlacesMap'

export default function PlaceDialog({
  place,
  places,
  config,
  defaults,
  showMap,
  onSave,
  onSaved,
  onClose,
}: {
  place: Place | null
  places: Place[]
  config: MapConfig
  defaults?: Partial<Place>
  showMap?: boolean
  onSave: (place: Place) => Promise<boolean>
  onSaved?: (place: Place) => void
  onClose: () => void
}) {
  const [initial] = useState(() => place || createPlace(defaults))
  const [draft, setDraft] = useState(initial)
  const [tags, setTags] = useState(initial.tags.join('，'))
  const [lng, setLng] = useState(initial.coordinates?.lng.toString() || '')
  const [lat, setLat] = useState(initial.coordinates?.lat.toString() || '')
  const [more, setMore] = useState(Boolean(place) || Boolean(showMap))
  const [pickMap, setPickMap] = useState(Boolean(showMap))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [duplicates, setDuplicates] = useState<Place[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial) ||
    tags !== initial.tags.join('，') ||
    lng !== (initial.coordinates?.lng.toString() || '') ||
    lat !== (initial.coordinates?.lat.toString() || '')
  function change<K extends keyof Place>(key: K, value: Place[K]) {
    setDraft((old) => ({ ...old, [key]: value }))
    setError('')
    setConfirmed(false)
    setDuplicates([])
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    try {
      if ((lng.trim() === '') !== (lat.trim() === ''))
        throw new Error('请同时填写经度与纬度，或同时留空。')
      const value = validatePlace({
        ...draft,
        tags: tags
          .split(/[,，\n]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        coordinates: lng.trim() ? { lng: Number(lng), lat: Number(lat) } : undefined,
        updatedAt: new Date().toISOString(),
      })
      const matches = duplicatePlaces(places, value)
      if (!confirmed && matches.length) {
        setDuplicates(matches)
        return
      }
      setBusy(true)
      setError('')
      if (await onSave(value)) {
        onClose()
        onSaved?.(value)
      } else setError('保存未完成，输入已保留。请检查页面的服务器保存状态。')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replace('工作台数据无效：', '')
          : '保存失败，请重试。',
      )
    } finally {
      setBusy(false)
    }
  }
  const input = (
    key:
      | 'name'
      | 'city'
      | 'country'
      | 'district'
      | 'address'
      | 'budget'
      | 'openingHours'
      | 'phone'
      | 'sourceUrl'
      | 'mapUrl',
    label: string,
    max: number,
    placeholder = '',
  ) => (
    <div>
      <label className="form-label" htmlFor={`place-${key}`}>
        {label}
      </label>
      <PrtsInput
        id={`place-${key}`}
        className="field"
        value={draft[key]}
        maxLength={max}
        required={key === 'name'}
        autoFocus={key === 'name'}
        placeholder={placeholder}
        onChange={(e) => change(key, e.target.value)}
      />
    </div>
  )
  return (
    <PlaceDraftModal
      title={place ? '编辑地点' : '添加地点'}
      dirty={dirty}
      busy={busy}
      onClose={onClose}
    >
      <PrtsForm onSubmit={submit}>
        <fieldset disabled={busy} className="place-fieldset">
          <p className="form-intro mono">
            <MapPin size={14} /> PLACE / {place ? 'UPDATE' : 'REGISTRATION'}
          </p>
          {input('name', '地点名称', 200, '先记下名字，其他信息可以以后再补')}
          <div className="form-row">
            <div>
              <label className="form-label" htmlFor="place-type">
                地点类型
              </label>
              <PrtsSelect
                id="place-type"
                value={draft.type}
                onValueChange={(value) => change('type', value as Place['type'])}
                options={Object.entries(PLACE_TYPES).map(([value, label]) => ({ value, label }))}
              />
            </div>
            {input('city', '城市', 80, '例如：成都')}
          </div>
          <label className="form-label" htmlFor="place-desire">
            想去的程度
          </label>
          <PrtsSelect
            id="place-desire"
            value={draft.desire}
            onValueChange={(value) => change('desire', value as Place['desire'])}
            options={Object.entries(DESIRES).map(([value, label]) => ({ value, label }))}
          />
          <label className="form-label" htmlFor="place-note">
            收藏理由
          </label>
          <PrtsTextarea
            id="place-note"
            className="field"
            rows={3}
            maxLength={5000}
            value={draft.note}
            placeholder="为什么想去？有什么值得试试的？"
            onChange={(e) => change('note', e.target.value)}
          />
          <PrtsButton
            type="button"
            className="place-more-toggle"
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            <ChevronDown size={15} />
            {more ? '收起详细信息' : '补充更多信息'}
          </PrtsButton>
          {more && (
            <div className="place-more-fields">
              <div className="form-row">
                {input('country', '国家 / 地区', 80)}
                {input('district', '区县', 80)}
              </div>
              {input('address', '详细地址', 200)}
              <label className="form-label" htmlFor="place-tags">
                标签
              </label>
              <PrtsInput
                id="place-tags"
                className="field"
                value={tags}
                onChange={(e) => {
                  setTags(e.target.value)
                  setError('')
                }}
                placeholder="适合聚餐，需预约，周末去（用逗号分隔）"
              />
              <p className="field-hint">最多 10 个标签，每个最多 20 字符。</p>
              <div className="form-row">
                {input('budget', '预算参考', 100, '人均约 80 元 / 免费')}
                {input('phone', '电话', 80)}
              </div>
              {input('openingHours', '营业时间参考', 300, '手动记录，以店铺实际安排为准')}
              {input('sourceUrl', '推荐来源链接', 2048, 'https://…')}
              {input('mapUrl', '地图原链接', 2048, 'https://…')}
              <div className="place-location-heading">
                <span>
                  <MapPin size={15} /> 地图位置
                </span>
                <PrtsButton
                  type="button"
                  className="text-button"
                  onClick={() => setPickMap(!pickMap)}
                >
                  {pickMap ? '收起地图' : '在天地图选点'}
                </PrtsButton>
              </div>
              <p className="field-hint">
                在地图搜索或点选位置，也可以填写 WGS84 经纬度。未设坐标仍可收藏。
              </p>
              <div className="form-row">
                <div>
                  <label className="form-label" htmlFor="place-lng">
                    经度
                  </label>
                  <PrtsInput
                    id="place-lng"
                    className="field"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    placeholder="104.0665"
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="place-lat">
                    纬度
                  </label>
                  <PrtsInput
                    id="place-lat"
                    className="field"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    placeholder="30.5723"
                  />
                </div>
              </div>
              {pickMap && (
                <PlacesMap
                  places={
                    lng !== '' &&
                    lat !== '' &&
                    Number.isFinite(Number(lng)) &&
                    Number.isFinite(Number(lat))
                      ? [{ ...draft, coordinates: { lng: Number(lng), lat: Number(lat) } }]
                      : []
                  }
                  config={config}
                  onPick={(point, info) => {
                    setLng(point.lng.toFixed(6))
                    setLat(point.lat.toFixed(6))
                    if (info?.address) change('address', info.address.slice(0, 200))
                    if (!draft.name && info?.name) change('name', info.name.slice(0, 200))
                  }}
                />
              )}
            </div>
          )}
        </fieldset>
        {duplicates.length > 0 && !confirmed && (
          <div className="place-duplicate" role="status">
            <p>
              可能已经收藏过：
              {duplicates
                .map((item) => `${item.name}${item.address ? `（${item.address}）` : ''}`)
                .join('、')}
            </p>
            <p>同名分店可以分别保存。</p>
            <PrtsButton
              type="button"
              className="button button-ghost"
              onClick={() => setConfirmed(true)}
            >
              仍然新增 / 保存
            </PrtsButton>
          </div>
        )}
        {error && (
          <p className="place-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <PlaceCancelButton disabled={busy} />
          <PrtsButton className="button button-primary" disabled={busy || !draft.name.trim()}>
            {busy && <LoaderCircle size={16} className="workspace-spin" />}
            {busy ? '正在保存…' : '保存地点'}
          </PrtsButton>
        </div>
      </PrtsForm>
    </PlaceDraftModal>
  )
}
