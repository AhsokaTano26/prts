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

export function createAuth({ env, now = Date.now }) {
  const password = env.PRTS_PASSWORD
  const configured =
    typeof password === 'string' &&
    Boolean(password.trim()) &&
    Buffer.byteLength(password) <= MAX_PASSWORD_BYTES
  const secure = env.PRTS_COOKIE_SECURE === 'true'
  const salt = randomBytes(16)
  const passwordHash = configured ? scryptSync(password, salt, 64, SCRYPT_OPTIONS) : null
  const sessions = new Map()
  const failures = new Map()
  let parallelLogins = 0

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
    if (request.method !== 'POST' || request.headers.origin === undefined) return
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
    const time = now()
    for (const [address, entry] of failures) {
      if (entry.until <= time) failures.delete(address)
    }
    const address = request.socket.remoteAddress || 'unknown'
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
    return entry
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
        attempt.count = Math.max(0, attempt.count - 1)
        throw new HttpError(429, '登录请求过于频繁，请稍后重试。', { 'retry-after': '10' })
      }
      parallelLogins += 1
      acquiredSlot = true
      const candidate = await deriveKey(payload.password, salt, 64, SCRYPT_OPTIONS)
      const matches = timingSafeEqual(passwordHash, candidate)
      candidate.fill(0)
      if (!matches) throw new HttpError(401, '访问密码错误，请重新输入。')
      attempt.count = Math.max(0, attempt.count - 1)
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
