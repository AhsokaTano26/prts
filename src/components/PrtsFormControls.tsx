import {
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Minus, Plus } from 'lucide-react'
import { stepNumberValue } from '../lib/prtsNumber'
import '../styles/prts-form-controls.css'

type InputProps = ComponentPropsWithRef<'input'>
const classes = (base: string, extra?: string) => `${base}${extra ? ` ${extra}` : ''}`

export function PrtsButton({ className, ...props }: ComponentPropsWithRef<'button'>) {
  return <button {...props} className={classes('prts-button', className)} />
}

export function PrtsInput(props: InputProps) {
  if (props.type === 'number') return <PrtsNumberInput {...props} />
  return <input {...props} className={classes('prts-input', props.className)} />
}

function PrtsNumberInput({ ref, className, onKeyDown, ...props }: InputProps) {
  const input = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => input.current!, [])
  const generatedId = useId()
  const id = props.id || `prts-number-${generatedId}`
  const raw = String(props.value ?? props.defaultValue ?? '')
  const up = stepNumberValue(raw, 1, props)
  const down = stepNumberValue(raw, -1, props)
  const disabled = props.disabled || props.readOnly
  function step(direction: 1 | -1) {
    const field = input.current
    if (!field || field.matches(':disabled') || props.readOnly) return
    const value = stepNumberValue(field.value, direction, props)
    // Use the native setter so React observes an actual input change, including controlled fields.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.focus()
  }
  return (
    <span
      className={classes('prts-number-control', className)}
      data-disabled={disabled || undefined}
    >
      <input
        {...props}
        ref={input}
        id={id}
        type="number"
        className="prts-input prts-number-input"
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (!event.defaultPrevented && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault()
            step(event.key === 'ArrowUp' ? 1 : -1)
          }
        }}
      />
      <span className="prts-number-actions">
        <PrtsButton
          type="button"
          aria-label="减小数值"
          aria-controls={id}
          disabled={disabled || down === raw}
          onClick={() => step(-1)}
        >
          <Minus size={13} aria-hidden="true" />
        </PrtsButton>
        <PrtsButton
          type="button"
          aria-label="增加数值"
          aria-controls={id}
          disabled={disabled || up === raw}
          onClick={() => step(1)}
        >
          <Plus size={13} aria-hidden="true" />
        </PrtsButton>
      </span>
    </span>
  )
}

export function PrtsTextarea({ className, ...props }: ComponentPropsWithRef<'textarea'>) {
  return <textarea {...props} className={classes('prts-textarea', className)} />
}

function validationMessage(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const label =
    ('labels' in field ? field.labels?.[0]?.textContent?.trim() : '') ||
    field.getAttribute('aria-label') ||
    '此项'
  if (field.validity.valueMissing) return `请填写${label}。`
  if (field.validity.typeMismatch) return `${label}格式不正确。`
  if (field.validity.rangeUnderflow) return `${label}不能小于 ${(field as HTMLInputElement).min}。`
  if (field.validity.rangeOverflow) return `${label}不能大于 ${(field as HTMLInputElement).max}。`
  if (field.validity.stepMismatch) return `${label}的数值不符合步长要求。`
  if (field.validity.badInput) return `${label}请输入有效数字。`
  if (field.validity.tooLong) return `${label}内容过长。`
  return `${label}格式不正确，请检查后重试。`
}

export function PrtsForm({
  children,
  onInvalidCapture,
  onInputCapture,
  onSubmit,
  ...props
}: ComponentPropsWithRef<'form'>) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  function invalid(event: FormEvent<HTMLFormElement>) {
    onInvalidCapture?.(event)
    event.preventDefault()
    const field = event.target
    if (!(
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement ||
      field instanceof HTMLSelectElement
    ))
      return
    const key =
      field.id || field.name || String(Array.from(event.currentTarget.elements).indexOf(field))
    setErrors((previous) => ({ ...previous, [key]: validationMessage(field) }))
    const first = event.currentTarget.querySelector<HTMLElement>(
      'input:invalid, textarea:invalid, select:invalid',
    )
    if (first === field) queueMicrotask(() => first.focus())
  }
  return (
    <form
      {...props}
      onInvalidCapture={invalid}
      onInputCapture={(event) => {
        onInputCapture?.(event)
        const field = event.target as HTMLInputElement
        if (field.id || field.name)
          setErrors((previous) => {
            if (!Object.hasOwn(previous, field.id || field.name)) return previous
            const next = { ...previous }
            delete next[field.id || field.name]
            return next
          })
      }}
      onSubmit={(event) => {
        setErrors({})
        onSubmit?.(event)
      }}
    >
      {Object.keys(errors).length > 0 && (
        <div className="prts-form-errors" role="alert">
          {Object.entries(errors).map(([key, message]) => (
            <p key={key}>{message}</p>
          ))}
        </div>
      )}
      {children}
    </form>
  )
}

export function PrtsDisclosure({
  className,
  children,
  ...props
}: ComponentPropsWithRef<'details'> & { children?: ReactNode }) {
  return (
    <details {...props} className={classes('prts-disclosure', className)}>
      {children}
    </details>
  )
}
