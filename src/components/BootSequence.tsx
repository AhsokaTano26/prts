import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Logo } from './UI'
import { useAppearance } from '../lib/appearance'
import RhineInstrument from './RhineInstrument'
import EndfieldBootVisual from './EndfieldBootVisual'
import { attachEndfieldOpeningMotion } from '../lib/endfieldOpening'

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
  const { theme } = useAppearance()
  const [phase, setPhase] = useState<BootPhase>('load')
  const [artworkReady, setArtworkReady] = useState(false)
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
    let disposed = false
    let stopFilm: (() => void) | undefined
    setPhase('load')
    if (theme === 'endfield') {
      const film = element.querySelector('video')
      setArtworkReady(false)
      if (!film) {
        complete()
        return
      }
      let started = false
      let ended = false
      // No deliberate pre-roll. Slow/failed media must never block the workspace.
      const loadingDeadline = setTimeout(complete, 1200)
      timeouts.current.push(loadingDeadline)
      const onPlaying = () => {
        if (disposed || completed.current || started) return
        started = true
        clearTimeout(loadingDeadline)
        setArtworkReady(true)
        timeouts.current.push(setTimeout(complete, 3000))
      }
      const onTimeUpdate = () => {
        if (disposed || completed.current || ended) return
        setPhase(film.currentTime >= 1.8 ? 'ready' : film.currentTime >= 0.5 ? 'prepare' : 'load')
      }
      const onEnded = () => {
        if (disposed || completed.current || ended) return
        ended = true
        setPhase('exit')
        timeouts.current.push(setTimeout(complete, 100))
      }
      const onError = () => {
        if (!disposed) complete()
      }
      film.muted = true
      film.playbackRate = 1.5
      const stopOpeningMotion = attachEndfieldOpeningMotion(film)
      film.addEventListener('playing', onPlaying)
      film.addEventListener('timeupdate', onTimeUpdate)
      film.addEventListener('ended', onEnded)
      film.addEventListener('error', onError)
      void film.play().catch(onError)
      stopFilm = () => {
        stopOpeningMotion()
        film.removeEventListener('playing', onPlaying)
        film.removeEventListener('timeupdate', onTimeUpdate)
        film.removeEventListener('ended', onEnded)
        film.removeEventListener('error', onError)
        film.pause()
      }
    } else {
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
    }

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
      disposed = true
      stopFilm?.()
      timeouts.current.forEach(clearTimeout)
      timeouts.current = []
      media.removeEventListener('change', onPreferenceChange)
      observer.disconnect()
      if (element.contains(document.activeElement) && previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [complete, theme])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation()
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') event.preventDefault()
    if (event.key === 'Escape') complete()
    if (event.key === 'Tab') {
      event.preventDefault()
      skipRef.current?.focus()
    }
  }

  if (theme === 'endfield')
    return (
      <div
        ref={rootRef}
        className="boot-sequence boot-sequence--endfield"
        data-phase={phase}
        data-artwork={artworkReady ? 'ready' : 'waiting'}
        data-replay={onReplay || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={onReplay ? '重播 PRTS 启动序列' : 'PRTS 启动序列'}
        onKeyDown={handleKeyDown}
      >
        <EndfieldBootVisual />
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {phaseLabels[phase]}
        </span>
        <button ref={skipRef} className="boot-skip mono" type="button" onClick={complete}>
          <span>跳过启动</span>
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    )

  if (theme === 'rhine')
    return (
      <div
        ref={rootRef}
        className="boot-sequence boot-sequence--rhine"
        data-phase={phase}
        data-replay={onReplay || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={onReplay ? '重播 PRTS 启动序列' : 'PRTS 启动序列'}
        onKeyDown={handleKeyDown}
      >
        <div className="rhine-boot-brand" aria-hidden="true">
          <strong>RHINE LAB</strong>
          <span>SYNTHESIZE INFORMATION</span>
          <span>
            ANALYSIS <b>OS</b>
          </span>
        </div>
        <span className="rhine-boot-edition mono" aria-hidden="true">
          PERSONAL RESEARCH TERMINAL / 01
        </span>
        <div className="rhine-boot-center">
          <div className="rhine-boot-instrument">
            <RhineInstrument />
            <Logo />
          </div>
          <div className="rhine-boot-copy">
            <p className="mono">WORKSPACE INITIALIZATION</p>
            <h1>
              CONNECT.
              <br />
              <mark>DISCOVER.</mark>
            </h1>
            <div className="rhine-boot-status" role="status" aria-live="polite" aria-atomic="true">
              <i aria-hidden="true" />
              {phase === 'load'
                ? '载入科研工作空间'
                : phase === 'prepare'
                  ? '展开任务与档案'
                  : '研究终端已就绪'}
            </div>
            <div className="rhine-boot-steps" aria-hidden="true">
              {['WORKSPACE', 'THOUGHTS', 'READY'].map((label, i) => (
                <span
                  key={label}
                  className={
                    i === 0 ||
                    (i === 1 && phase !== 'load') ||
                    phase === 'ready' ||
                    phase === 'exit'
                      ? 'is-complete'
                      : ''
                  }
                >
                  <b>{String(i + 1).padStart(2, '0')}</b>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="rhine-boot-footer mono" aria-hidden="true">
          <span>IDEAS BECOME DISCOVERIES.</span>
          <span>RHINE LAB / PRTS</span>
        </div>
        <button ref={skipRef} className="boot-skip mono" type="button" onClick={complete}>
          <span>跳过启动</span>
          <span aria-hidden="true">↗</span>
        </button>
      </div>
    )

  return (
    <div
      ref={rootRef}
      className="boot-sequence"
      data-phase={phase}
      data-replay={onReplay || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={onReplay ? '重播 PRTS 启动序列' : 'PRTS 启动序列'}
      onKeyDown={handleKeyDown}
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
