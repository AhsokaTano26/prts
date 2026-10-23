import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { advanceSessionEpoch, apiFetch, SESSION_EXPIRED_EVENT } from '../src/lib/api.ts'

function observeExpiry(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const window = new EventTarget()
  const events: Event[] = []
  window.addEventListener(SESSION_EXPIRED_EVENT, (event) => events.push(event))
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  return events
}

test('a current-session 401 dispatches one session-expired event', async (t) => {
  const events = observeExpiry(t)
  const response = new Response('{"error":"请先登录"}', { status: 401 })
  const transport = t.mock.method(globalThis, 'fetch', async () => response)

  assert.equal(await apiFetch('/api/health'), response)
  assert.equal(events.length, 1)
  assert.equal(transport.mock.calls[0].arguments[1]?.credentials, 'same-origin')
})

test('a previous-session request returning 401 cannot expire the new session', async (t) => {
  const events = observeExpiry(t)
  let finishRequest!: (response: Response) => void
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        finishRequest = resolve
      }),
  )

  const pending = apiFetch('/api/chat')
  advanceSessionEpoch()
  const response = new Response('{"error":"旧会话已失效"}', { status: 401 })
  finishRequest(response)

  assert.equal(await pending, response)
  assert.equal(events.length, 0)
})

test('a successful response preserves its body without expiring the session', async (t) => {
  const events = observeExpiry(t)
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('{"configured":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )

  const response = await apiFetch('/api/health')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { configured: true })
  assert.equal(events.length, 0)
})
