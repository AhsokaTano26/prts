import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { HttpError } from './errors.mjs'

const deriveKey = promisify(scrypt)
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const COOKIE_NAME = 'prts_session'
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000
const FAILURE_WINDOW_MS = 10 * 60 * 1000
const MAX_FAILURES = 5
const MAX_ADDRESSES = 4096
const MAX_SESSIONS = 1024
const MAX_PARALLEL_LOGINS = 4
const MAX_PASSWORD_BYTES = 1024

function sessionKey(request) {
  const cookies = (request.headers.cookie || '').split(';').map((part) => part.trim())
  const matches = cookies.filter((part) => part.startsWith(`${COOKIE_NAME}=`))
  if (matches.length !== 1) return null
  const token = matches[0].slice(COOKIE_NAME.length + 1)
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  return createHash('sha256').update(token).digest('hex')
}

function sqliteMap(database, table, version) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL, version TEXT NOT NULL)`,
  )
  database.prepare(`DELETE FROM ${table} WHERE version <> ?`).run(version)
  return {
    get(key) {
      const row = database
        .prepare(`SELECT value FROM ${table} WHERE key = ? AND version = ?`)
        .get(key, version)
      return row ? JSON.parse(row.value) : undefined
    },
    set(key, value) {
      database
        .prepare(
          `INSERT INTO ${table} (key, value, version) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, version=excluded.version`,
        )
        .run(key, JSON.stringify(value), version)
    },
    delete(key) {
      database.prepare(`DELETE FROM ${table} WHERE key = ?`).run(key)
    },
    get size() {
      return database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
    },
    *[Symbol.iterator]() {
      for (const row of database
        .prepare(`SELECT key, value FROM ${table} WHERE version = ?`)
        .all(version))
        yield [row.key, JSON.parse(row.value)]
    },
  }
}

export function createAuth({ env, now = Date.now, database }) {
  const password = env.PRTS_PASSWORD
  const configured =
    typeof password === 'string' &&
    Boolean(password.trim()) &&
    Buffer.byteLength(password) <= MAX_PASSWORD_BYTES
  const secure = env.PRTS_COOKIE_SECURE === 'true'
  let salt = randomBytes(16)
  if (database) {
    database.exec(
      'CREATE TABLE IF NOT EXISTS auth_metadata (key TEXT PRIMARY KEY, value BLOB NOT NULL)',
    )
    database
      .prepare('INSERT OR IGNORE INTO auth_metadata (key, value) VALUES (?, ?)')
      .run('password-salt', salt)
    salt = Buffer.from(
      database.prepare('SELECT value FROM auth_metadata WHERE key = ?').get('password-salt').value,
    )
  }
  const passwordHash = configured ? scryptSync(password, salt, 64, SCRYPT_OPTIONS) : null
  const version = passwordHash
    ? createHash('sha256').update(passwordHash).digest('hex')
    : 'unconfigured'
  const sessions = database ? sqliteMap(database, 'auth_sessions', version) : new Map()
  const failures = database ? sqliteMap(database, 'auth_failures', version) : new Map()
  let parallelLogins = 0

  function atomic(fn) {
    if (!database) return fn()
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  function requireConfigured() {
    if (!configured) {
      throw new HttpError(503, '工作台访问密码尚未配置或无效，请设置 PRTS_PASSWORD 后重启服务。')
    }
  }

  function cookie(token, expiresAt) {
    const maxAge = token ? Math.max(0, Math.floor((expiresAt - now()) / 1000)) : 0
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Expires=${new Date(expiresAt).toUTCString()}${secure ? '; Secure' : ''}`
  }

  function state(request) {
    const key = sessionKey(request)
    const expiresAt = key ? sessions.get(key) : undefined
    if (expiresAt !== undefined && expiresAt <= now()) sessions.delete(key)
    return configured && expiresAt !== undefined && expiresAt > now()
      ? { configured: true, authenticated: true, expiresAt }
      : { configured, authenticated: false }
  }

  function checkOrigin(request) {
    if (
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) ||
      request.headers.origin === undefined
    )
      return
    const origin = request.headers.origin
    const host = request.headers.host
    try {
      if (typeof origin !== 'string' || typeof host !== 'string' || /[\s/@\\?#]/.test(host)) {
        throw new Error('Invalid origin or host')
      }
      const protocol = secure || request.socket.encrypted ? 'https:' : 'http:'
      const expected = new URL(`${protocol}//${host}`)
      const supplied = new URL(origin)
      if (
        expected.host !== host.toLowerCase() &&
        expected.host !== host.toLowerCase().replace(protocol === 'https:' ? /:443$/ : /:80$/, '')
      ) {
        throw new Error('Invalid host')
      }
      if (supplied.origin !== origin || supplied.origin !== expected.origin) {
        throw new Error('Origin mismatch')
      }
    } catch {
      throw new HttpError(403, '请求来源不匹配，请从工作台页面重新操作。')
    }
  }

  function reserveAttempt(request) {
    return atomic(() => {
      const time = now()
      for (const [address, entry] of failures) {
        if (entry.until <= time) failures.delete(address)
      }
      const address = createHash('sha256')
        .update(request.socket.remoteAddress || 'unknown')
        .digest('hex')
      let entry = failures.get(address)
      if (entry && entry.count >= MAX_FAILURES) {
        throw new HttpError(429, '密码尝试过于频繁，请稍后重试。', {
          'retry-after': String(Math.max(1, Math.ceil((entry.until - time) / 1000))),
        })
      }
      if (!entry && failures.size >= MAX_ADDRESSES) {
        throw new HttpError(429, '登录请求过于频繁，请稍后重试。', { 'retry-after': '10' })
      }
      if (!entry) {
        entry = { count: 0, until: time + FAILURE_WINDOW_MS }
        failures.set(address, entry)
      }
      // Reserve before reading the body or computing a hash: parallel requests share the limit.
      entry.count += 1
      failures.set(address, entry)
      return address
    })
  }

  function releaseAttempt(address) {
    atomic(() => {
      const entry = failures.get(address)
      if (entry) failures.set(address, { ...entry, count: Math.max(0, entry.count - 1) })
    })
  }

  async function login(request, readPayload) {
    requireConfigured()
    const attempt = reserveAttempt(request)
    let acquiredSlot = false
    try {
      const payload = await readPayload()
      if (
        typeof payload?.password !== 'string' ||
        !payload.password ||
        Buffer.byteLength(payload.password) > MAX_PASSWORD_BYTES
      ) {
        throw new HttpError(400, '请输入有效的访问密码。')
      }
      // Slow request bodies must not occupy the global, memory-bound scrypt slots.
      if (parallelLogins >= MAX_PARALLEL_LOGINS) {
        releaseAttempt(attempt)
        throw new HttpError(429, '登录请求过于频繁，请稍后重试。', { 'retry-after': '10' })
      }
      parallelLogins += 1
      acquiredSlot = true
      const candidate = await deriveKey(payload.password, salt, 64, SCRYPT_OPTIONS)
      const matches = timingSafeEqual(passwordHash, candidate)
      candidate.fill(0)
      if (!matches) throw new HttpError(401, '访问密码错误，请重新输入。')
      releaseAttempt(attempt)
      const time = now()
      for (const [key, expiresAt] of sessions) {
        if (expiresAt <= time) sessions.delete(key)
      }
      const previous = sessionKey(request)
      if (previous) sessions.delete(previous)
      if (sessions.size >= MAX_SESSIONS) {
        throw new HttpError(503, '当前登录会话过多，请稍后重试。')
      }
      const token = randomBytes(32).toString('base64url')
      const expiresAt = time + SESSION_DURATION_MS
      sessions.set(createHash('sha256').update(token).digest('hex'), expiresAt)
      return {
        state: { configured: true, authenticated: true, expiresAt },
        cookie: cookie(token, expiresAt),
      }
    } finally {
      if (acquiredSlot) parallelLogins -= 1
    }
  }

  return {
    state,
    checkOrigin,
    login,
    requireSession(request) {
      requireConfigured()
      if (!state(request).authenticated) {
        throw new HttpError(401, '请先登录工作台。')
      }
    },
    logout(request) {
      const key = sessionKey(request)
      if (key) sessions.delete(key)
      return cookie('', 0)
    },
  }
}
