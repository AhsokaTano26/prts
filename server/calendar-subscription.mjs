import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { HttpError } from './errors.mjs'
import { buildCalendarFeed } from './calendar-feed.mjs'

/** This read-only credential intentionally stays outside exportable workspace data. */
export function createCalendarSubscription(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS prts_calendar_subscription (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    token TEXT,
    namespace TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0)
  ) STRICT`)
  database
    .prepare('INSERT OR IGNORE INTO prts_calendar_subscription VALUES (1, 0, NULL, ?, 1)')
    .run(randomUUID())
  const select = database.prepare('SELECT * FROM prts_calendar_subscription WHERE id = 1')
  const document = database.prepare(
    "SELECT data,revision,updated_at FROM prts_documents WHERE key = 'workspace'",
  )
  const publicState = (row) => ({
    enabled: row.enabled === 1,
    token: row.enabled === 1 ? row.token : null,
    revision: row.revision,
  })
  const read = () => publicState(select.get())
  function update(payload) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !['enable', 'reset', 'disable'].includes(payload.action) ||
      !Number.isSafeInteger(payload.revision) ||
      payload.revision < 1
    )
      throw new HttpError(400, '订阅操作或版本无效，请重新加载后重试。')
    const current = select.get()
    if (current.revision !== payload.revision)
      throw new HttpError(409, '订阅已在其他页面变更，已重新加载最新状态，请检查后再操作。')
    if (
      (payload.action === 'enable' && current.enabled === 1) ||
      (payload.action === 'disable' && current.enabled === 0)
    )
      return publicState(current)
    if (payload.action === 'reset' && current.enabled !== 1)
      throw new HttpError(400, '请先生成订阅地址。')
    const enabled = payload.action !== 'disable'
    const token = enabled ? randomBytes(32).toString('base64url') : null
    const changed = database
      .prepare(
        'UPDATE prts_calendar_subscription SET enabled=?,token=?,revision=revision+1 WHERE id=1 AND revision=?',
      )
      .run(Number(enabled), token, payload.revision)
    if (changed.changes !== 1) throw new HttpError(409, '订阅已在其他页面变更，请重新加载。')
    return read()
  }
  function feed(token) {
    const current = select.get()
    if (
      current.enabled !== 1 ||
      typeof token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      !current.token ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(current.token))
    )
      throw new HttpError(404, '订阅地址不存在或已失效。')
    const row = document.get()
    return buildCalendarFeed({
      workspace: row ? JSON.parse(row.data) : null,
      updatedAt: row?.updated_at,
      revision: row?.revision || 0,
      namespace: current.namespace,
    })
  }
  return { read, update, feed }
}
