import { useEffect, useRef, useState } from 'react'
import { useServerStore } from './serverStore'
import {
  configureFocus,
  focusDuration,
  focusMode,
  focusRunning,
  focusSeconds,
  formatFocusTime,
  resetFocus,
  toggleFocus,
  type FocusMode,
} from './focusTimer'

export function useFocusTimer(minutes: number, onComplete: () => void) {
  const store = useServerStore()
  const timer = store.documents.focus.value
  const [now, setNow] = useState(Date.now())
  const [finishing, setFinishing] = useState(false)
  const callback = useRef(onComplete)
  const previousMinutes = useRef(minutes)
  const completing = useRef(false)
  callback.current = onComplete
  const mode = focusMode(timer)
  const running = focusRunning(timer)
  const duration = focusDuration(timer, minutes * 60)

  useEffect(() => {
    if (previousMinutes.current === minutes) return
    previousMinutes.current = minutes
    if (!focusRunning(timer) && focusMode(timer) === 'countdown')
      void store.save('focus', configureFocus(timer, minutes))
  }, [minutes, timer, store.save])

  async function finish() {
    if (!timer.sessionId || completing.current) return
    completing.current = true
    setFinishing(true)
    try {
      if (mode === 'countup' && running) {
        const stoppedAt = Date.now()
        setNow(stoppedAt)
        const paused = toggleFocus(timer, minutes * 60, stoppedAt, crypto.randomUUID())
        if (!(await store.save('focus', paused))) return
      }
      if (await store.completeFocus(timer.sessionId)) callback.current()
    } finally {
      completing.current = false
      setFinishing(false)
    }
  }
  const finishRef = useRef(finish)
  finishRef.current = finish
  useEffect(() => {
    if (!running) return
    const tick = () => {
      const time = Date.now()
      setNow(time)
      if (mode === 'countdown' && timer.endAt !== null && time >= timer.endAt)
        void finishRef.current()
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [running, mode, timer.endAt, timer.startedAt, timer.sessionId])

  const seconds = focusSeconds(timer, now)
  function toggle() {
    if (completing.current) return
    const time = Date.now()
    setNow(time)
    if (mode === 'countdown' && running && timer.endAt! <= time) void finish()
    else void store.save('focus', toggleFocus(timer, minutes * 60, time, crypto.randomUUID()))
  }
  function reset() {
    if (!completing.current) void store.save('focus', resetFocus(timer, minutes * 60))
  }
  function setMode(next: FocusMode) {
    if (!running && !completing.current && next !== mode)
      void store.save('focus', resetFocus(timer, minutes * 60, next))
  }
  function setMinutes(next: number) {
    if (!running && !completing.current) void store.save('focus', configureFocus(timer, next))
  }
  return {
    mode,
    minutes: duration / 60,
    seconds,
    remaining: seconds,
    running,
    toggle,
    reset,
    setMode,
    setMinutes,
    finish,
    display: formatFocusTime(seconds),
    busy: finishing || store.saving,
    completed: mode === 'countup' ? timer.completed === true : seconds === 0,
    hasSession: Boolean(timer.sessionId) && timer.completed !== true,
    progress: mode === 'countup' ? 0 : Math.min(1, seconds / duration),
  }
}
export type FocusTimer = ReturnType<typeof useFocusTimer>
