import { useEffect, useRef, useState } from 'react'
import { useServerStore } from './serverStore'

export function useFocusTimer(minutes: number, onComplete: () => void) {
  const store = useServerStore()
  const timer = store.documents.focus.value
  const [now, setNow] = useState(Date.now())
  const callback = useRef(onComplete)
  const previousMinutes = useRef(minutes)
  const completing = useRef(false)
  callback.current = onComplete

  useEffect(() => {
    if (previousMinutes.current === minutes) return
    previousMinutes.current = minutes
    if (!timer.endAt)
      void store.save('focus', { remaining: minutes * 60, endAt: null, sessionId: null })
  }, [minutes, timer.endAt, store.save])

  useEffect(() => {
    if (!timer.endAt || !timer.sessionId) return
    const sessionId = timer.sessionId
    const tick = async () => {
      const n = Date.now()
      setNow(n)
      if (n < timer.endAt! || completing.current) return
      completing.current = true
      try {
        if (await store.completeFocus(sessionId)) callback.current()
      } finally {
        completing.current = false
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 1000)
    return () => clearInterval(id)
  }, [timer.endAt, timer.sessionId, store.completeFocus])

  const remaining = timer.endAt
    ? Math.max(0, Math.ceil((timer.endAt - now) / 1000))
    : timer.remaining
  function toggle() {
    if (timer.endAt) {
      void store.save('focus', {
        ...timer,
        remaining: Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000)),
        endAt: null,
      })
    } else {
      const n = Date.now()
      setNow(n)
      const remaining = timer.remaining || minutes * 60
      void store.save('focus', {
        remaining,
        endAt: n + remaining * 1000,
        sessionId: timer.remaining > 0 && timer.sessionId ? timer.sessionId : crypto.randomUUID(),
      })
    }
  }
  function reset() {
    void store.save('focus', { remaining: minutes * 60, endAt: null, sessionId: null })
  }
  return {
    remaining,
    running: timer.endAt !== null,
    toggle,
    reset,
    progress: Math.min(1, remaining / (minutes * 60)),
  }
}
export type FocusTimer = ReturnType<typeof useFocusTimer>
