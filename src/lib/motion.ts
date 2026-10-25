import { flushSync } from 'react-dom'

type MotionScope = 'page' | 'settings' | 'collection'
type Transition = {
  ready: Promise<void>
  finished: Promise<void>
  skipTransition: () => void
}
type MotionOptions = { scope: MotionScope; direction?: number; instant?: boolean }

const selectors: Record<MotionScope, string> = {
  page: '.motion-page',
  settings: '.settings-category-content',
  collection: '.motion-collection',
}
let revision = 0
let active: { scope: MotionScope; finish: () => void } | undefined
let keyboardInput = false

function preferLiveMotion() {
  // Safari/iOS WebKit can lose scrolled/clipped snapshot layers. Keep its DOM painted.
  const agent = navigator.userAgent
  return /AppleWebKit\//.test(agent) && !/(?:Chrome|Chromium|Edg|OPR)\//.test(agent)
}

export function motionAllowed() {
  return (
    document.documentElement.dataset.motion !== 'off' &&
    !document.hidden &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Also invalidate a capture callback that has not run yet (for example on lock). */
export function stopInterfaceMotion(scope?: MotionScope) {
  if (scope && active?.scope !== scope) return
  ++revision
  active?.finish()
  active = undefined
  delete document.documentElement.dataset.transition
  delete document.documentElement.dataset.motionDirection
  delete document.documentElement.dataset.motionEngine
}

/** One live React tree; the browser owns only temporary, non-interactive snapshots. */
export function transitionView(update: () => void, options: MotionOptions) {
  // A click on the old page must not discard navigation while its capture is pending.
  if (options.scope === 'collection' && active?.scope === 'page') {
    active.finish()
    return
  }
  stopInterfaceMotion()
  const version = revision
  let timeout: ReturnType<typeof setTimeout> | undefined
  let committed = false
  const commit = () => {
    if (committed || version !== revision) return
    committed = true
    flushSync(update)
  }
  const root = document.documentElement
  const selector = selectors[options.scope]
  if (options.instant || keyboardInput || !motionAllowed() || !document.querySelector(selector)) {
    commit()
    return
  }

  const direction = (options.direction ?? 1) < 0 ? -1 : 1
  root.dataset.transition = options.scope
  root.dataset.motionDirection = direction < 0 ? 'backward' : 'forward'
  const cleanup = () => {
    clearTimeout(timeout)
    if (version !== revision) return
    delete root.dataset.transition
    delete root.dataset.motionDirection
    delete root.dataset.motionEngine
    active = undefined
  }
  const fallback = () => {
    root.dataset.motionEngine = 'live'
    commit()
    const element = document.querySelector<HTMLElement>(selector)
    if (!element?.animate || !motionAllowed()) {
      cleanup()
      return
    }
    const rhine = root.dataset.theme === 'rhine'
    const animation = element.animate(
      [
        {
          opacity: 0.35,
          transform: `translateY(${direction * (rhine ? 10 : 6)}px)`,
        },
        { opacity: 1, transform: 'none' },
      ],
      { duration: options.scope === 'page' ? 280 : 200, easing: 'cubic-bezier(.22,1,.36,1)' },
    )
    active = {
      scope: options.scope,
      finish: () => {
        animation.cancel()
        cleanup()
      },
    }
    void animation.finished.then(cleanup, cleanup)
  }

  const start = (
    document as Document & {
      startViewTransition?: (callback: () => void) => Transition
    }
  ).startViewTransition
  if (!start || preferLiveMotion()) {
    fallback()
    return
  }
  try {
    root.dataset.motionEngine = 'native'
    const transition = start.call(document, commit)
    const finish = () => {
      commit()
      transition.skipTransition()
      cleanup()
    }
    active = {
      scope: options.scope,
      finish,
    }
    // A browser capture must never become a navigation dependency until the next reload.
    timeout = setTimeout(() => {
      if (version === revision) finish()
    }, 1000)
    // A cancelled capture rejects ready, while its update may still be scheduled.
    void transition.ready.catch(() => {
      if (version === revision) finish()
    })
    void transition.finished.then(cleanup, cleanup)
  } catch {
    fallback()
  }
}

/** Keyboard workflows and changes to motion preferences interrupt immediately. */
export function observeInterfaceMotion() {
  const root = document.documentElement
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  const pointer = () => {
    keyboardInput = false
    root.dataset.input = 'pointer'
  }
  const keyboard = () => {
    keyboardInput = true
    root.dataset.input = 'keyboard'
    // Do not discard a pending navigation merely because focus moved by keyboard.
    active?.finish()
  }
  const preferences = () => {
    if (!motionAllowed()) active?.finish()
  }
  document.addEventListener('pointerdown', pointer, true)
  document.addEventListener('keydown', keyboard, true)
  document.addEventListener('visibilitychange', preferences)
  media.addEventListener('change', preferences)
  const observer = new MutationObserver(preferences)
  observer.observe(root, { attributes: true, attributeFilter: ['data-motion'] })
  return () => {
    stopInterfaceMotion()
    document.removeEventListener('pointerdown', pointer, true)
    document.removeEventListener('keydown', keyboard, true)
    document.removeEventListener('visibilitychange', preferences)
    media.removeEventListener('change', preferences)
    observer.disconnect()
    keyboardInput = false
    delete root.dataset.input
  }
}
