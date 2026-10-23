import { useCallback, useEffect, useRef, useState } from 'react'
import { Logo } from './UI'

interface BootSequenceProps {
  onComplete: () => void
  onReplay?: boolean
}

type BootPhase = 'load' | 'prepare' | 'ready' | 'exit'

const phaseLabels: Record<BootPhase, string> = {
  load: '载入个人工作空间',
  prepare: '整理任务与档案',
  ready: '终端就绪',
  exit: '终端就绪',
}

function readMilliseconds(style: CSSStyleDeclaration, token: string, fallback: number): number {
  const value = style.getPropertyValue(token).trim()
  const number = Number.parseFloat(value)
  if (!Number.isFinite(number) || number < 0) return fallback
  if (value.endsWith('ms')) return Math.min(number, 10_000)
  if (value.endsWith('s')) return Math.min(number * 1000, 10_000)
  return fallback
}

/** Presentation only: these phases describe preparing the local interface, not remote checks. */
export default function BootSequence({ onComplete, onReplay = false }: BootSequenceProps) {
  const [phase, setPhase] = useState<BootPhase>('load')
  const rootRef = useRef<HTMLDivElement>(null)
  const skipRef = useRef<HTMLButtonElement>(null)
  const onCompleteRef = useRef(onComplete)
  const completed = useRef(false)
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([])
  onCompleteRef.current = onComplete

  const complete = useCallback(() => {
    if (completed.current) return
    completed.current = true
    timeouts.current.forEach(clearTimeout)
    timeouts.current = []
    onCompleteRef.current()
  }, [])

  useEffect(() => {
    const element = rootRef.current
    if (!element || completed.current) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motionDisabled = () => media.matches || document.documentElement.dataset.motion === 'off'
    if (motionDisabled()) {
      complete()
      return
    }

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    skipRef.current?.focus({ preventScroll: true })
    const style = getComputedStyle(element)
    const duration = readMilliseconds(style, '--motion-boot-duration', 1600)
    const schedule = (callback: () => void, token: string, fallback: number) => {
      timeouts.current.push(
        setTimeout(callback, Math.min(duration, readMilliseconds(style, token, fallback))),
      )
    }
    schedule(() => setPhase('prepare'), '--motion-boot-prepare-at', 560)
    schedule(() => setPhase('ready'), '--motion-boot-ready-at', 1120)
    schedule(() => setPhase('exit'), '--motion-boot-exit-at', 1420)
    timeouts.current.push(setTimeout(complete, duration))

    const onPreferenceChange = () => {
      if (motionDisabled()) complete()
    }
    media.addEventListener('change', onPreferenceChange)
    const observer = new MutationObserver(onPreferenceChange)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    })

    return () => {
      timeouts.current.forEach(clearTimeout)
      timeouts.current = []
      media.removeEventListener('change', onPreferenceChange)
      observer.disconnect()
      if (element.contains(document.activeElement) && previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [complete])

  return (
    <div
      ref={rootRef}
      className="boot-sequence"
      data-phase={phase}
      data-replay={onReplay || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={onReplay ? '重播 PRTS 启动序列' : 'PRTS 启动序列'}
      onKeyDown={(event) => {
        event.stopPropagation()
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
          event.preventDefault()
        if (event.key === 'Escape') complete()
        if (event.key === 'Tab') {
          event.preventDefault()
          skipRef.current?.focus()
        }
      }}
    >
      <div className="boot-topline mono" aria-hidden="true">
        <span>
          <i />
          PRTS PERSONAL TERMINAL
        </span>
        <span>BOOT SEQUENCE</span>
      </div>
      <span className="boot-corner boot-corner-tl" aria-hidden="true" />
      <span className="boot-corner boot-corner-tr" aria-hidden="true" />
      <span className="boot-corner boot-corner-bl" aria-hidden="true" />
      <span className="boot-corner boot-corner-br" aria-hidden="true" />

      <div className="boot-center">
        <div className="boot-identity" aria-hidden="true">
          <div className="boot-emblem">
            <Logo />
          </div>
          <div className="boot-wordmark">PRTS</div>
          <div className="boot-subtitle mono">PERSONAL WORKSPACE</div>
          <div className="boot-scanline" />
        </div>
        <div className="boot-status" role="status" aria-live="polite" aria-atomic="true">
          <span className="boot-status-light" aria-hidden="true" />
          <span>{phaseLabels[phase]}</span>
        </div>
        <div className="boot-rule" aria-hidden="true">
          <span />
        </div>
        <div className="boot-enter mono" aria-hidden="true">
          <span>进入工作空间</span>
          <span>↗</span>
        </div>
      </div>

      <div className="boot-bottomline mono" aria-hidden="true">
        <span>PRTS / PERSONAL TERMINAL</span>
        <span>LOCAL WORKSPACE</span>
      </div>
      <button ref={skipRef} className="boot-skip mono" type="button" onClick={complete}>
        <span>跳过启动</span>
        <span aria-hidden="true">↗</span>
      </button>
    </div>
  )
}
