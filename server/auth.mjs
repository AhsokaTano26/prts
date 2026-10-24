import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { HttpError } from './errors.mjs'
import { createDatabase } from './database.mjs'

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

function sqliteMap(database, table, currentVersion) {
  database.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL, version TEXT NOT NULL)`,
  )
  database.prepare(`DELETE FROM ${table} WHERE version <> ?`).run(currentVersion())
  return {
    get(key, version = currentVersion()) {
      const row = database
        .prepare(`SELECT value FROM ${table} WHERE key = ? AND version = ?`)
        .get(key, version)
      return row ? JSON.parse(row.value) : undefined
    },
    set(key, value, version = currentVersion()) {
      database
        .prepare(
          `INSERT INTO ${table} (key, value, version) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, version=excluded.version`,
        )
        .run(key, JSON.stringify(value), version)
    },
    delete(key, version = currentVersion()) {
      database.prepare(`DELETE FROM ${table} WHERE key = ? AND version = ?`).run(key, version)
    },
    get size() {
      return database
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE version = ?`)
        .get(currentVersion()).count
    },
    *[Symbol.iterator]() {
      for (const row of database
        .prepare(`SELECT key, value FROM ${table} WHERE version = ?`)
        .all(currentVersion()))
        yield [row.key, JSON.parse(row.value)]
    },
  }
}

