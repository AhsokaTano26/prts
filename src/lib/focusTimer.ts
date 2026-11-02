export type FocusMode = 'countdown' | 'countup'
export type FocusState = {
  remaining: number
  endAt: number | null
  sessionId: string | null
  mode?: FocusMode
  duration?: number
  elapsed?: number
  startedAt?: number | null
  completed?: boolean
}

export const focusMode = (timer: FocusState): FocusMode => timer.mode || 'countdown'
export const focusDuration = (timer: FocusState, fallback: number) => timer.duration ?? fallback
export const focusRunning = (timer: FocusState) =>
  focusMode(timer) === 'countup' ? timer.startedAt != null : timer.endAt !== null
export const focusElapsed = (timer: FocusState, now: number) =>
  (timer.elapsed || 0) + (timer.startedAt == null ? 0 : Math.max(0, now - timer.startedAt) / 1000)
export function focusSeconds(timer: FocusState, now: number): number {
  return focusMode(timer) === 'countup'
    ? Math.floor(focusElapsed(timer, now))
    : timer.endAt === null
      ? timer.remaining
      : Math.max(0, Math.ceil((timer.endAt - now) / 1000))
}
export function resetFocus(
  timer: FocusState,
  fallback: number,
  mode = focusMode(timer),
): FocusState {
  const duration = focusDuration(timer, fallback)
  return {
    remaining: mode === 'countup' ? 0 : duration,
    endAt: null,
    sessionId: null,
    mode,
    duration,
    elapsed: 0,
    startedAt: null,
    completed: false,
  }
}
export function configureFocus(timer: FocusState, minutes: number): FocusState {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180)
    throw new RangeError('专注时长须为 1–180 分钟的整数。')
  return resetFocus({ ...timer, duration: minutes * 60 }, minutes * 60, 'countdown')
}
export function toggleFocus(
  timer: FocusState,
  fallback: number,
  now: number,
  newSessionId: string,
): FocusState {
  if (focusMode(timer) === 'countup') {
    if (focusRunning(timer)) return { ...timer, elapsed: focusElapsed(timer, now), startedAt: null }
    const next = timer.completed ? resetFocus(timer, fallback) : timer
    return {
      ...next,
      mode: 'countup',
      endAt: null,
      remaining: 0,
      elapsed: next.elapsed || 0,
      startedAt: now,
      completed: false,
      sessionId: next.sessionId || newSessionId,
    }
  }
  if (focusRunning(timer)) return { ...timer, remaining: focusSeconds(timer, now), endAt: null }
  const remaining = timer.remaining || focusDuration(timer, fallback)
  return {
    ...timer,
    remaining,
    endAt: now + remaining * 1000,
    sessionId: timer.remaining > 0 && timer.sessionId ? timer.sessionId : newSessionId,
  }
}
export function formatFocusTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const parts = [Math.floor(whole / 60) % 60, whole % 60]
  if (whole >= 3600) parts.unshift(Math.floor(whole / 3600))
  return parts.map((part) => String(part).padStart(2, '0')).join(':')
}
