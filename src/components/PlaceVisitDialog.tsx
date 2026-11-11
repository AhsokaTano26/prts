import { PrtsButton, PrtsForm, PrtsTextarea } from './PrtsFormControls'
import { useState, type FormEvent } from 'react'
import { makeId } from '../lib/workspace'
import { validatePlaceVisit, type PlaceVisit } from '../lib/places'
import { dateKey } from '../lib/calendar'
import PlaceDraftModal, { PlaceCancelButton } from './PlaceDraftModal'
import PrtsSelect from './PrtsSelect'
import PrtsSwitch from './PrtsSwitch'
import { PrtsDatePicker } from './PrtsDateTimePicker'

export default function PlaceVisitDialog({
  visit,
  onSave,
  onClose,
}: {
  visit: PlaceVisit | null
  onSave: (visit: PlaceVisit, again: boolean) => Promise<boolean>
  onClose: () => void
}) {
  const [initial] = useState<PlaceVisit>(
    () =>
      visit || {
        id: makeId(),
        visitedOn: dateKey(new Date()),
        note: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
  )
  const [draft, setDraft] = useState(initial)
  const [again, setAgain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || again
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    try {
      if (draft.visitedOn > dateKey(new Date())) throw new Error('到访日期不能晚于今天。')
      const value = validatePlaceVisit({ ...draft, updatedAt: new Date().toISOString() })
      setBusy(true)
      if (await onSave(value, again)) onClose()
      else setError('保存未完成，输入已保留。请检查服务器保存状态。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <PlaceDraftModal
      title={visit ? '编辑到访' : '记录到访'}
      dirty={dirty}
      busy={busy}
      onClose={onClose}
    >
      <PrtsForm onSubmit={submit}>
        <fieldset className="place-fieldset" disabled={busy}>
          <p className="place-form-intro">留一点自己的感受，下次出发时再看看。</p>
          <label className="form-label" htmlFor="place-visited-on">
            到访日期
          </label>
          <PrtsDatePicker
            id="place-visited-on"
            label="到访日期"
            value={draft.visitedOn}
            onValueChange={(visitedOn) => setDraft((old) => ({ ...old, visitedOn }))}
          />
          <PrtsButton
            type="button"
            className="text-button place-date-clear"
            onClick={() => setDraft((old) => ({ ...old, visitedOn: '' }))}
          >
            日期不记得了
          </PrtsButton>
          <label className="form-label" htmlFor="place-visit-rating">
            我的评分
          </label>
          <PrtsSelect
            id="place-visit-rating"
            value={draft.rating?.toString() || ''}
            onValueChange={(rating) =>
              setDraft((old) => ({
                ...old,
                rating: rating ? (Number(rating) as PlaceVisit['rating']) : undefined,
              }))
            }
            options={[
              { value: '', label: '暂不评分' },
              ...[5, 4, 3, 2, 1].map((value) => ({
                value: String(value),
                label: `${value} 分 ${'★'.repeat(value)}`,
              })),
            ]}
          />
          <label className="form-label" htmlFor="place-visit-note">
            这次的体验
          </label>
          <PrtsTextarea
            id="place-visit-note"
            className="field"
            rows={5}
            maxLength={2000}
            value={draft.note}
            placeholder="喜欢什么？有什么需要记住？"
            onChange={(e) => setDraft((old) => ({ ...old, note: e.target.value }))}
          />
          {!visit && (
            <PrtsSwitch
              label="还想再去"
              checked={again}
              onCheckedChange={setAgain}
              description="保留在想去清单，等待下一次出发"
            />
          )}
        </fieldset>
        {error && (
          <p role="alert" className="place-form-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <PlaceCancelButton disabled={busy} />
          <PrtsButton className="button button-primary" disabled={busy}>
            {busy ? '正在保存…' : '保存到访'}
          </PrtsButton>
        </div>
      </PrtsForm>
    </PlaceDraftModal>
  )
}
