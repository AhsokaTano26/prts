import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import LoginView from './LoginView'
import { advanceSessionEpoch, SESSION_EXPIRED_EVENT } from '../lib/api'
import {
  PASSKEYS_CHANGED,
  authenticatePasskey,
  cancelPasskeyCeremony,
  passkeyRequest,
  passkeyError,
  supportsPasskeys,
} from '../lib/passkeys'

type Status = 'checking' | 'locked' | 'unconfigured' | 'offline' | 'authenticated'
const LOCK_KEY = 'prts-lock-required'

function lockPending() {
  try {
    return localStorage.getItem(LOCK_KEY) === '1'
  } catch {
    return false
  }
}

function rememberLock(pending: boolean) {
  try {
    if (pending) localStorage.setItem(LOCK_KEY, '1')
    else localStorage.removeItem(LOCK_KEY)
  } catch {
    // The in-memory lock remains active even if browser storage is unavailable.
  }
}

function resetBoot() {
  try {
    sessionStorage.removeItem('prts-boot-seen')
  } catch {
    // Storage is optional for the presentation sequence.
  }
}

export default function AuthGate({ children }: { children: (lock: () => void) => ReactNode }) {
  const [status, setStatus] = useState<Status>('checking')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [expiresAt, setExpiresAt] = useState(0)
  const [passkeyAvailable, setPasskeyAvailable] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [passkeyNote, setPasskeyNote] = useState('')
  const autoAttempted = useRef(false)
  const passkeyOperation = useRef<{
    controller: AbortController
    cancelled: boolean
    phase: 'options' | 'device' | 'verify'
  } | null>(null)
  const generation = useRef(0)
  const mutating = useRef(false)
  const pendingLock = useRef(lockPending())

  const lock = useCallback(async () => {
    autoAttempted.current = true
    const operation = passkeyOperation.current
    if (operation) {
      operation.cancelled = true
      if (operation.phase !== 'verify') operation.controller.abort()
      void cancelPasskeyCeremony()
    }
    ++generation.current
    advanceSessionEpoch()
    pendingLock.current = true
    rememberLock(true)
    resetBoot()
    setStatus('locked')
    setError('')
    setBusy(true)
    // Never discard a lock while login is issuing a cookie. Its finally block
    // will revoke that late cookie before any workspace can mount.
    if (mutating.current) return
    mutating.current = true
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        signal: AbortSignal.timeout(6000),
      })
      if (!response.ok) throw new Error('退出未完成，请重新连接以撤销登录状态。')
      pendingLock.current = false
      rememberLock(false)
    } catch {
      setStatus('offline')
      setError('终端已锁定。未能撤销服务器会话，请重新连接完成退出。')
    } finally {
      mutating.current = false
      setBusy(false)
    }
  }, [])

  const checkSession = useCallback(async () => {
    if (mutating.current) return
    // Recovery uses the same mutation queue as explicit logout, including
    // StrictMode replay and overlapping focus / visibility events.
    if (pendingLock.current || lockPending()) {
      await lock()
      return
    }
    const version = ++generation.current
    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      })
      if (!response.ok) throw new Error('无法验证登录状态，请重新连接。')
      const session = await response.json()
      if (version !== generation.current) return
      setPasskeyAvailable(session.passkeyAvailable === true)
      setError('')
      if (session.configured === false) setStatus('unconfigured')
      else if (
        session.authenticated === true &&
        Number.isFinite(session.expiresAt) &&
        session.expiresAt > Date.now()
      ) {
        advanceSessionEpoch()
        setExpiresAt(session.expiresAt)
        setStatus('authenticated')
      } else {
        if (session.passkeyAvailable !== true) autoAttempted.current = true
        setStatus('locked')
      }
    } catch (cause) {
      if (version !== generation.current) return
      setStatus('offline')
      setError(
        cause instanceof Error && cause.name !== 'TypeError'
          ? cause.message
          : '无法连接终端验证服务，请检查连接后重试。',
      )
    }
  }, [lock])

  async function login(password: string) {
    if (mutating.current) return
    const version = ++generation.current
    advanceSessionEpoch()
    mutating.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(10000),
      })
      const session = await response.json()
      if (!response.ok) throw new Error(session.error || '验证失败，请稍后重试。')
      if (
        session.authenticated !== true ||
        !Number.isFinite(session.expiresAt) ||
        session.expiresAt <= Date.now()
      ) {
        throw new Error('验证服务响应异常，请重新连接。')
      }
      if (version !== generation.current) return
      pendingLock.current = false
      rememberLock(false)
      setExpiresAt(session.expiresAt)
      setStatus('authenticated')
    } catch (cause) {
      if (version !== generation.current) return
      setError(
        cause instanceof Error && cause.name !== 'TypeError'
          ? cause.message
          : '无法连接验证服务，请稍后重试。',
      )
    } finally {
      mutating.current = false
      setBusy(false)
      if (pendingLock.current || lockPending()) void lock()
    }
  }

  async function loginPasskey() {
    if (mutating.current || !supportsPasskeys()) return
    autoAttempted.current = true
    const version = ++generation.current
    advanceSessionEpoch()
    mutating.current = true
    setBusy(true)
    setPasskeyBusy(true)
    setError('')
    setPasskeyNote('')
    const operation: {
      controller: AbortController
      cancelled: boolean
      phase: 'options' | 'device' | 'verify'
    } = { controller: new AbortController(), cancelled: false, phase: 'options' }
    passkeyOperation.current = operation
    try {
      const options = await passkeyRequest(
        '/api/auth/passkeys/authentication/options',
        {},
        { signal: operation.controller.signal },
      )
      operation.controller.signal.throwIfAborted()
      operation.phase = 'device'
      const credential = await authenticatePasskey(options, operation.controller.signal)
      operation.controller.signal.throwIfAborted()
      if (operation.cancelled) throw new DOMException('Cancelled', 'AbortError')
      operation.phase = 'verify'
      // Once verification can issue a cookie, let it settle before queued logout.
      const session = await passkeyRequest('/api/auth/passkeys/authentication/verify', credential)
      if (version !== generation.current || operation.cancelled) return
      if (
        session.authenticated !== true ||
        !Number.isFinite(session.expiresAt) ||
        session.expiresAt <= Date.now()
      )
        throw new Error('Passkey 登录响应异常。')
      pendingLock.current = false
      rememberLock(false)
      setExpiresAt(session.expiresAt)
      setStatus('authenticated')
    } catch (cause) {
      if (version === generation.current) setPasskeyNote(passkeyError(cause))
    } finally {
      if (passkeyOperation.current === operation) passkeyOperation.current = null
      mutating.current = false
      setBusy(false)
      setPasskeyBusy(false)
      if (pendingLock.current || lockPending()) void lock()
    }
  }
  function usePassword() {
    autoAttempted.current = true
    const operation = passkeyOperation.current
    if (operation) {
      operation.cancelled = true
      if (operation.phase === 'verify') {
        void lock()
        return
      }
      operation.controller.abort()
      void cancelPasskeyCeremony()
    }
    setPasskeyNote('可以使用访问密码登录。')
  }

  useEffect(() => {
    if (status !== 'locked' || !passkeyAvailable || autoAttempted.current || !supportsPasskeys())
      return
    const begin = () => {
      if (document.visibilityState === 'visible' && !autoAttempted.current && !mutating.current) {
        autoAttempted.current = true
        void loginPasskey()
      }
    }
    begin()
    document.addEventListener('visibilitychange', begin)
    return () => document.removeEventListener('visibilitychange', begin)
  }, [status, passkeyAvailable])

  useEffect(
    () => () => {
      const operation = passkeyOperation.current
      if (operation) {
        operation.cancelled = true
        if (operation.phase !== 'verify') operation.controller.abort()
        void cancelPasskeyCeremony()
      }
    },
    [],
  )

  useEffect(() => {
    void checkSession()
    const onFocus = () => void checkSession()
    const onOffline = () => {
      ++generation.current
      advanceSessionEpoch()
      setStatus('offline')
      setError('当前网络已断开，恢复连接后会重新验证登录。')
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkSession()
    }
    const onExpired = () => {
      autoAttempted.current = true
      const operation = passkeyOperation.current
      if (operation) {
        operation.cancelled = true
        if (operation.phase !== 'verify') operation.controller.abort()
        void cancelPasskeyCeremony()
      }
      ++generation.current
      advanceSessionEpoch()
      resetBoot()
      setStatus('locked')
      setError('登录已失效，请重新输入密码。')
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCK_KEY && event.newValue === '1') void lock()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    window.addEventListener('storage', onStorage)
    window.addEventListener(PASSKEYS_CHANGED, onFocus)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkSession()
    }, 60_000)
    return () => {
      ++generation.current
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onFocus)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(PASSKEYS_CHANGED, onFocus)
    }
  }, [checkSession, lock])

  useEffect(() => {
    if (status !== 'authenticated') return
    const timer = setTimeout(
      () => {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      },
      Math.max(0, expiresAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [expiresAt, status])

  if (status === 'authenticated') return children(() => void lock())
  return (
    <LoginView
      status={status}
      error={error}
      busy={busy}
      onLogin={login}
      onRetry={() => void checkSession()}
      passkeyAvailable={passkeyAvailable && supportsPasskeys()}
      passkeyBusy={passkeyBusy}
      passkeyNote={passkeyNote}
      onPasskey={() => void loginPasskey()}
      onUsePassword={usePassword}
    />
  )
}
