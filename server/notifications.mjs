import { createHash, randomUUID } from 'node:crypto'
import { createNotificationSettings } from './notification-settings.mjs'
import { sendWebhook, sendSmtp } from './notification-delivery.mjs'
import { taskDeadline, reminderOffsets, qqReminderPayload } from '../src/lib/reminders.ts'
import { HttpError } from './errors.mjs'

const hash = (...values) => createHash('sha256').update(JSON.stringify(values)).digest('hex')
const retryDelay = [60_000, 300_000]
export function createNotifications(
  database,
  storage,
  { now = Date.now, fetchImpl = fetch, sendMail = sendSmtp } = {},
) {
  const settings = createNotificationSettings(database)
  database.exec(`CREATE TABLE IF NOT EXISTS prts_reminder_events (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL,
    due_at INTEGER NOT NULL, scheduled_at INTEGER NOT NULL, offset_minutes INTEGER NOT NULL,
    read_at INTEGER
  ) STRICT;
  CREATE TABLE IF NOT EXISTS prts_reminder_deliveries (
    event_id TEXT NOT NULL, channel TEXT NOT NULL, target TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
    owner TEXT, sent_at INTEGER, last_error TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(event_id,channel,target)
  ) STRICT`)
  let stopped = false
  let busy = false
  let timer
  const controllers = new Set()
  function targets(config) {
    const result = []
    if (config.webhook.enabled && config.webhook.url)
      result.push({ channel: 'webhook', target: hash(config.webhook.url) })
    if (config.smtp.enabled)
      for (const to of config.smtp.to.split(',').filter(Boolean))
        result.push({
          channel: 'smtp',
          to,
          target: hash(
            config.smtp.host,
            config.smtp.port,
            config.smtp.security,
            config.smtp.user,
            config.smtp.from,
            to,
          ),
        })
    return result
  }
  function current() {
    const config = settings.configuration()
    const events = new Map()
    if (!config.enabled) return { config, events, targets: [] }
    const time = now()
    for (const task of storage.getDocument('workspace')?.value.tasks ?? []) {
      if (task.done) continue
      const dueAt = taskDeadline(task, config.timeZone)
      if (!dueAt || dueAt <= time) continue
      const checkpoints = reminderOffsets(config).map((offsetMinutes) => ({
        id: hash(task.id, dueAt, offsetMinutes),
        taskId: task.id,
        title: task.title,
        dueAt,
        scheduledAt: dueAt - offsetMinutes * 60_000,
        offsetMinutes,
      }))
      const latest = checkpoints.filter((event) => event.scheduledAt <= time).at(-1)
      // Supersede persisted older checkpoints too, including pending retries.
      for (const event of checkpoints)
        if (event.scheduledAt > time || event.id === latest?.id) events.set(event.id, event)
    }
    return { config, events, targets: targets(config) }
  }
  function reconcile() {
    const state = current()
    const insert = database.prepare(
      'INSERT INTO prts_reminder_events (id,task_id,title,due_at,scheduled_at,offset_minutes) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title',
    )
    const deliver = database.prepare(
      'INSERT OR IGNORE INTO prts_reminder_deliveries (event_id,channel,target,next_at) VALUES (?,?,?,?)',
    )
    const valid = new Set()
    storage.atomic(() => {
      for (const event of state.events.values()) {
        insert.run(
          event.id,
          event.taskId,
          event.title,
          event.dueAt,
          event.scheduledAt,
          event.offsetMinutes,
        )
        for (const target of state.targets) {
          valid.add(`${event.id}:${target.channel}:${target.target}`)
          deliver.run(event.id, target.channel, target.target, event.scheduledAt)
          // Re-enabling the same setting resumes cancelled pending work, never sent work.
          database
            .prepare(
              "UPDATE prts_reminder_deliveries SET status='pending' WHERE event_id=? AND channel=? AND target=? AND status='cancelled' AND attempts<3",
            )
            .run(event.id, target.channel, target.target)
        }
      }
      for (const row of database
        .prepare(
          "SELECT event_id,channel,target FROM prts_reminder_deliveries WHERE status IN ('pending','sending')",
        )
        .all())
        if (!valid.has(`${row.event_id}:${row.channel}:${row.target}`))
          database
            .prepare(
              "UPDATE prts_reminder_deliveries SET status='cancelled',owner=NULL WHERE event_id=? AND channel=? AND target=? AND (status='pending' OR lease_until<=?)",
            )
            .run(row.event_id, row.channel, row.target, now())
      database
        .prepare(
          "UPDATE prts_reminder_deliveries SET status='failed',owner=NULL,last_error='最终发送尝试中断，请手动重试。' WHERE attempts>=3 AND (status='pending' OR (status='sending' AND lease_until<=?))",
        )
        .run(now())
      database
        .prepare(
          'DELETE FROM prts_reminder_deliveries WHERE event_id IN (SELECT id FROM prts_reminder_events WHERE due_at<?)',
        )
        .run(now() - 30 * 86400_000)
      database
        .prepare('DELETE FROM prts_reminder_events WHERE due_at<?')
        .run(now() - 30 * 86400_000)
    })
    return state
  }
  function inbox() {
    const state = reconcile()
    if (!state.config.browserEnabled) return []
    const unread = new Set(
      database
        .prepare('SELECT id FROM prts_reminder_events WHERE read_at IS NULL AND scheduled_at<=?')
        .all(now())
        .map((row) => row.id),
    )
    return [...state.events.values()]
      .filter((event) => event.scheduledAt <= now() && unread.has(event.id))
      .sort((a, b) => a.dueAt - b.dueAt)
      .slice(0, 50)
  }
  function acknowledge(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
      throw new HttpError(400, '提醒 ID 无效。')
    const result = database
      .prepare('UPDATE prts_reminder_events SET read_at=COALESCE(read_at,?) WHERE id=?')
      .run(now(), id)
    if (!result.changes) throw new HttpError(404, '此提醒不存在。')
    return { read: true }
  }
  async function dispatch(channel, target, config, event) {
    const controller = new AbortController()
    controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), 30_000)
    timeout.unref?.()
    try {
      if (channel === 'webhook')
        return await sendWebhook(config, event, {
          fetchImpl,
          now: now(),
          signal: controller.signal,
        })
      const payload = qqReminderPayload(event, { now: now(), timeZone: config.timeZone })
      const result = await sendMail(
        config.smtp,
        {
          from: config.smtp.from,
          to: target.to,
          subject: `PRTS · ${payload.title}`,
          text: `${payload.message}\n\n${Object.entries(payload.fields)
            .map(([key, value]) => `${key}：${value}`)
            .join('\n')}`,
          messageId: `<prts-${event.id}-${target.target.slice(0, 16)}@prts.local>`,
          date: new Date(now()),
        },
        controller.signal,
      )
      if (!result?.accepted?.length) throw new Error('SMTP 未接受收件人。')
    } finally {
      clearTimeout(timeout)
      controllers.delete(controller)
    }
  }
  async function tick() {
    if (busy || stopped) return
    busy = true
    try {
      reconcile()
      const rows = database
        .prepare(
          "SELECT * FROM prts_reminder_deliveries WHERE (status='pending' OR (status='sending' AND lease_until<=?)) AND next_at<=? AND attempts<3 ORDER BY next_at LIMIT 12",
        )
        .all(now(), now())
      for (const row of rows) {
        if (stopped) break
        const state = current()
        const event = state.events.get(row.event_id)
        const target = state.targets.find(
          (target) => target.channel === row.channel && target.target === row.target,
        )
        if (!event || event.scheduledAt > now() || !target) continue
        const owner = randomUUID()
        const claimed = database
          .prepare(
            "UPDATE prts_reminder_deliveries SET status='sending',attempts=attempts+1,lease_until=?,owner=? WHERE event_id=? AND channel=? AND target=? AND (status='pending' OR (status='sending' AND lease_until<=?)) AND attempts<3 AND next_at<=? RETURNING attempts",
          )
          .get(now() + 120_000, owner, row.event_id, row.channel, row.target, now(), now())
        if (!claimed) continue
        try {
          await dispatch(row.channel, target, state.config, event)
          if (!stopped)
            database
              .prepare(
                "UPDATE prts_reminder_deliveries SET status='sent',sent_at=?,last_error='',owner=NULL WHERE event_id=? AND channel=? AND target=? AND owner=?",
              )
              .run(now(), row.event_id, row.channel, row.target, owner)
        } catch {
          if (stopped) break
          const valid = current()
          const stillValid =
            valid.events.has(row.event_id) &&
            valid.targets.some(
              (target) => target.target === row.target && target.channel === row.channel,
            )
          const attempts = claimed.attempts
          database
            .prepare(
              'UPDATE prts_reminder_deliveries SET status=?,next_at=?,last_error=?,owner=NULL WHERE event_id=? AND channel=? AND target=? AND owner=?',
            )
            .run(
              !stillValid ? 'cancelled' : attempts >= 3 ? 'failed' : 'pending',
              now() + (retryDelay[attempts - 1] ?? 0),
              row.channel === 'smtp'
                ? 'SMTP 发送失败，请检查连接与账号配置。'
                : 'Webhook 发送失败，请检查地址与接收端状态。',
              row.event_id,
              row.channel,
              row.target,
              owner,
            )
        }
      }
    } finally {
      busy = false
    }
  }
  function deliveries() {
    return database
      .prepare(
        'SELECT d.event_id AS eventId,d.target,d.channel,d.status,d.attempts,d.sent_at AS sentAt,d.last_error AS error,e.title,e.due_at AS dueAt,e.scheduled_at AS scheduledAt FROM prts_reminder_deliveries d JOIN prts_reminder_events e ON e.id=d.event_id WHERE d.attempts>0 ORDER BY e.scheduled_at DESC LIMIT 30',
      )
      .all()
  }
  function retry(payload) {
    const { eventId, channel, target } = payload ?? {}
    if (
      typeof eventId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(eventId) ||
      typeof target !== 'string' ||
      !/^[a-f0-9]{64}$/.test(target) ||
      !['webhook', 'smtp'].includes(channel)
    )
      throw new HttpError(400, '发送记录无效。')
    const state = current()
    const event = state.events.get(eventId)
    if (
      !event ||
      event.scheduledAt > now() ||
      !state.targets.some((value) => value.channel === channel && value.target === target)
    )
      throw new HttpError(409, '提醒已失效或渠道已变更，无法重试。')
    const result = database
      .prepare(
        "UPDATE prts_reminder_deliveries SET status='pending',attempts=0,next_at=?,last_error='' WHERE event_id=? AND channel=? AND target=? AND status='failed'",
      )
      .run(now(), eventId, channel, target)
    if (!result.changes) throw new HttpError(409, '只有当前失败的发送记录可以重试。')
    return { queued: true }
  }
  async function test(channel) {
    if (!['webhook', 'smtp'].includes(channel)) throw new HttpError(400, '通知渠道无效。')
    const config = settings.configuration()
    const list = targets(config).filter((target) => target.channel === channel)
    if (!list.length) throw new HttpError(400, '请先启用并保存此渠道的配置。')
    const event = {
      id: randomUUID(),
      title: 'PRTS 通知测试',
      dueAt: now() + 600_000,
      offsetMinutes: 10,
    }
    try {
      await dispatch(channel, list[0], config, event)
    } catch {
      throw new HttpError(
        502,
        channel === 'smtp'
          ? 'SMTP 测试发送失败，请检查邮箱配置。'
          : 'Webhook 测试发送失败，接收端必须返回 status: forwarded。',
      )
    }
    return { sent: true }
  }
  function start() {
    stopped = false
    void tick().catch(() => {})
    timer = setInterval(() => void tick().catch(() => {}), 15_000)
    timer.unref?.()
  }
  function stop() {
    stopped = true
    clearInterval(timer)
    for (const controller of controllers) controller.abort()
  }
  return { settings, reconcile, inbox, acknowledge, tick, start, stop, test, deliveries, retry }
}
