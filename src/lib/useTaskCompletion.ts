import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Task } from './workspace'
import { motionAllowed } from './motion'

/** Save immediately; retain only the completion feedback for one second. */
export function useTaskCompletion(
  tasks: Task[],
  onToggle: (id: string) => void,
  onBeforeFinish?: (ids: string[]) => void,
) {
  const [completingIds, setCompletingIds] = useState<ReadonlySet<string>>(() => new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const beforeFinish = useRef(onBeforeFinish)
  useLayoutEffect(() => {
    beforeFinish.current = onBeforeFinish
  }, [onBeforeFinish])

  const finish = useCallback((ids: string[]) => {
    if (!ids.length) return
    beforeFinish.current?.(ids)
    for (const id of ids) {
      clearTimeout(timers.current.get(id))
      timers.current.delete(id)
    }
    setCompletingIds(new Set(timers.current.keys()))
  }, [])

  useEffect(() => {
    const activeTimers = timers.current
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const stop = () => {
      if (!motionAllowed()) finish([...activeTimers.keys()])
    }
    const observer = new MutationObserver(stop)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    })
    document.addEventListener('visibilitychange', stop)
    media.addEventListener('change', stop)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', stop)
      media.removeEventListener('change', stop)
      for (const timer of activeTimers.values()) clearTimeout(timer)
      activeTimers.clear()
    }
  }, [finish])

  function toggleWithFeedback(id: string) {
    if (timers.current.has(id)) return
    const task = tasks.find((task) => task.id === id)
    if (!task) return
    if (!task.done) {
      if (motionAllowed()) {
        timers.current.set(
          id,
          setTimeout(() => finish([id]), 1000),
        )
        setCompletingIds(new Set(timers.current.keys()))
      } else beforeFinish.current?.([id])
    }
    onToggle(id)
  }

  return { completingIds, toggleWithFeedback }
}
