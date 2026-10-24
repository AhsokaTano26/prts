import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { HttpError } from './errors.mjs'

const COOKIE = 'prts_webauthn'
const TTL = 5 * 60_000
const sha = (value) => createHash('sha256').update(value).digest('hex')
const transports = new Set(['internal', 'hybrid', 'usb', 'nfc', 'ble', 'smart-card'])
function requireTopLevel(response, status) {
  try {
    const encoded = response?.response?.clientDataJSON
    if (typeof encoded !== 'string' || encoded.length > 16_384) throw new Error()
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (
      data.crossOrigin === true ||
      (data.crossOrigin !== undefined && typeof data.crossOrigin !== 'boolean') ||
      (data.topOrigin !== undefined && data.topOrigin !== data.origin)
    )
      throw new Error()
  } catch {
    throw new HttpError(status, 'Passkey 请求数据无效或来自跨站嵌入，请从工作台页面重试。')
  }
}
export function createPasskeys(database, auth, { now = Date.now } = {}) {
  database.exec(`CREATE TABLE IF NOT EXISTS prts_passkeys (
    id TEXT PRIMARY KEY, credential_id TEXT NOT NULL UNIQUE, public_key BLOB NOT NULL,
    counter INTEGER NOT NULL, transports TEXT NOT NULL, rp_id TEXT NOT NULL,
    name TEXT NOT NULL, device_type TEXT NOT NULL, backed_up INTEGER NOT NULL,
    created_at INTEGER NOT NULL, last_used_at INTEGER
  ) STRICT;
  CREATE TABLE IF NOT EXISTS prts_passkey_challenges (
    id TEXT PRIMARY KEY, challenge TEXT NOT NULL, flow TEXT NOT NULL, origin TEXT NOT NULL,
    rp_id TEXT NOT NULL, version TEXT NOT NULL, session_binding TEXT,
    name TEXT NOT NULL, expires_at INTEGER NOT NULL, address TEXT NOT NULL
  ) STRICT`)
  database
    .prepare('INSERT OR IGNORE INTO auth_metadata (key,value) VALUES (?,?)')
    .run('passkey-user-id', randomBytes(32))
  const userHandle = () =>
    Buffer.from(
      database.prepare('SELECT value FROM auth_metadata WHERE key=?').get('passkey-user-id').value,
    )
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
  function context(request, required = true) {
    let origin, rpID
    try {
      origin = auth.origin(request)
      const url = new URL(origin)
      rpID = url.hostname
      if (isIP(rpID.replace(/^\[|\]$/g, '')) || (url.protocol !== 'https:' && rpID !== 'localhost'))
        throw new Error()
      return { supported: true, origin, rpID, reason: '' }
    } catch {
      const reason = 'Passkey 需要 HTTPS 域名；本地请使用 localhost，IP 地址不支持。'
      if (required) throw new HttpError(400, reason)
      return { supported: false, origin: '', rpID: '', reason }
    }
  }
  function token(request) {
    const matches = (request.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${COOKIE}=`))
    if (matches.length !== 1) return null
    const value = matches[0].slice(COOKIE.length + 1)
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null
  }
  const cookie = (value) =>
    `${COOKIE}=${value}; Path=/api/auth/passkeys; HttpOnly; SameSite=Strict; Max-Age=${value ? 300 : 0}${auth.secure ? '; Secure' : ''}`
  function createChallenge(request, flow, options, version, name = '') {
    const scope = context(request)
    const value = randomBytes(32).toString('base64url')
    const address = sha(request.socket.remoteAddress || 'unknown')
    atomic(() => {
      database.prepare('DELETE FROM prts_passkey_challenges WHERE expires_at<=?').run(now())
      const previous = token(request)
      if (previous)
        database.prepare('DELETE FROM prts_passkey_challenges WHERE id=?').run(sha(previous))
      if (
        database
          .prepare('SELECT COUNT(*) AS count FROM prts_passkey_challenges WHERE address=?')
          .get(address).count >= 10 ||
        database.prepare('SELECT COUNT(*) AS count FROM prts_passkey_challenges').get().count >=
          1024
      )
        throw new HttpError(429, 'Passkey 请求过于频繁，请稍后重试。', { 'retry-after': '300' })
      if (version !== auth.currentVersion())
        throw new HttpError(401, '访问凭据已更新，请重新开始。')
      if (flow === 'registration') auth.requireSession(request)
      database
        .prepare('INSERT INTO prts_passkey_challenges VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(
          sha(value),
          options.challenge,
          flow,
          scope.origin,
          scope.rpID,
          version,
          flow === 'registration' ? auth.sessionBinding(request) : null,
          name,
          now() + TTL,
          address,
        )
    })
    return { options, cookie: cookie(value) }
  }
  function consume(request, flow, version) {
    const value = token(request)
    const scope = context(request)
    if (!value) throw new HttpError(400, 'Passkey 请求已失效，请重新开始。')
    const row = atomic(() =>
      database
        .prepare('DELETE FROM prts_passkey_challenges WHERE id=? RETURNING *')
        .get(sha(value)),
    )
    if (
      !row ||
      row.flow !== flow ||
      row.expires_at <= now() ||
      row.origin !== scope.origin ||
      row.rp_id !== scope.rpID ||
      row.version !== version ||
      (flow === 'registration' && row.session_binding !== auth.sessionBinding(request))
    )
      throw new HttpError(400, 'Passkey 请求已失效，请重新开始。')
    return row
  }
  function status(request) {
    const scope = context(request, false)
    return {
      ...scope,
      available:
        scope.supported &&
        database
          .prepare('SELECT COUNT(*) AS count FROM prts_passkeys WHERE rp_id=?')
          .get(scope.rpID).count > 0,
    }
  }
  function list(request) {
    auth.requireSession(request)
    const scope = context(request, false)
    return {
      ...scope,
      credentials: database
        .prepare(
          'SELECT id,name,rp_id AS rpID,device_type AS deviceType,backed_up AS backedUp,created_at AS createdAt,last_used_at AS lastUsedAt FROM prts_passkeys ORDER BY created_at DESC',
        )
        .all()
        .map((row) => ({ ...row, backedUp: Boolean(row.backedUp) })),
    }
  }
  async function registrationOptions(request, payload) {
    auth.requireSession(request)
    const scope = context(request)
    const name = payload?.name === undefined ? '本设备' : payload.name
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(name)
    )
      throw new HttpError(400, 'Passkey 名称应为 1 至 80 个字符。')
    if (database.prepare('SELECT COUNT(*) AS count FROM prts_passkeys').get().count >= 10)
      throw new HttpError(400, '最多保存 10 个 Passkey，请先移除不用的凭据。')
    const version = await auth.reauthenticate(request, payload?.currentPassword)
    const existing = database
      .prepare('SELECT credential_id,transports FROM prts_passkeys WHERE rp_id=?')
      .all(scope.rpID)
    const options = await generateRegistrationOptions({
      rpName: 'PRTS 个人工作终端',
      rpID: scope.rpID,
      userID: new Uint8Array(userHandle()),
      userName: 'Doctor',
      userDisplayName: '博士',
      attestationType: 'none',
      timeout: 60_000,
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      excludeCredentials: existing.map((row) => ({
        id: row.credential_id,
        transports: JSON.parse(row.transports),
      })),
    })
    return createChallenge(request, 'registration', options, version, name.trim())
  }
  async function verifyRegistration(request, response) {
    auth.requireSession(request)
    const version = auth.currentVersion()
    const challenge = consume(request, 'registration', version)
    requireTopLevel(response, 400)
    let result
    try {
      result = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rp_id,
        requireUserVerification: true,
      })
    } catch {
      throw new HttpError(400, 'Passkey 注册验证失败，请重新开始。')
    }
    if (!result.verified) throw new HttpError(400, 'Passkey 注册验证失败。')
    const info = result.registrationInfo
    const credential = info.credential
    const id = randomUUID()
    atomic(() => {
      auth.requireSession(request)
      if (
        version !== auth.currentVersion() ||
        challenge.session_binding !== auth.sessionBinding(request)
      )
        throw new HttpError(401, '登录状态已更新，请重新注册。')
      if (database.prepare('SELECT COUNT(*) AS count FROM prts_passkeys').get().count >= 10)
        throw new HttpError(400, '最多保存 10 个 Passkey。')
      if (database.prepare('SELECT id FROM prts_passkeys WHERE credential_id=?').get(credential.id))
        throw new HttpError(409, '此 Passkey 已添加。')
      const hints = Array.isArray(response?.response?.transports)
        ? response.response.transports.filter((value) => transports.has(value))
        : []
      database
        .prepare('INSERT INTO prts_passkeys VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          credential.id,
          Buffer.from(credential.publicKey),
          credential.counter,
          JSON.stringify([...new Set(hints)]),
          challenge.rp_id,
          challenge.name,
          info.credentialDeviceType,
          info.credentialBackedUp ? 1 : 0,
          now(),
          null,
        )
    })
    return { id, registered: true }
  }
  async function authenticationOptions(request) {
    const scope = context(request)
    const values = database
      .prepare('SELECT credential_id,transports FROM prts_passkeys WHERE rp_id=?')
      .all(scope.rpID)
    if (!values.length) throw new HttpError(400, '当前域名尚未设置 Passkey，请先使用密码登录。')
    const version = auth.currentVersion()
    const options = await generateAuthenticationOptions({
      rpID: scope.rpID,
      timeout: 60_000,
      userVerification: 'required',
      allowCredentials: values.map((row) => ({
        id: row.credential_id,
        transports: JSON.parse(row.transports),
      })),
    })
    return createChallenge(request, 'authentication', options, version)
  }
  async function verifyAuthentication(request, response) {
    return auth.loginWithProof(request, async (version) => {
      const challenge = consume(request, 'authentication', version)
      requireTopLevel(response, 401)
      if (typeof response?.id !== 'string' || response.id.length > 2000)
        throw new HttpError(401, 'Passkey 验证失败。')
      const saved = database
        .prepare('SELECT * FROM prts_passkeys WHERE credential_id=? AND rp_id=?')
        .get(response.id, challenge.rp_id)
      if (!saved) throw new HttpError(401, 'Passkey 验证失败。')
      const handle = response?.response?.userHandle
      if (handle !== null && handle !== undefined && handle !== userHandle().toString('base64url'))
        throw new HttpError(401, 'Passkey 验证失败。')
      let result
      try {
        result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: challenge.origin,
          expectedRPID: challenge.rp_id,
          requireUserVerification: true,
          credential: {
            id: saved.credential_id,
            publicKey: new Uint8Array(saved.public_key),
            counter: saved.counter,
            transports: JSON.parse(saved.transports),
          },
        })
      } catch {
        throw new HttpError(401, 'Passkey 验证失败，请重试或使用密码登录。')
      }
      if (!result.verified) throw new HttpError(401, 'Passkey 验证失败。')
      return () => {
        const info = result.authenticationInfo
        const updated = database
          .prepare(
            'UPDATE prts_passkeys SET counter=?,last_used_at=?,backed_up=?,device_type=? WHERE id=? AND counter=? AND public_key=?',
          )
          .run(
            info.newCounter,
            now(),
            info.credentialBackedUp ? 1 : 0,
            info.credentialDeviceType,
            saved.id,
            saved.counter,
            saved.public_key,
          )
        if (!updated.changes) throw new HttpError(401, 'Passkey 已更新或移除，请重新验证。')
      }
    })
  }
  async function remove(request, id, payload) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
      throw new HttpError(400, 'Passkey ID 无效。')
    const version = await auth.reauthenticate(request, payload?.currentPassword)
    atomic(() => {
      auth.requireSession(request)
      if (version !== auth.currentVersion())
        throw new HttpError(401, '访问凭据已更新，请重新登录。')
      if (!database.prepare('DELETE FROM prts_passkeys WHERE id=?').run(id).changes)
        throw new HttpError(404, '此 Passkey 不存在。')
      auth.revokeSessions()
      database.exec('DELETE FROM prts_passkey_challenges')
    })
    return { removed: true, authenticated: false, cookie: auth.logout(request) }
  }
  return {
    status,
    list,
    registrationOptions,
    verifyRegistration,
    authenticationOptions,
    verifyAuthentication,
    remove,
    clearCookie: () => cookie(''),
  }
}
