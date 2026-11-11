import { PrtsButton, PrtsTextarea } from './PrtsFormControls'
import { useState } from 'react'
import {
  ArrowLeft,
  MapPin,
  ExternalLink,
  Copy,
  CalendarPlus,
  Pencil,
  Archive,
  RotateCcw,
  Trash2,
  Star,
  Compass,
  Plus,
} from 'lucide-react'
import {
  PLACE_TYPES,
  DESIRES,
  placeStatus,
  sortedVisits,
  type Place,
  type PlaceVisit,
} from '../lib/places'
import PrtsSwitch from './PrtsSwitch'
import { Modal } from './UI'

export default function PlaceDetail({
  place,
  busy,
  onClose,
  onEdit,
  onVisit,
  onDeleteVisit,
  onChange,
  onDelete,
  onEvent,
  onMap,
  onNotify,
}: {
  place: Place
  busy: boolean
  onClose: () => void
  onEdit: () => void
  onVisit: (visit: PlaceVisit | null) => void
  onDeleteVisit: (visit: PlaceVisit) => Promise<boolean>
  onChange: (place: Place, message: string) => Promise<boolean>
  onDelete: () => Promise<boolean>
  onEvent: () => void
  onMap: () => void
  onNotify: (message: string) => void
}) {
  const [confirmation, setConfirmation] = useState<{
    title: string
    text: string
    run: () => Promise<boolean>
  } | null>(null)
  const [error, setError] = useState('')
  const [copyText, setCopyText] = useState('')
  const visits = sortedVisits(place)
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      onNotify('已复制')
    } catch {
      setCopyText(value)
    }
  }
  async function change(value: Place, message: string) {
    setError('')
    try {
      if (!(await onChange(value, message))) setError('保存未完成，请检查服务器保存状态。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    }
  }
  return (
    <aside className="place-detail" aria-label="地点详情">
      <div className="place-detail-top">
        <PrtsButton className="text-button" onClick={onClose}>
          <ArrowLeft size={14} />
          返回清单
        </PrtsButton>
        <span className="mono">PLACE ARCHIVE</span>
      </div>
      <div className="place-detail-body">
        <div className="place-detail-type">
          <MapPin size={15} />
          <span>{PLACE_TYPES[place.type]}</span>
          <span className={`place-desire desire-${place.desire}`}>{DESIRES[place.desire]}</span>
        </div>
        <h2>{place.name}</h2>
        <div className={`place-state state-${placeStatus(place)}`}>
          <span aria-hidden="true">●</span>
          {placeStatus(place)}
        </div>
        <div className="place-detail-location">
          <MapPin size={17} />
          <div>
            <p>
              {[place.country, place.city, place.district].filter(Boolean).join(' · ') ||
                '位置待补充'}
            </p>
            {place.address && <p>{place.address}</p>}
          </div>
        </div>
        <div className="place-action-row place-map-actions">
          <PrtsButton className="button button-ghost" onClick={onMap}>
            <MapPin size={14} />
            {place.coordinates ? '在地图中查看' : '设置地图位置'}
          </PrtsButton>
          {place.mapUrl && (
            <a
              className="button button-ghost"
              href={place.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              <ExternalLink size={14} />
              打开原地图链接
            </a>
          )}
          <PrtsButton
            className="button button-ghost"
            disabled={!place.address}
            onClick={() => void copy(place.address)}
            title={place.address ? '复制地址' : '请先补充详细地址'}
          >
            <Copy size={14} />
            复制地址
          </PrtsButton>
        </div>
        {!place.coordinates && (
          <p className="place-location-hint">尚未设置地图位置；可在编辑中搜索或选点。</p>
        )}
        {place.note && (
          <section className="place-detail-section">
            <h3>
              为什么想去 <span>REASON</span>
            </h3>
            <p className="place-prose">{place.note}</p>
          </section>
        )}
        {place.tags.length > 0 && (
          <div className="place-tags">
            {place.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
        {(place.budget || place.openingHours || place.phone || place.sourceUrl) && (
          <section className="place-detail-section">
            <h3>
              出发前看看 <span>INFORMATION</span>
            </h3>
            <dl className="place-info">
              {place.budget && (
                <>
                  <dt>预算参考</dt>
                  <dd>{place.budget}</dd>
                </>
              )}
              {place.openingHours && (
                <>
                  <dt>营业时间参考</dt>
                  <dd>{place.openingHours}</dd>
                </>
              )}
              {place.phone && (
                <>
                  <dt>电话</dt>
                  <dd>
                    <PrtsButton className="text-button" onClick={() => void copy(place.phone)}>
                      {place.phone}
                      <Copy size={12} />
                    </PrtsButton>
                  </dd>
                </>
              )}
              {place.sourceUrl && (
                <>
                  <dt>推荐来源</dt>
                  <dd>
                    <a
                      href={place.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      {new URL(place.sourceUrl).hostname}
                      <ExternalLink size={12} />
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </section>
        )}
        <section className="place-detail-section">
          <div className="place-visits-heading">
            <h3>
              到访记录 <span>{String(visits.length).padStart(2, '0')} VISITS</span>
            </h3>
            {!place.archivedAt && (
              <PrtsButton
                className="icon-button"
                aria-label="新增到访记录"
                onClick={() => onVisit(null)}
                disabled={busy || visits.length >= 200}
              >
                <Plus size={16} />
              </PrtsButton>
            )}
          </div>
          {!visits.length ? (
            <p className="place-muted-copy">还没有到访记录。去过之后，留一点自己的感受。</p>
          ) : (
            <ol className="place-visits">
              {visits.map((visit) => (
                <li key={visit.id}>
                  <div className="place-visit-heading">
                    <time dateTime={visit.visitedOn || undefined}>
                      {visit.visitedOn || '日期未记录'}
                    </time>
                    {visit.rating && (
                      <span className="place-rating">
                        <Star size={12} />
                        {visit.rating} / 5
                      </span>
                    )}
                  </div>
                  {visit.note && <p className="place-prose">{visit.note}</p>}
                  {!place.archivedAt && (
                    <div className="place-visit-actions">
                      <PrtsButton
                        className="text-button"
                        disabled={busy}
                        onClick={() => onVisit(visit)}
                      >
                        编辑
                      </PrtsButton>
                      <PrtsButton
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          setConfirmation({
                            title: '删除到访记录',
                            text: `将删除这次到访${visits.length === 1 ? '，这个地点会重新进入想去清单' : ''}。此操作无法撤销。`,
                            run: () => onDeleteVisit(visit),
                          })
                        }
                      >
                        删除
                      </PrtsButton>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
        {visits.length > 0 && !place.archivedAt && (
          <PrtsSwitch
            label="还想再去"
            description="去过也可以继续期待下一次"
            checked={place.wantAgain}
            disabled={busy}
            onCheckedChange={(wantAgain) =>
              void change({ ...place, wantAgain }, wantAgain ? '已加入想再去' : '已更新再访意愿')
            }
          />
        )}
        {error && (
          <p className="place-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="place-detail-footer">
          <span>收藏于 {place.createdAt.slice(0, 10)}</span>
          <span>更新于 {place.updatedAt.slice(0, 10)}</span>
        </div>
      </div>
      <div className="place-detail-actions">
        {place.archivedAt ? (
          <>
            <PrtsButton
              className="button button-primary"
              disabled={busy}
              onClick={() => void change({ ...place, archivedAt: undefined }, '地点已恢复')}
            >
              <RotateCcw size={15} />
              恢复地点
            </PrtsButton>
            <PrtsButton
              className="button button-ghost danger"
              disabled={busy}
              onClick={() =>
                setConfirmation({
                  title: '永久删除地点',
                  text: `将永久删除「${place.name}」及 ${visits.length} 条到访记录，已创建的日程会保留。此操作无法撤销。`,
                  run: onDelete,
                })
              }
            >
              <Trash2 size={15} />
              永久删除
            </PrtsButton>
          </>
        ) : (
          <>
            <PrtsButton
              className="button button-primary"
              disabled={busy || visits.length >= 200}
              onClick={() => onVisit(null)}
            >
              <Compass size={15} />
              {visits.length ? '再记一次到访' : '记录去过'}
            </PrtsButton>
            <PrtsButton className="button button-ghost" onClick={onEvent} disabled={busy}>
              <CalendarPlus size={15} />
              创建日程
            </PrtsButton>
            <PrtsButton className="button button-ghost" onClick={onEdit} disabled={busy}>
              <Pencil size={14} />
              编辑地点
            </PrtsButton>
            <PrtsButton
              className="button button-ghost"
              disabled={busy}
              onClick={() =>
                void change(
                  { ...place, archivedAt: new Date().toISOString() },
                  '地点已归档，可在已归档中恢复',
                )
              }
            >
              <Archive size={14} />
              归档地点
            </PrtsButton>
          </>
        )}
      </div>
      {confirmation && (
        <Modal
          title={confirmation.title}
          onClose={() => {
            if (!busy) setConfirmation(null)
          }}
        >
          <p className="modal-copy">{confirmation.text}</p>
          {error && <p role="alert">{error}</p>}
          <div className="modal-actions">
            <PrtsButton
              className="button button-ghost"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              取消
            </PrtsButton>
            <PrtsButton
              className="button danger"
              disabled={busy}
              onClick={async () => {
                try {
                  if (await confirmation.run()) setConfirmation(null)
                  else setError('操作未完成，请检查服务器保存状态。')
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : '操作失败')
                }
              }}
            >
              确认删除
            </PrtsButton>
          </div>
        </Modal>
      )}
      {copyText && (
        <Modal title="手动复制" onClose={() => setCopyText('')}>
          <p className="modal-copy">浏览器未允许自动复制，请选中以下内容复制。</p>
          <PrtsTextarea
            className="field"
            aria-label="待复制内容"
            readOnly
            value={copyText}
            onFocus={(e) => e.target.select()}
          />
        </Modal>
      )}
    </aside>
  )
}