export function createAuth({
  env = {},
  now = Date.now,
  database = createDatabase(),
  logger = console.log,
}) {
  const secure = env.PRTS_COOKIE_SECURE === 'true'
  database.exec(
    'CREATE TABLE IF NOT EXISTS auth_metadata (key TEXT PRIMARY KEY, value BLOB NOT NULL)',
  )
  let parallelLogins = 0

  function atomic(fn) {
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

  function credential() {
    const row = database
      .prepare('SELECT value FROM auth_metadata WHERE key = ?')
      .get('password-credential')
    if (!row) return null
    const value = JSON.parse(Buffer.from(row.value).toString())
    const salt = Buffer.from(value.salt, 'base64')
    const hash = Buffer.from(value.hash, 'base64')
    if (salt.length !== 16 || hash.length !== 64) throw new Error('数据库访问凭据无效。')
    return { salt, hash, version: createHash('sha256').update(hash).digest('hex') }
  }

  function saveCredential(salt, hash) {
    database
      .prepare(
        'INSERT INTO auth_metadata (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(
        'password-credential',
        Buffer.from(
          JSON.stringify({ salt: salt.toString('base64'), hash: hash.toString('base64') }),
        ),
      )
  }

  let generatedPassword
  atomic(() => {
    if (credential()) return
    let password = env.PRTS_PASSWORD
    if (
      password === undefined ||
      password === '' ||
      (typeof password === 'string' && !password.trim())
    ) {
      password = randomBytes(24).toString('base64url')
      generatedPassword = password
    }
    if (typeof password !== 'string' || Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
      throw new Error('PRTS_PASSWORD 首次初始化值无效，密码不能超过 1024 字节。')
    }
    const legacy = database
      .prepare('SELECT value FROM auth_metadata WHERE key = ?')
      .get('password-salt')
    const salt = legacy ? Buffer.from(legacy.value) : randomBytes(16)
    if (salt.length !== 16) throw new Error('数据库访问凭据无效。')
    const hash = scryptSync(password, salt, 64, SCRYPT_OPTIONS)
    saveCredential(salt, hash)
    hash.fill(0)
  })
  if (generatedPassword) logger(`PRTS 初始访问密码（仅显示一次）：${generatedPassword}`)
  database
    .prepare('INSERT OR IGNORE INTO auth_metadata (key,value) VALUES (?,?)')
    .run('session-revocation', Buffer.from('0'))
  function revocation() {
    const row = database
      .prepare('SELECT value FROM auth_metadata WHERE key=?')
      .get('session-revocation')
    const value = Number(Buffer.from(row.value).toString())
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('会话撤销状态无效。')
    return value
  }
  const currentVersion = () => {
    const version = credential().version
    const epoch = revocation()
    return epoch === 0 ? version : createHash('sha256').update(`${version}:${epoch}`).digest('hex')
  }
  const sessions = sqliteMap(database, 'auth_sessions', currentVersion)
  const failures = sqliteMap(database, 'auth_failures', currentVersion)

  function cookie(token, expiresAt) {
    const maxAge = token ? Math.max(0, Math.floor((expiresAt - now()) / 1000)) : 0
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Expires=${new Date(expiresAt).toUTCString()}${secure ? '; Secure' : ''}`
  }

  function state(request) {
    const key = sessionKey(request)
    const expiresAt = key ? sessions.get(key) : undefined
    if (expiresAt !== undefined && expiresAt <= now()) sessions.delete(key)
    return expiresAt !== undefined && expiresAt > now()
      ? { configured: true, authenticated: true, expiresAt }
      : { configured: true, authenticated: false }
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
      return { address, version: currentVersion() }
    })
  }

  function releaseReserved({ address, version }) {
    const entry = failures.get(address, version)
    if (entry) failures.set(address, { ...entry, count: Math.max(0, entry.count - 1) }, version)
  }

  function acquireSlot(attempt) {
    if (parallelLogins >= MAX_PARALLEL_LOGINS) {
      atomic(() => releaseReserved(attempt))
      throw new HttpError(429, '登录请求过于频繁，请稍后重试。', { 'retry-after': '10' })
    }
    parallelLogins += 1
  }

  async function matches(password, saved) {
    const candidate = await deriveKey(password, saved.salt, 64, SCRYPT_OPTIONS)
    try {
      return timingSafeEqual(saved.hash, candidate)
    } finally {
      candidate.fill(0)
    }
  }

  function issueSession(request) {
    const time = now()
    for (const [key, expiresAt] of sessions) if (expiresAt <= time) sessions.delete(key)
    const previous = sessionKey(request)
    if (previous) sessions.delete(previous)
    if (sessions.size >= MAX_SESSIONS) throw new HttpError(503, '当前登录会话过多，请稍后重试。')
    const token = randomBytes(32).toString('base64url')
    const expiresAt = time + SESSION_DURATION_MS
    sessions.set(createHash('sha256').update(token).digest('hex'), expiresAt)
    return {
      state: { configured: true, authenticated: true, expiresAt },
      cookie: cookie(token, expiresAt),
    }
  }

  async function login(request, readPayload) {
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
      acquireSlot(attempt)
      acquiredSlot = true
      const saved = { ...credential(), version: currentVersion() }
      if (!(await matches(payload.password, saved)))
        throw new HttpError(401, '访问密码错误，请重新输入。')
      return atomic(() => {
        // A password update may have completed while scrypt was running.
        if (saved.version !== currentVersion() || attempt.version !== saved.version)
          throw new HttpError(401, '访问密码已修改，请重新登录。')
        releaseReserved(attempt)
        return issueSession(request)
      })
    } finally {
      if (acquiredSlot) parallelLogins -= 1
    }
  }

  function requireSession(request) {
    if (!state(request).authenticated) throw new HttpError(401, '请先登录工作台。')
  }

  async function reauthenticate(request, password) {
    requireSession(request)
    const attempt = reserveAttempt(request)
    let acquired = false
    try {
      if (
        typeof password !== 'string' ||
        !password ||
        Buffer.byteLength(password) > MAX_PASSWORD_BYTES
      )
        throw new HttpError(400, '请输入有效的当前密码。')
      acquireSlot(attempt)
      acquired = true
      const saved = { ...credential(), version: currentVersion() }
      if (!(await matches(password, saved))) throw new HttpError(400, '当前密码错误，请重新输入。')
      return atomic(() => {
        requireSession(request)
        if (saved.version !== currentVersion() || saved.version !== attempt.version)
          throw new HttpError(401, '访问凭据已更新，请重新登录。')
        releaseReserved(attempt)
        return saved.version
      })
    } finally {
      if (acquired) parallelLogins -= 1
    }
  }
  async function loginWithProof(request, verify) {
    const attempt = reserveAttempt(request)
    let acquired = false
    try {
      acquireSlot(attempt)
      acquired = true
      const commit = await verify(attempt.version)
      return atomic(() => {
        if (attempt.version !== currentVersion())
          throw new HttpError(401, '访问凭据已更新，请重新登录。')
        if (typeof commit !== 'function') throw new HttpError(401, 'Passkey 验证失败。')
        commit()
        releaseReserved(attempt)
        return issueSession(request)
      })
    } finally {
      if (acquired) parallelLogins -= 1
    }
  }

  async function changePassword(request, readPayload) {
    requireSession(request)
    const attempt = reserveAttempt(request)
    let acquiredSlot = false
    let newHash
    try {
      const payload = await readPayload()
      if (
        typeof payload?.currentPassword !== 'string' ||
        !payload.currentPassword ||
        Buffer.byteLength(payload.currentPassword) > MAX_PASSWORD_BYTES
      ) {
        throw new HttpError(400, '请输入有效的当前密码。')
      }
      if (
        typeof payload?.newPassword !== 'string' ||
        !payload.newPassword.trim() ||
        Buffer.byteLength(payload.newPassword) < 8 ||
        Buffer.byteLength(payload.newPassword) > MAX_PASSWORD_BYTES
      ) {
        throw new HttpError(400, '新密码须为 8 至 1024 字节，且不能全为空白。')
      }
      acquireSlot(attempt)
      acquiredSlot = true
      const saved = { ...credential(), version: currentVersion() }
      if (!(await matches(payload.currentPassword, saved)))
        throw new HttpError(400, '当前密码错误，请重新输入。')
      const salt = randomBytes(16)
      newHash = await deriveKey(payload.newPassword, salt, 64, SCRYPT_OPTIONS)
      atomic(() => {
        if (saved.version !== currentVersion() || saved.version !== attempt.version)
          throw new HttpError(401, '访问密码已修改，请重新登录。')
        requireSession(request)
        saveCredential(salt, newHash)
        database.exec('DELETE FROM auth_sessions; DELETE FROM auth_failures;')
      })
      return cookie('', 0)
    } finally {
      newHash?.fill(0)
      if (acquiredSlot) parallelLogins -= 1
    }
  }

  return {
    state,
    checkOrigin,
    login,
    changePassword,
    requireSession,
    reauthenticate,
    loginWithProof,
    currentVersion,
    sessionBinding: sessionKey,
    origin(request) {
      const host = request.headers.host
      if (typeof host !== 'string' || /[\s/@\\?#]/.test(host))
        throw new HttpError(400, '访问地址无效。')
      return new URL(`${secure || request.socket.encrypted ? 'https' : 'http'}://${host}`).origin
    },
    secure,
    // Call within the management mutation's transaction.
    revokeSessions() {
      const next = revocation() + 1
      if (!Number.isSafeInteger(next)) throw new Error('会话撤销状态无效。')
      database
        .prepare('UPDATE auth_metadata SET value=? WHERE key=?')
        .run(Buffer.from(String(next)), 'session-revocation')
      database.exec('DELETE FROM auth_sessions; DELETE FROM auth_failures;')
    },
    logout(request) {
      const key = sessionKey(request)
      if (key) sessions.delete(key)
      return cookie('', 0)
    },
  }
}
