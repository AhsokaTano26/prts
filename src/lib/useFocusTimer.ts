import { useEffect, useRef, useState } from 'react'
const KEY = 'prts-focus-v1'
export function useFocusTimer(minutes: number, onComplete: () => void) {
  const [timer, setTimer] = useState<{ remaining: number; endAt: number | null }>(() => {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (
        data &&
        Number.isFinite(data.remaining) &&
        data.remaining >= 0 &&
        data.remaining <= 10800 &&
        (data.endAt === null || Number.isFinite(data.endAt))
      )
        return data
    } catch {
      /* fresh timer */
    }
    return { remaining: minutes * 60, endAt: null }
  })
  const [now, setNow] = useState(Date.now())
  const completed = useRef(false),
    callback = useRef(onComplete),
    previousMinutes = useRef(minutes)
  callback.current = onComplete
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(timer))
    } catch {
      /* workspace reports local storage failure */
    }
  }, [timer])
  useEffect(() => {
    if (previousMinutes.current !== minutes) {
      previousMinutes.current = minutes
      if (!timer.endAt) setTimer({ remaining: minutes * 60, endAt: null })
    }
  }, [minutes, timer.endAt])
  useEffect(() => {
    if (!timer.endAt) return
    const tick = () => {
      const n = Date.now()
      setNow(n)
      if (n >= timer.endAt! && !completed.current) {
        completed.current = true
        setTimer({ remaining: 0, endAt: null })
        callback.current()
      }
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [timer.endAt])
  const remaining = timer.endAt
    ? Math.max(0, Math.ceil((timer.endAt - now) / 1000))
    : timer.remaining
  function toggle() {
    if (timer.endAt) {
      setTimer({
        remaining: Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000)),
        endAt: null,
      })
    } else {
      completed.current = false
      const n = Date.now()
      setNow(n)
      setTimer({
        remaining: timer.remaining || minutes * 60,
        endAt: n + (timer.remaining || minutes * 60) * 1000,
      })
    }
  }
  function reset() {
    completed.current = false
    setTimer({ remaining: minutes * 60, endAt: null })
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
