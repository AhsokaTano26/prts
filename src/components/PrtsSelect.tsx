import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Check, ChevronDown } from 'lucide-react'
import '../styles/prts-select.css'

export type PrtsSelectOption = { value: string; label: string; description?: string }

type Props = {
  value: string
  onValueChange: (value: string) => void
  options: PrtsSelectOption[]
  id?: string
  'aria-label'?: string
  className?: string
  disabled?: boolean
}

export default function PrtsSelect({
  value,
  onValueChange,
  options,
  id,
  'aria-label': ariaLabel,
  className = '',
  disabled = false,
}: Props) {
  const generatedId = useId()
  const controlId = id || `prts-select-${generatedId}`
  const listId = `${controlId}-listbox`
  const selectedIndex = options.findIndex((option) => option.value === value)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex))
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const openRef = useRef(false)

  const close = useCallback((restoreFocus = false) => {
    if (popup.current?.matches(':popover-open')) popup.current.hidePopover()
    openRef.current = false
    setOpen(false)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }, [])

  const position = useCallback(() => {
    const menu = popup.current
    const button = trigger.current
    if (!menu || !button || !menu.matches(':popover-open')) return
    const rect = button.getBoundingClientRect()
    const viewport = window.visualViewport
    const viewportLeft = viewport?.offsetLeft || 0
    const viewportTop = viewport?.offsetTop || 0
    const viewportWidth = viewport?.width || document.documentElement.clientWidth
    const viewportHeight = viewport?.height || window.innerHeight
    const edge = 8
    const gap = 6
    const width = Math.min(Math.max(rect.width, 180), viewportWidth - edge * 2)
    menu.style.width = `${width}px`
    const desiredHeight = Math.min(menu.scrollHeight + 2, 320)
    const below = Math.max(0, viewportTop + viewportHeight - rect.bottom - gap - edge)
    const above = Math.max(0, rect.top - viewportTop - gap - edge)
    const flip = below < desiredHeight && above > below
    const maxHeight = Math.min(320, flip ? above : below, viewportHeight - edge * 2)
    const height = Math.min(desiredHeight, maxHeight)
    const left = Math.max(
      viewportLeft + edge,
      Math.min(rect.left, viewportLeft + viewportWidth - width - edge),
    )
    const top = flip ? rect.top - gap - height : rect.bottom + gap
    menu.style.left = `${left}px`
    menu.style.top = `${Math.max(viewportTop + edge, Math.min(top, viewportTop + viewportHeight - height - edge))}px`
    menu.style.maxHeight = `${maxHeight}px`
    menu.dataset.placement = flip ? 'top' : 'bottom'
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    position()
    const menu = popup.current
    const option = document.getElementById(`${listId}-option-${activeIndex}`)
    if (!menu || !option) return
    const menuRect = menu.getBoundingClientRect()
    const optionRect = option.getBoundingClientRect()
    if (optionRect.top < menuRect.top + 4) menu.scrollTop -= menuRect.top + 4 - optionRect.top
    else if (optionRect.bottom > menuRect.bottom - 4)
      menu.scrollTop += optionRect.bottom - menuRect.bottom + 4
  }, [open, activeIndex, listId, position])

  useEffect(() => {
    if (disabled || !options.length) close()
    setActiveIndex(Math.max(0, selectedIndex))
  }, [disabled, options.length, selectedIndex, close])

  useEffect(() => {
    if (!open) return
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close()
    }
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    document.addEventListener('focusin', onFocus)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    const observer = new ResizeObserver(position)
    if (trigger.current) observer.observe(trigger.current)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      document.removeEventListener('focusin', onFocus)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
      observer.disconnect()
    }
  }, [open, position, close])

  function show(index: number) {
    if (disabled || !options.length) return
    // Native invoker activation preserves light-dismiss and dialog/top-layer behavior.
    if (!openRef.current) trigger.current?.click()
    setActiveIndex(index)
  }

  function choose(index: number) {
    const option = options[index]
    if (!option || disabled) return
    close(true)
    if (option.value !== value) onValueChange(option.value)
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (disabled || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return
    const isOpen = openRef.current
    if (event.key === 'Tab') {
      if (isOpen) close()
      return
    }
    if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault()
        event.stopPropagation()
        close(true)
      }
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter' || event.key === ' ') {
      if (isOpen) choose(activeIndex)
      else show(Math.max(0, selectedIndex))
    } else if (event.key === 'Home') show(0)
    else if (event.key === 'End') show(options.length - 1)
    else if (!isOpen)
      show(selectedIndex >= 0 ? selectedIndex : event.key === 'ArrowUp' ? options.length - 1 : 0)
    else {
      setActiveIndex((current) =>
        Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))),
      )
    }
  }

  return (
    <span ref={root} className={`prts-select ${className}`.trim()}>
      <button
        ref={trigger}
        id={controlId}
        type="button"
        className="prts-select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && options[activeIndex] ? `${listId}-option-${activeIndex}` : undefined
        }
        disabled={disabled || !options.length}
        popoverTarget={listId}
        onClick={() => {
          if (!openRef.current) setActiveIndex(Math.max(0, selectedIndex))
        }}
        onKeyDown={onKeyDown}
      >
        <span className="prts-select-value">{options[selectedIndex]?.label || '请选择'}</span>
        <ChevronDown className="prts-select-chevron" aria-hidden="true" size={14} />
      </button>
      <div
        ref={popup}
        id={listId}
        popover="auto"
        role="listbox"
        aria-label={ariaLabel ? `${ariaLabel}选项` : undefined}
        aria-labelledby={ariaLabel ? undefined : controlId}
        className="prts-select-popover"
        onBeforeToggle={(event) => {
          openRef.current = event.newState === 'open'
          setOpen(event.newState === 'open')
        }}
        onToggle={(event) => {
          openRef.current = event.newState === 'open'
          setOpen(event.newState === 'open')
          if (event.newState === 'open') position()
        }}
        onKeyDown={onKeyDown}
      >
        {options.map((option, index) => (
          <button
            id={`${listId}-option-${index}`}
            key={option.value}
            type="button"
            role="option"
            tabIndex={-1}
            aria-label={option.label}
            aria-describedby={option.description ? `${listId}-description-${index}` : undefined}
            aria-selected={option.value === value}
            data-active={index === activeIndex}
            className="prts-select-option"
            onMouseDown={(event) => event.preventDefault()}
            onPointerMove={() => setActiveIndex(index)}
            onClick={() => choose(index)}
          >
            <span className="prts-select-option-copy">
              <span className="prts-select-option-label">{option.label}</span>
              {option.description && (
                <span
                  id={`${listId}-description-${index}`}
                  className="prts-select-option-description"
                >
                  {option.description}
                </span>
              )}
            </span>
            <Check className="prts-select-check" aria-hidden="true" size={14} />
          </button>
        ))}
      </div>
    </span>
  )
}
