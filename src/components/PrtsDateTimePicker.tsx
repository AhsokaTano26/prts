import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react'
import { addDays, dateKey, monthDays, shiftMonth } from '../lib/calendar'
import '../styles/prts-picker.css'

type PickerProps = {
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
  required?: boolean
  disabled?: boolean
}

const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  value >= '0001-01-01' &&
  value <= '9999-12-31' &&
  Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const pad = (value: number) => String(value).padStart(2, '0')

function PickerField({
  id,
  label,
  value,
  onValueChange,
  required,
  disabled,
  kind,
  min,
  children,
}: PickerProps & {
  kind: 'date' | 'time'
  min?: string
  children: (close: () => void) => ReactNode
}) {
  const panelId = `prts-picker-${useId()}`
  const [open, setOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const valid = kind === 'date' ? validDate(value) && (!min || value >= min) : validTime(value)
  const invalid = value ? !valid : Boolean(required)
  const error =
    kind === 'date'
      ? min && validDate(value) && value < min
        ? `请选择 ${min} 或之后的日期。`
        : '请输入有效日期，格式为 YYYY-MM-DD。'
      : '请输入有效的 24 小时时间，格式为 HH:mm。'

  useEffect(() => {
    input.current?.setCustomValidity(invalid ? error : '')
  }, [invalid, error])

  const close = useCallback((restoreFocus = true) => {
    if (popup.current?.matches(':popover-open')) popup.current.hidePopover()
    setOpen(false)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }, [])

  const position = useCallback(() => {
    const panel = popup.current
    const field = root.current
    if (!panel?.matches(':popover-open') || !field) return
    const rect = field.getBoundingClientRect()
    const viewport = window.visualViewport
    const left = viewport?.offsetLeft || 0
    const top = viewport?.offsetTop || 0
    const width = viewport?.width || document.documentElement.clientWidth
    const height = viewport?.height || window.innerHeight
    const panelWidth = Math.min(304, width - 16)
    panel.style.width = `${panelWidth}px`
    panel.style.maxHeight = `${height - 16}px`
    const desiredHeight = panel.scrollHeight + 2
    const below = Math.max(0, top + height - rect.bottom - 14)
    const above = Math.max(0, rect.top - top - 14)
    const flip = below < desiredHeight && above > below
    const panelHeight = Math.min(desiredHeight, height - 16)
    panel.style.maxHeight = `${panelHeight}px`
    panel.style.left = `${Math.max(left + 8, Math.min(rect.left, left + width - panelWidth - 8))}px`
    panel.style.top = `${Math.max(top + 8, Math.min(flip ? rect.top - 6 - panelHeight : rect.bottom + 6, top + height - panelHeight - 8))}px`
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    position()
    popup.current
      ?.querySelector<HTMLElement>('[data-picker-focus="true"]')
      ?.focus({ preventScroll: true })
  }, [open, position])

  useEffect(() => {
    if (!open) return
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close(false)
    }
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    document.addEventListener('focusin', onFocus)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
      document.removeEventListener('focusin', onFocus)
    }
  }, [open, close, position])

  useEffect(() => {
    if (disabled) close(false)
  }, [disabled, close])

  return (
    <div
      ref={root}
      className="prts-picker"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
    >
      <div className={`prts-picker-field${open ? ' is-open' : ''}`}>
        <input
          ref={input}
          id={id}
          type="text"
          inputMode="text"
          className="prts-picker-input"
          value={value}
          placeholder={kind === 'date' ? 'YYYY-MM-DD' : 'HH:mm'}
          maxLength={kind === 'date' ? 10 : 5}
          autoComplete="off"
          spellCheck={false}
          required={required}
          disabled={disabled}
          aria-invalid={touched && invalid ? true : undefined}
          aria-describedby={touched && invalid ? `${panelId}-error` : undefined}
          onInvalid={(event) => {
            event.preventDefault()
            setTouched(true)
            if (event.currentTarget.form?.querySelector(':invalid') === event.currentTarget)
              event.currentTarget.focus()
          }}
          onBlur={() => setTouched(true)}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && !open) {
              event.preventDefault()
              trigger.current?.click()
            }
          }}
        />
        <button
          ref={trigger}
          type="button"
          className="prts-picker-trigger"
          aria-label={`选择${label}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          popoverTarget={panelId}
          disabled={disabled}
        >
          {kind === 'date' ? (
            <CalendarDays size={17} aria-hidden="true" />
          ) : (
            <Clock3 size={17} aria-hidden="true" />
          )}
        </button>
      </div>
      {touched && invalid && (
        <span id={`${panelId}-error`} className="prts-picker-error">
          {error}
        </span>
      )}
      <div
        ref={popup}
        id={panelId}
        popover="auto"
        role="dialog"
        aria-label={`选择${label}`}
        className={`prts-picker-popover prts-${kind}-popover`}
        onBeforeToggle={(event) => setOpen(event.newState === 'open')}
        onToggle={(event) => {
          setOpen(event.newState === 'open')
          if (event.newState === 'open') {
            position()
            // beforetoggle runs while the panel is still hidden; focus and measure after opening.
            popup.current
              ?.querySelector<HTMLElement>('[data-picker-focus="true"]')
              ?.focus({ preventScroll: true })
            popup.current
              ?.querySelectorAll<HTMLElement>('[role="option"][aria-selected="true"]')
              .forEach((option) => {
                const list = option.parentElement!
                list.scrollTop = option.offsetTop - list.clientHeight / 2 + option.offsetHeight / 2
              })
          }
        }}
      >
        {open && children(() => close())}
      </div>
    </div>
  )
}

function DatePanel({
  value,
  min,
  required,
  onValueChange,
  close,
}: PickerProps & { min: string; close: () => void }) {
  const today = dateKey(new Date())
  const initial = validDate(value) && value >= min ? value : today < min ? min : today
  const [active, setActive] = useState(initial)
  const [month, setMonth] = useState(`${initial.slice(0, 7)}-01`)
  const [year, setYear] = useState(initial.slice(0, 4))
  const grid = useRef<HTMLDivElement>(null)
  const focusDay = useRef(false)
  const headerId = useId()
  const days = monthDays(month)
  useLayoutEffect(() => {
    if (focusDay.current) {
      grid.current
        ?.querySelector<HTMLElement>(`[data-day="${active}"]`)
        ?.focus({ preventScroll: true })
      focusDay.current = false
    }
  }, [active, month])

  function move(next: string, restoreFocus = true) {
    if (!validDate(next)) return
    const day = next < min ? min : next
    focusDay.current = restoreFocus
    setActive(day)
    setMonth(`${day.slice(0, 7)}-01`)
    setYear(day.slice(0, 4))
  }
  function choose(day: string) {
    onValueChange(day)
    close()
  }
  function changeYear(restoreFocus = false) {
    const number = Number(year)
    if (!/^\d{1,4}$/.test(year) || number < 1 || number > 9999) {
      setYear(month.slice(0, 4))
      return
    }
    if (number === Number(month.slice(0, 4))) {
      setYear(month.slice(0, 4))
      if (restoreFocus)
        grid.current
          ?.querySelector<HTMLElement>(`[data-day="${active}"]`)
          ?.focus({ preventScroll: true })
      return
    }
    const day = `${String(number).padStart(4, '0')}${month.slice(4)}`
    move(day < min ? min : day, restoreFocus)
  }
  function onDayKey(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return
    const index = days.indexOf(day) % 7
    let next: string
    if (event.key === 'ArrowLeft') next = addDays(day, -1)
    else if (event.key === 'ArrowRight') next = addDays(day, 1)
    else if (event.key === 'ArrowUp') next = addDays(day, -7)
    else if (event.key === 'ArrowDown') next = addDays(day, 7)
    else if (event.key === 'Home') next = addDays(day, -index)
    else if (event.key === 'End') next = addDays(day, 6 - index)
    else if (event.key === 'PageUp') next = shiftMonth(day, event.shiftKey ? -12 : -1)
    else if (event.key === 'PageDown') next = shiftMonth(day, event.shiftKey ? 12 : 1)
    else return
    event.preventDefault()
    event.stopPropagation()
    move(next < min ? min : next)
  }

  return (
    <>
      <div className="prts-date-header">
        <button
          type="button"
          className="prts-picker-icon"
          aria-label="上个月"
          disabled={month.slice(0, 7) <= min.slice(0, 7)}
          onClick={() => move(shiftMonth(month, -1))}
        >
          <ChevronLeft size={17} />
        </button>
        <div className="prts-date-heading">
          <input
            type="text"
            inputMode="numeric"
            aria-label="年份"
            value={year}
            maxLength={4}
            onChange={(event) => setYear(event.target.value)}
            onBlur={() => changeYear()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                changeYear(true)
              }
            }}
          />
          <span id={headerId} aria-live="polite">
            年 {Number(month.slice(5, 7))} 月
          </span>
        </div>
        <button
          type="button"
          className="prts-picker-icon"
          aria-label="下个月"
          disabled={month.startsWith('9999-12')}
          onClick={() => move(shiftMonth(month, 1))}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <div
        ref={grid}
        role="grid"
        aria-label={`${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`}
        className="prts-date-grid"
      >
        <div role="row" className="prts-date-weekdays">
          {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
            <span role="columnheader" key={day}>
              {day}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => (
          <div role="row" key={week} className="prts-date-week">
            {days.slice(week * 7, week * 7 + 7).map((day) =>
              validDate(day) ? (
                <button
                  key={day}
                  type="button"
                  role="gridcell"
                  aria-label={day}
                  data-day={day}
                  aria-selected={day === value}
                  aria-current={day === today ? 'date' : undefined}
                  data-outside={day.slice(0, 7) !== month.slice(0, 7)}
                  data-picker-focus={day === active}
                  tabIndex={day === active ? 0 : -1}
                  disabled={day < min}
                  onKeyDown={(event) => onDayKey(event, day)}
                  onClick={() => choose(day)}
                >
                  {Number(day.slice(8, 10))}
                </button>
              ) : (
                <span key={day} role="gridcell" />
              ),
            )}
          </div>
        ))}
      </div>
      <div className="prts-picker-footer">
        <span className="prts-picker-hint">YYYY-MM-DD</span>
        {!required && (
          <button type="button" className="text-button" onClick={() => choose('')}>
            清除日期
          </button>
        )}
        <button
          type="button"
          className="text-button"
          disabled={today < min}
          onClick={() => choose(today)}
        >
          今天
        </button>
      </div>
    </>
  )
}

export function PrtsDatePicker(props: PickerProps & { min?: string }) {
  const min = props.min && validDate(props.min) ? props.min : '0001-01-01'
  return (
    <PickerField {...props} min={min} kind="date">
      {(close) => <DatePanel {...props} min={min} close={close} />}
    </PickerField>
  )
}

function TimePanel({ value, required, onValueChange, close }: PickerProps & { close: () => void }) {
  const hour = validTime(value) ? Number(value.slice(0, 2)) : 9
  const minute = validTime(value) ? Number(value.slice(3)) : 0
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    root.current
      ?.querySelectorAll<HTMLElement>('[role="option"][aria-selected="true"]')
      .forEach((option) => {
        const list = option.parentElement!
        list.scrollTop = option.offsetTop - list.clientHeight / 2 + option.offsetHeight / 2
      })
  }, [hour, minute])
  function select(column: number, number: number) {
    onValueChange(`${pad(column === 0 ? number : hour)}:${pad(column === 1 ? number : minute)}`)
  }
  return (
    <>
      <div className="prts-time-heading">
        <Clock3 size={15} aria-hidden="true" />
        <span>24 小时制</span>
        <strong>{validTime(value) ? value : '选择时间'}</strong>
      </div>
      <div ref={root} className="prts-time-columns">
        {['小时', '分钟'].map((label, column) => (
          <div key={label} className="prts-time-column">
            <span className="prts-time-label">{label}</span>
            <div role="listbox" aria-label={label} className="prts-time-list">
              {Array.from({ length: column === 0 ? 24 : 60 }, (_, number) => (
                <button
                  type="button"
                  role="option"
                  key={number}
                  aria-selected={number === (column === 0 ? hour : minute)}
                  tabIndex={number === (column === 0 ? hour : minute) ? 0 : -1}
                  data-picker-focus={column === 0 && number === hour}
                  onClick={() => select(column, number)}
                  onKeyDown={(event) => {
                    const max = column === 0 ? 23 : 59
                    const next =
                      event.key === 'ArrowDown'
                        ? Math.min(max, number + 1)
                        : event.key === 'ArrowUp'
                          ? Math.max(0, number - 1)
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? max
                              : null
                    if (next === null) return
                    event.preventDefault()
                    event.stopPropagation()
                    select(column, next)
                    event.currentTarget.parentElement
                      ?.querySelectorAll<HTMLButtonElement>('button')
                      [next]?.focus({ preventScroll: true })
                  }}
                >
                  {pad(number)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="prts-picker-footer">
        <span className="prts-picker-hint">HH:mm</span>
        {!required && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              onValueChange('')
              close()
            }}
          >
            清除时间
          </button>
        )}
        <button
          type="button"
          className="button button-primary prts-picker-done"
          onClick={() => {
            if (!validTime(value)) select(0, hour)
            close()
          }}
        >
          完成
        </button>
      </div>
    </>
  )
}

export function PrtsTimePicker(props: PickerProps) {
  return (
    <PickerField {...props} kind="time">
      {(close) => <TimePanel {...props} close={close} />}
    </PickerField>
  )
}
