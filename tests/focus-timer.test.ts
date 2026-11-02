import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  configureFocus,
  focusElapsed,
  focusRunning,
  focusSeconds,
  formatFocusTime,
  resetFocus,
  toggleFocus,
  type FocusState,
} from '../src/lib/focusTimer.ts'

test('legacy countdown preserves remaining seconds through pause and restart', () => {
  const legacy: FocusState = { remaining: 1500, endAt: null, sessionId: null }
  const running = toggleFocus(legacy, 1500, 100000, 'countdown')
  assert.equal(focusRunning(running), true)
  assert.equal(focusSeconds(running, 101500), 1499)
  const paused = toggleFocus(running, 1500, 101500, 'unused')
  assert.equal(focusRunning(paused), false)
  assert.equal(paused.remaining, 1499)
  const resumed = toggleFocus(paused, 1500, 200000, 'unused')
  assert.equal(resumed.sessionId, 'countdown')
  assert.equal(focusSeconds(resumed, 201000), 1498)
})

test('countup accumulates fractional pauses and survives reconstruction from stored state', () => {
  const empty = resetFocus({ remaining: 1500, endAt: null, sessionId: null }, 1500, 'countup')
  assert.equal(focusSeconds(empty, 100000), 0)
  let timer = toggleFocus(empty, 1500, 100000, 'up')
  timer = toggleFocus(timer, 1500, 101250, 'unused')
  assert.equal(focusElapsed(timer, 105000), 1.25)
  timer = toggleFocus(JSON.parse(JSON.stringify(timer)), 1500, 200000, 'unused')
  assert.equal(focusSeconds(timer, 201750), 3)
  assert.equal(timer.sessionId, 'up')
  assert.equal(focusRunning(timer), true)
  assert.equal(toggleFocus(timer, 1500, 201750, 'unused').elapsed, 3)
})

test('inline duration persists across reset and completed stopwatch restarts as a fresh round', () => {
  const timer = configureFocus({ remaining: 1500, endAt: null, sessionId: null }, 7)
  assert.equal(timer.duration, 420)
  assert.equal(timer.remaining, 420)
  assert.equal(resetFocus(timer, 1500).remaining, 420)
  for (const duration of [0, 181, NaN, 1.5])
    assert.throws(() => configureFocus(timer, duration), RangeError)
  const finished: FocusState = {
    ...resetFocus(timer, 1500, 'countup'),
    sessionId: 'old',
    elapsed: 12,
    completed: true,
  }
  const next = toggleFocus(finished, 1500, 100000, 'new')
  assert.equal(next.sessionId, 'new')
  assert.equal(focusSeconds(next, 101000), 1)
  assert.equal(next.completed, false)
  assert.equal(formatFocusTime(1500), '25:00')
  assert.equal(formatFocusTime(3661), '01:01:01')
})
