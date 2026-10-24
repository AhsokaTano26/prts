import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WifiOff,
  Fingerprint,
} from 'lucide-react'
import { Logo } from './UI'
import '../styles/auth.css'

interface LoginViewProps {
  status: 'checking' | 'locked' | 'unconfigured' | 'offline'
  error: string
  busy: boolean
  onLogin: (password: string) => Promise<void>
  onRetry: () => void
  passkeyAvailable: boolean
  passkeyBusy: boolean
  passkeyNote: string
  onPasskey: () => void
  onUsePassword: () => void
}

const statusCopy = {
  checking: {
    label: 'CHECKING CONNECTION',
    title: '正在连接终端',
    description: '正在检查访问状态，请稍候。',
  },
  locked: {
    label: 'ACCESS RESTRICTED',
    title: '终端访问验证',
    description: '输入访问密码，进入你的个人工作空间。',
  },
  unconfigured: {
    label: 'CONFIGURATION UNAVAILABLE',
    title: '终端配置暂不可用',
    description: '无法读取访问配置，请检查服务器状态后重试。',
  },
  offline: {
    label: 'CONNECTION OFFLINE',
    title: '终端暂时离线',
    description: '无法连接验证服务，请检查连接后重试。',
  },
}

export default function LoginView({
  status,
  error,
  busy,
  onLogin,
  onRetry,
  passkeyAvailable,
  passkeyBusy,
  passkeyNote,
  onPasskey,
  onUsePassword,
}: LoginViewProps) {
  const [password, setPassword] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState('')
  const passwordInput = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  const mounted = useRef(false)
  const passwordId = useId()
  const hintId = useId()
  const errorId = useId()
  const headingId = useId()
  const pending = busy || submitting
  const errorMessage = error || submissionError
  const copy = statusCopy[status]

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const input = passwordInput.current
    if (status === 'locked' && !passkeyAvailable) input?.focus({ preventScroll: true })
    else {
      setPassword('')
      setRevealed(false)
      setSubmissionError('')
    }
    return () => {
      if (input) input.value = ''
    }
  }, [status, passkeyAvailable])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status !== 'locked' || pending || inFlight.current || !password.length) return
    inFlight.current = true
    setSubmitting(true)
    setSubmissionError('')
    try {
      await onLogin(password)
    } catch {
      if (mounted.current) setSubmissionError('验证未完成，请重新输入密码后重试。')
    } finally {
      inFlight.current = false
      if (mounted.current) {
        setPassword('')
        setRevealed(false)
        setSubmitting(false)
        requestAnimationFrame(() => passwordInput.current?.focus({ preventScroll: true }))
      }
    }
  }

  return (
    <main className="auth-screen" aria-labelledby={headingId}>
      <div className="auth-frame">
        <header className="auth-topbar">
          <div className="auth-wordmark">
            <Logo small />
            <span>
              PRTS<span className="auth-wordmark-slash"> / </span>
              <small>PERSONAL TERMINAL</small>
            </span>
          </div>
          <span className="auth-topbar-index">
            ACCESS CONTROL <span>01</span>
          </span>
        </header>

        <div className="auth-layout">
          <section className="auth-identity" aria-label="PRTS 个人终端">
            <p className="auth-eyebrow">RHODES ISLAND / PERSONAL TERMINAL</p>
            <div className="auth-emblem" aria-hidden="true">
              <svg className="auth-emblem-lines" viewBox="0 0 360 360" fill="none">
                <circle cx="180" cy="180" r="148" />
                <circle cx="180" cy="180" r="114" strokeDasharray="2 8" />
                <path
                  d="M180 18v324M18 180h324M76 76l208 208M76 284 284 76"
                  className="auth-emblem-axis"
                />
                <path d="m180 32 148 148-148 148L32 180Z" />
                <path d="m180 32 78 148-78 148-78-148Z" />
                <path
                  d="M32 180h296M180 32 32 180l148 78 148-78L180 32ZM180 328 32 180l148-78 148 78-148 148Z"
                  className="auth-emblem-detail"
                />
                <path
                  d="M18 60V18h42M300 18h42v42M342 300v42h-42M60 342H18v-42"
                  className="auth-emblem-corners"
                />
                <circle cx="180" cy="32" r="3" className="auth-emblem-point" />
                <circle cx="328" cy="180" r="3" className="auth-emblem-point" />
                <circle cx="180" cy="328" r="3" className="auth-emblem-point" />
                <circle cx="32" cy="180" r="3" className="auth-emblem-point" />
              </svg>
              <div className="auth-emblem-core">
                <Logo />
              </div>
              <span className="auth-emblem-coordinate">35° / 139°</span>
            </div>
            <div className="auth-identity-copy">
              <strong className="auth-brand-title">
                PRTS<span>®</span>
              </strong>
              <p>你的思绪，于此汇集。</p>
              <span>PERSONAL RHODES ISLAND TERMINAL SYSTEM</span>
            </div>
            <div className="auth-identity-foot">
              <span />
              思想 · 任务 · 知识
              <span />
            </div>
          </section>

          <section className="auth-access" aria-labelledby={headingId}>
            <div className="auth-panel">
              <div className="auth-panel-top">
                <span>
                  <span className="auth-panel-number">01</span> IDENTITY VERIFICATION
                </span>
                <LockKeyhole size={16} aria-hidden="true" />
              </div>
              <div className="auth-panel-content" key={status}>
                <div className={`auth-state-mark auth-state-mark--${status}`} aria-hidden="true">
                  {status === 'checking' ? (
                    <LoaderCircle size={25} className="auth-spinner" />
                  ) : status === 'offline' ? (
                    <WifiOff size={25} strokeWidth={1.5} />
                  ) : status === 'unconfigured' ? (
                    <AlertCircle size={25} strokeWidth={1.5} />
                  ) : (
                    <ShieldCheck size={25} strokeWidth={1.5} />
                  )}
                </div>
                <h1 id={headingId}>{copy.title}</h1>
                <p className="auth-panel-description">
                  {status === 'locked' && passkeyAvailable
                    ? '使用设备上的 Passkey 解锁，也可以输入访问密码。'
                    : copy.description}
                </p>

                {errorMessage ? (
                  <div id={errorId} className="auth-error" role="alert">
                    <AlertCircle size={16} aria-hidden="true" />
                    <span>{errorMessage}</span>
                  </div>
                ) : null}

                {status === 'locked' ? (
                  <>
                    {passkeyAvailable && (
                      <div className="auth-passkey">
                        <button
                          className="auth-submit"
                          type="button"
                          disabled={pending}
                          onClick={onPasskey}
                        >
                          <Fingerprint size={20} />
                          {passkeyBusy ? '等待设备认证…' : '使用 Passkey 登录'}
                        </button>
                        <button
                          className="button button-ghost auth-passkey-cancel"
                          type="button"
                          disabled={busy && !passkeyBusy}
                          onClick={() => {
                            onUsePassword()
                            requestAnimationFrame(() =>
                              passwordInput.current?.focus({ preventScroll: true }),
                            )
                          }}
                        >
                          改用密码登录
                        </button>
                        {passkeyNote && (
                          <p className="auth-passkey-note" role="status">
                            {passkeyNote}
                          </p>
                        )}
                      </div>
                    )}
                    <form className="auth-form" onSubmit={submit} aria-busy={pending}>
                      <label htmlFor={passwordId}>
                        访问密码<span aria-hidden="true">PASSWORD</span>
                      </label>
                      <div className={`auth-password-field${errorMessage ? ' has-error' : ''}`}>
                        <LockKeyhole size={16} aria-hidden="true" />
                        <input
                          ref={passwordInput}
                          id={passwordId}
                          name="password"
                          aria-label="访问密码"
                          type={revealed ? 'text' : 'password'}
                          value={password}
                          onChange={(event) => {
                            setPassword(event.target.value)
                            setSubmissionError('')
                          }}
                          autoComplete="current-password"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          required
                          disabled={pending}
                          placeholder="请输入访问密码"
                          aria-invalid={Boolean(errorMessage)}
                          aria-describedby={`${hintId}${errorMessage ? ` ${errorId}` : ''}`}
                        />
                        <button
                          type="button"
                          className="auth-password-toggle"
                          aria-label={revealed ? '隐藏密码' : '显示密码'}
                          aria-pressed={revealed}
                          aria-controls={passwordId}
                          disabled={pending}
                          onClick={() => setRevealed(!revealed)}
                        >
                          {revealed ? (
                            <EyeOff size={17} aria-hidden="true" />
                          ) : (
                            <Eye size={17} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                      <p id={hintId} className="auth-field-hint">
                        首次使用随机密码时，请查看服务启动日志。
                      </p>
                      <button type="submit" className="auth-submit" disabled={pending}>
                        {pending ? (
                          <>
                            <LoaderCircle size={16} className="auth-spinner" aria-hidden="true" />
                            正在验证…
                          </>
                        ) : (
                          <>
                            验证并进入
                            <ArrowRight size={17} aria-hidden="true" />
                          </>
                        )}
                      </button>
                    </form>
                  </>
                ) : status === 'checking' ? (
                  <div className="auth-checking" role="status">
                    <span className="auth-checking-line" />
                    <span>正在检查访问状态…</span>
                    <span className="auth-checking-code">CONNECTING</span>
                  </div>
                ) : (
                  <div className="auth-recovery">
                    {status === 'unconfigured' ? (
                      <div className="auth-setup-note">
                        <span>访问配置异常</span>
                        <p>请检查服务器数据库和服务启动日志，恢复后重新检查连接。</p>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="auth-submit auth-submit--secondary"
                      disabled={pending}
                      onClick={onRetry}
                    >
                      {pending ? (
                        <LoaderCircle size={16} className="auth-spinner" aria-hidden="true" />
                      ) : (
                        <RefreshCw size={16} aria-hidden="true" />
                      )}
                      {status === 'unconfigured' ? '重新检查' : '重新连接'}
                    </button>
                  </div>
                )}
              </div>
              <div className="auth-panel-footer">
                <span
                  className={`auth-connection-dot${status === 'offline' ? ' is-offline' : ''}`}
                />
                <span>{copy.label}</span>
                <span className="auth-panel-corner">↗</span>
              </div>
            </div>
            <p className="auth-access-note">
              <LockKeyhole size={12} aria-hidden="true" />
              验证后即可访问个人工作空间
            </p>
          </section>
        </div>

        <footer className="auth-footer">
          <span>
            PRTS <span>//</span> ACCESS CONTROL
          </span>
          <span>
            PERSONAL WORKSPACE <span>·</span> v1.0
          </span>
        </footer>
      </div>
    </main>
  )
}
