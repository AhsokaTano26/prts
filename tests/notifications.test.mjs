import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatabase } from '../server/database.mjs'
import { createStorage } from '../server/storage.mjs'
import { createNotifications } from '../server/notifications.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'

const day = 86400_000
const minute = 60_000
function fixture(t, options = {}) {
  const db = createDatabase()
  const store = createStorage(db)
  t.after(() => {
    store.close()
    db.close()
  })
  let now = Date.parse('2026-10-24T10:00:00Z')
  const workspace = createInitialWorkspace()
  workspace.tasks = [
    {
      id: 'reminder-task',
      title: '准备汇报',
      categoryId: '',
      priority: 'high',
      done: false,
      dueDate: '2026-10-25',
      dueAt: new Date(now + day).toISOString(),
      createdAt: new Date(now - day * 10).toISOString(),
    },
  ]
  store.putDocument('workspace', {
    value: workspace,
    expectedRevision: 0,
    mutationId: crypto.randomUUID(),
  })
  const sent = []
  const create = () =>
    createNotifications(db, store, {
      now: () => now,
      fetchImpl: async (url, init) => {
        sent.push({ channel: 'webhook', url, init })
        return new Response(JSON.stringify({ status: 'forwarded' }), { status: 200 })
      },
      sendMail: async (config, message) => {
        sent.push({ channel: 'smtp', config, message })
        return { accepted: [message.to] }
      },
      ...options,
    })
  const notifications = create()
  const settings = notifications.settings
  settings.update({
    ...settings.read(),
    enabled: true,
    leadDays: [3, 1],
    leadMinutes: 10,
    webhook: { enabled: true, url: 'https://qq.example/webhook/general' },
    smtp: {
      enabled: true,
      host: 'smtp.example.com',
      port: 465,
      security: 'tls',
      user: 'doctor',
      password: 'private-test-password',
      from: 'prts@example.com',
      to: 'one@example.com,two@example.com',
    },
  })
  return {
    db,
    store,
    notifications,
    create,
    sent,
    get now() {
      return now
    },
    set now(value) {
      now = value
    },
    task: (change) => {
      const document = store.getDocument('workspace')
      document.value.tasks[0] = { ...document.value.tasks[0], ...change }
      store.putDocument('workspace', {
        value: document.value,
        expectedRevision: document.revision,
        mutationId: crypto.randomUUID(),
      })
    },
  }
}

test('latest checkpoint sends once per channel and recipient, persists across restart and acknowledges browser inbox', async (t) => {
  const f = fixture(t)
  await f.notifications.tick()
  assert.equal(f.sent.length, 3)
  assert.deepEqual(
    f.sent
      .filter((m) => m.channel === 'smtp')
      .map((m) => m.message.to)
      .sort(),
    ['one@example.com', 'two@example.com'],
  )
  const webhook = f.sent.find((m) => m.channel === 'webhook')
  const payload = JSON.parse(webhook.init.body)
  assert.equal(payload.fields['提前'], '1 天')
  assert.ok(webhook.init.headers['X-PRTS-Event-ID'])
  assert.ok(!Object.hasOwn(payload, 'eventId'))
  const inbox = f.notifications.inbox()
  assert.equal(inbox.length, 1)
  assert.equal(inbox[0].title, '准备汇报')
  f.notifications.acknowledge(inbox[0].id)
  assert.equal(f.notifications.inbox().length, 0)
  const restarted = f.create()
  await restarted.tick()
  assert.equal(f.sent.length, 3)
  f.now += day - 10 * minute
  await restarted.tick()
  assert.equal(f.sent.length, 6)
  assert.equal(restarted.inbox().length, 1)
})

test('downtime supersedes older persisted checkpoints and retries; completed and rescheduled tasks cancel pending delivery', async (t) => {
  let failures = true
  const sent = []
  const f = fixture(t, {
    fetchImpl: async () => {
      sent.push('webhook')
      return new Response(
        JSON.stringify(failures ? { detail: 'private-secret-error' } : { status: 'forwarded' }),
        { status: failures ? 503 : 200 },
      )
    },
  })
  await f.notifications.tick()
  assert.equal(sent.length, 1)
  f.now += day - 10 * minute
  failures = false
  await f.notifications.tick()
  assert.equal(sent.length, 2)
  assert.ok(
    f.notifications.deliveries().every((row) => !JSON.stringify(row).includes('private-secret')),
  )
  f.task({ done: true })
  assert.equal(f.notifications.inbox().length, 0)
  f.now += minute
  await f.notifications.tick()
  assert.equal(sent.length, 2)
  f.task({ done: false, dueAt: new Date(f.now + day * 10).toISOString() })
  await f.notifications.tick()
  assert.equal(sent.length, 2)
})

