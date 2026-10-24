import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Fingerprint, KeyRound, Plus, Trash2, X } from 'lucide-react'
import { SESSION_EXPIRED_EVENT } from '../lib/api'
import {
  PASSKEYS_CHANGED,
  passkeyRequest,
  registerPasskey,
  cancelPasskeyCeremony,
  warmPasskeys,
  supportsPasskeys,
  passkeyError,
  type PasskeySettings as Settings,
} from '../lib/passkeys'
import { SectionTitle } from './UI'
import '../styles/passkeys.css'

export default function PasskeySettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [name, setName] = useState('本设备'),
    [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false),
    [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [confirm, setConfirm] = useState('')
  const alive = useRef(true),
    inFlight = useRef(false),
    controller = useRef<AbortController | null>(null)
  async function load() {
    try {
      const result = await passkeyRequest('/api/auth/passkeys')
      if (alive.current) setSettings(result)
    } catch (cause) {
      if (alive.current) setError(passkeyError(cause))
    }
  }
  useEffect(() => {
    alive.current = true
    warmPasskeys()
    void load()
    return () => {
      alive.current = false
      controller.current?.abort()
      if (controller.current) void cancelPasskeyCeremony()
    }
  }, [])
  async function add(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || !password || !settings?.supported) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    setConfirm('')
    const operation = new AbortController()
    controller.current = operation
    try {
      const options = await passkeyRequest(
        '/api/auth/passkeys/registration/options',
        { currentPassword: password, name },
        { signal: operation.signal },
      )
      const credential = await registerPasskey(options, operation.signal)
      operation.signal.throwIfAborted()
      if (!alive.current) return
      setVerifying(true)
      await passkeyRequest('/api/auth/passkeys/registration/verify', credential)
      if (!alive.current) return
      setPassword('')
      setNotice('Passkey 已添加。下次进入登录页会自动尝试验证。')
      await load()
      window.dispatchEvent(new Event(PASSKEYS_CHANGED))
    } catch (cause) {
      if (alive.current) setError(passkeyError(cause))
    } finally {
      inFlight.current = false
      controller.current = null
      if (alive.current) {
        setBusy(false)
        setVerifying(false)
        setPassword('')
      }
    }
  }
  async function remove(id: string) {
    if (inFlight.current || !password) return
    if (confirm !== id) {
      setConfirm(id)
      return
    }
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await passkeyRequest(
        `/api/auth/passkeys/${id}`,
        { currentPassword: password },
        { method: 'DELETE' },
      )
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      window.dispatchEvent(new Event(PASSKEYS_CHANGED))
    } catch (cause) {
      if (alive.current) setError(passkeyError(cause))
    } finally {
      inFlight.current = false
      if (alive.current) {
        setBusy(false)
        setPassword('')
        setConfirm('')
      }
    }
  }
  const enabled = settings?.supported && supportsPasskeys()
  const localAlternative =
    window.location.hostname === '127.0.0.1'
      ? `${window.location.protocol}//localhost${window.location.port ? `:${window.location.port}` : ''}/#settings`
      : null
  return (
    <section className="panel settings-section passkey-settings" aria-label="Passkey 设置">
      <SectionTitle title="Passkey" english="DEVICE ACCESS" />
      <div className="passkey-intro">
        <span className="passkey-intro-icon">
          <Fingerprint size={25} />
        </span>
        <div>
          <strong>用设备安全解锁终端</strong>
          <p>
            支持指纹、面容、设备 PIN 或安全密钥。设置后，登录页会自动尝试一次 Passkey
            验证，访问密码仍可使用。
          </p>
        </div>
      </div>
      {!settings && !error && <p role="status">正在读取 Passkey 设置…</p>}
      {settings && (
        <>
          <p className="passkey-domain mono">
            {settings.supported ? `绑定域名 / ${settings.rpID}` : '当前地址不支持 Passkey'}
          </p>
          {!enabled && (
            <div className="passkey-guidance">
              <p>{settings.reason || '当前浏览器不支持 WebAuthn，请使用支持 Passkey 的浏览器。'}</p>
              {localAlternative && <a href={localAlternative}>用 localhost 打开并重新登录 ↗</a>}
            </div>
          )}
          <ul className="passkey-list">
            {settings.credentials.map((key) => (
              <li key={key.id}>
                <KeyRound size={18} />
                <div>
                  <strong>{key.name}</strong>
                  <span>
                    {key.rpID} · {key.backedUp ? '已同步' : '设备凭据'}
                  </span>
                  <small>
                    添加于 {new Date(key.createdAt).toLocaleDateString('zh-CN')}
                    {key.lastUsedAt
                      ? ` · 最近使用 ${new Date(key.lastUsedAt).toLocaleString('zh-CN')}`
                      : ''}
                  </small>
                </div>
                <button
                  type="button"
                  className={`icon-button${confirm === key.id ? ' danger' : ''}`}
                  disabled={busy || !password}
                  aria-label={`${confirm === key.id ? '确认移除' : '移除'} Passkey：${key.name}`}
                  onClick={() => void remove(key.id)}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
          {!settings.credentials.length && (
            <p className="passkey-empty">尚未添加 Passkey。添加后可以直接使用设备验证登录。</p>
          )}
          <form onSubmit={(event) => void add(event)}>
            <fieldset disabled={busy} className="passkey-fields">
              <label className="form-label" htmlFor="passkey-name">
                Passkey 名称
              </label>
              <input
                id="passkey-name"
                className="field"
                maxLength={80}
                value={name}
                required
                onChange={(event) => setName(event.target.value)}
              />
              <label className="form-label" htmlFor="passkey-password">
                管理 Passkey 的当前密码
              </label>
              <input
                id="passkey-password"
                className="field"
                type="password"
                autoComplete="current-password"
                value={password}
                maxLength={1024}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="field-hint">
                添加或移除时验证当前访问密码。移除会撤销所有设备的登录；密码仍可用于恢复访问。最多保存
                10 个 Passkey。
              </p>
              {confirm && (
                <p className="passkey-remove-note">
                  再次点击对应移除按钮确认。当前设备也会退出登录。
                </p>
              )}
              <button
                className="button button-primary"
                type="submit"
                disabled={
                  !enabled || !name.trim() || !password || settings.credentials.length >= 10
                }
              >
                <Plus size={15} />
                {busy ? (verifying ? '正在保存 Passkey…' : '等待设备创建…') : '添加 Passkey'}
              </button>
            </fieldset>
          </form>
          {busy && !verifying && (
            <button
              className="button button-ghost passkey-cancel"
              type="button"
              onClick={() => controller.current?.abort()}
            >
              <X size={14} />
              取消创建
            </button>
          )}
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
          {!settings && (
            <button className="button button-ghost" onClick={() => void load()}>
              重试读取 Passkey
            </button>
          )}
        </p>
      )}
      {notice && (
        <p className="passkey-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}
