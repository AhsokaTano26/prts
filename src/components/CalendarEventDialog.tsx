import { useState, type FormEvent } from 'react'
import { CalendarDays, LoaderCircle, Trash2 } from 'lucide-react'
import { makeId, type CalendarEvent } from '../lib/workspace'
import { calendarDraft, eventFromDraft, type CalendarDraft } from '../lib/calendar'
import { Modal } from './UI'
import type { TimeRange } from '../lib/calendarTimeline'
import { PrtsDatePicker, PrtsTimePicker } from './PrtsDateTimePicker'
import PrtsSwitch from './PrtsSwitch'

export default function CalendarEventDialog({
  event,
  defaultDate,
  defaultRange,
  onSave,
  onDelete,
  onClose,
}: {
  event: CalendarEvent | null
  defaultDate: string
  defaultRange?: TimeRange
  onSave: (event: CalendarEvent) => Promise<boolean>
  onDelete?: () => Promise<boolean>
  onClose: () => void
}) {
  const [identity] = useState(() => ({ id: makeId(), createdAt: new Date().toISOString() }))
  const [reference] = useState<CalendarEvent | null>(
    () =>
      event ||
      (defaultRange
        ? {
            ...identity,
            title: '',
            description: '',
            location: '',
            updatedAt: identity.createdAt,
            allDay: false,
            ...defaultRange,
          }
        : null),
  )
  const [draft, setDraft] = useState(() => calendarDraft(reference, defaultDate))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  function change<K extends keyof CalendarDraft>(key: K, value: CalendarDraft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setError('')
    setConfirmDelete(false)
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError('')
    try {
      const value = eventFromDraft(draft, reference)
      setBusy(true)
      if (!(await onSave(event ? value : { ...value, ...identity })))
        setError('保存未完成，输入已保留。可关闭弹窗后，在页面上重试保存或保留冲突草稿。')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replace('工作台数据无效：', '')
          : '日程保存失败，请重试。',
      )
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    if (busy || !onDelete) return
    setBusy(true)
    try {
      if (!(await onDelete())) setError('删除未保存到服务器，请关闭弹窗后检查页面上的保存状态。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请重试。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={event ? '编辑日程' : '新建日程'}
      onClose={() => {
        if (!busy) onClose()
      }}
      className="calendar-editor-dialog"
    >
      <form onSubmit={submit}>
        <p className="form-intro mono">
          <CalendarDays size={14} aria-hidden="true" /> SCHEDULE /{' '}
          {event ? 'UPDATE' : 'REGISTRATION'}
        </p>
        <label className="form-label" htmlFor="event-title">
          日程标题
        </label>
        <input
          autoFocus
          id="event-title"
          className="field"
          value={draft.title}
          required
          maxLength={200}
          placeholder="为接下来的时间，留一个安排"
          onChange={(e) => change('title', e.target.value)}
        />
        <PrtsSwitch
          label="全天日程"
          description="不指定具体时刻"
          checked={draft.allDay}
          disabled={busy}
          onCheckedChange={(value) => change('allDay', value)}
        />
        <div className="form-row calendar-date-row">
          <div>
            <label className="form-label" htmlFor="event-start-date">
              开始日期
            </label>
            <PrtsDatePicker
              id="event-start-date"
              label="开始日期"
              required
              disabled={busy}
              value={draft.startDate}
              onValueChange={(value) => change('startDate', value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="event-end-date">
              结束日期
            </label>
            <PrtsDatePicker
              id="event-end-date"
              label="结束日期"
              required
              disabled={busy}
              min={draft.startDate || '0001-01-01'}
              value={draft.endDate}
              onValueChange={(value) => change('endDate', value)}
            />
          </div>
        </div>
        {!draft.allDay && (
          <div className="form-row">
            <div>
              <label className="form-label" htmlFor="event-start-time">
                开始时间
              </label>
              <PrtsTimePicker
                id="event-start-time"
                label="开始时间"
                disabled={busy}
                value={draft.startTime}
                required
                onValueChange={(value) => change('startTime', value)}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="event-end-time">
                结束时间
              </label>
              <PrtsTimePicker
                id="event-end-time"
                label="结束时间"
                disabled={busy}
                value={draft.endTime}
                required
                onValueChange={(value) => change('endTime', value)}
              />
            </div>
          </div>
        )}
        <p className="field-hint">
          {draft.allDay
            ? '开始和结束日期均包含在内，全天安排不会随设备时区改变。'
            : `按本机时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone} 保存；其他设备按各自时区显示。`}
        </p>
        <label className="form-label" htmlFor="event-location">
          地点
        </label>
        <input
          id="event-location"
          className="field"
          maxLength={200}
          value={draft.location}
          placeholder="会议室、线上链接或目的地（可选）"
          onChange={(e) => change('location', e.target.value)}
        />
        <label className="form-label" htmlFor="event-description">
          备注
        </label>
        <textarea
          id="event-description"
          className="field"
          maxLength={5000}
          rows={3}
          value={draft.description}
          placeholder="记下需要提前准备的事（可选）"
          onChange={(e) => change('description', e.target.value)}
        />
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {event && onDelete && (
            <button
              type="button"
              className="button button-ghost danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              <Trash2 size={15} />
              {confirmDelete ? '确认删除' : '删除日程'}
            </button>
          )}
          <div className="action-spacer" />
          <button type="button" className="button button-ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || !draft.title.trim()}
          >
            {busy ? (
              <>
                <LoaderCircle size={15} className="auth-spinner" />
                正在保存…
              </>
            ) : event ? (
              '保存修改'
            ) : (
              '创建日程'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