test('webhook failures back off and stop after three attempts; disabled channels and removed offsets cancel retries', async (t) => {
  let calls = 0
  const f = fixture(t, {
    fetchImpl: async () => {
      calls++
      return new Response('{"detail":"do not echo this"}', { status: 503 })
    },
  })
  await f.notifications.tick()
  await f.notifications.tick()
  assert.equal(calls, 1)
  f.now += minute
  await f.notifications.tick()
  assert.equal(calls, 2)
  const current = f.notifications.settings.read()
  f.notifications.settings.update({ ...current, leadDays: [], leadMinutes: 10 })
  f.now += 5 * minute
  await f.notifications.tick()
  assert.equal(calls, 2)
  const other = fixture(t, {
    fetchImpl: async () => {
      calls++
      return new Response('{}', { status: 503 })
    },
  })
  await other.notifications.tick()
  other.now += minute
  await other.notifications.tick()
  other.now += 5 * minute
  await other.notifications.tick()
  other.now += 30 * minute
  await other.notifications.tick()
  assert.equal(calls, 5)
})

test('two workers cannot claim the same message and rotating SMTP credentials does not resend accepted mail', async (t) => {
  const f = fixture(t)
  await Promise.all([f.notifications.tick(), f.create().tick()])
  assert.equal(f.sent.length, 3)
  const current = f.notifications.settings.read()
  f.notifications.settings.update({
    ...current,
    smtp: { ...current.smtp, password: 'rotated-test-password' },
  })
  await f.notifications.tick()
  assert.equal(f.sent.length, 3)
})

test('disabling an in-flight channel records remote acceptance without retrying it after re-enable', async (t) => {
  let finish
  const accepted = new Promise((resolve) => {
    finish = resolve
  })
  let calls = 0
  const f = fixture(t, {
    fetchImpl: async () => {
      calls++
      await accepted
      return new Response('{"status":"forwarded"}')
    },
  })
  const ticking = f.notifications.tick()
  assert.equal(calls, 1)
  let config = f.notifications.settings.read()
  f.notifications.settings.update({ ...config, enabled: false })
  f.notifications.inbox()
  finish()
  await ticking
  config = f.notifications.settings.read()
  f.notifications.settings.update({ ...config, enabled: true })
  await f.notifications.tick()
  assert.equal(calls, 1)
})

test('only currently valid failed deliveries can be retried manually, and accepted deliveries cannot be resent', async (t) => {
  let succeeds = false
  let calls = 0
  const f = fixture(t, {
    fetchImpl: async () => {
      calls++
      return new Response(succeeds ? '{"status":"forwarded"}' : '{}', {
        status: succeeds ? 200 : 503,
      })
    },
  })
  await f.notifications.tick()
  f.now += 60_000
  await f.notifications.tick()
  f.now += 300_000
  await f.notifications.tick()
  const failed = f.notifications.deliveries().find((row) => row.status === 'failed')
  assert.ok(failed)
  succeeds = true
  f.notifications.retry(failed)
  await f.notifications.tick()
  assert.equal(calls, 4)
  assert.throws(() => f.notifications.retry(failed), { status: 409 })
})

test('an interrupted third claim becomes failed after its lease expires and can be retried', async (t) => {
  const f = fixture(t)
  f.notifications.reconcile()
  f.db
    .prepare(
      "UPDATE prts_reminder_deliveries SET status='sending',attempts=3,lease_until=? WHERE channel='webhook' AND next_at<=?",
    )
    .run(f.now - 1, f.now)
  await f.create().tick()
  const row = f.notifications.deliveries().find((row) => row.channel === 'webhook')
  assert.equal(row.status, 'failed')
  assert.doesNotThrow(() => f.notifications.retry(row))
})

test('the actual claimed attempt count wins over a stale batch snapshot across two workers', async (t) => {
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const f = fixture(t, {
    fetchImpl: async () => {
      await blocked
      return new Response('{"status":"forwarded"}')
    },
    sendMail: async () => {
      throw new Error('SMTP fixture refuses delivery')
    },
  })
  const first = f.notifications.tick()
  const second = f.create()
  await second.tick()
  f.now += 60_000
  await second.tick()
  f.now += 300_000
  release()
  await first
  const mail = f.notifications.deliveries().filter((row) => row.channel === 'smtp')
  assert.equal(mail.length, 2)
  assert.ok(mail.every((row) => row.status === 'failed' && row.attempts === 3))
  for (const row of mail) assert.doesNotThrow(() => f.notifications.retry(row))
})
