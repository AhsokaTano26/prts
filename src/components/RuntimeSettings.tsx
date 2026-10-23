import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LockKeyhole, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { apiFetch, SESSION_EXPIRED_EVENT } from '../lib/api'
import type { ApiHealth } from './AssistantView'
import { SectionTitle } from './UI'
import '../styles/runtime-settings.css'

interface AIConfiguration {
  baseUrl: string
  model: string
  hasApiKey: boolean
  configured: boolean
  revision: number
}

class SettingsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function readResponse(response: Response) {
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new SettingsError(data?.error || '设置未能保存，请稍后重试。', response.status)
  if (!data || typeof data !== 'object') throw new Error('设置服务响应异常，请重新加载。')
  return data
}

function configuration(data: unknown): AIConfiguration {
  const value = data as AIConfiguration
  if (
    typeof value?.baseUrl !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.hasApiKey !== 'boolean' ||
    typeof value.configured !== 'boolean' ||
    !Number.isSafeInteger(value.revision)
  )
    throw new Error('AI 配置响应异常，请重新加载。')
  return value
}

export function AIConnectionSettings({
  health,
  onRefresh,
}: {
  health: ApiHealth
  onRefresh: () => Promise<void>
}) {
  const [saved, setSaved] = useState<AIConfiguration | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState(false)
  const request = useRef<AbortController | null>(null)
  const inFlight = useRef(false)

  function receive(value: AIConfiguration) {
    setSaved(value)
    setBaseUrl(value.baseUrl)
    setModel(value.model)
    setApiKey('')
    setClearApiKey(false)
  }

  async function reload() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const response = await apiFetch('/api/settings/ai', {
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })
      const data = configuration(await readResponse(response))
      if (controller.signal.aborted) return
      receive(data)
      setConflict(false)
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof SettingsError ? cause.message : '无法加载 AI 配置，请重试。')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    return () => request.current?.abort()
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!saved || inFlight.current || conflict) return
    inFlight.current = true
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const data = configuration(
        await readResponse(
          await apiFetch('/api/settings/ai', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            signal: AbortSignal.timeout(30_000),
            body: JSON.stringify({
              baseUrl: baseUrl.trim(),
              model: model.trim(),
              revision: saved.revision,
              ...(clearApiKey ? { clearApiKey: true } : apiKey.trim() ? { apiKey } : {}),
            }),
          }),
        ),
      )
      receive(data)
      setNotice('AI 配置已保存，下次对话立即生效。')
      await onRefresh().catch(() => undefined)
    } catch (cause) {
      if (cause instanceof SettingsError && cause.status === 409) setConflict(true)
      setError(
        cause instanceof SettingsError ? cause.message : '无法保存 AI 配置，请检查连接后重试。',
      )
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const configured = health.configured
  return (
    <section className="panel settings-section runtime-settings">
      <SectionTitle title="AI 服务连接" english="AI CONNECTION" />
      <div className={`api-state ${configured ? 'connected' : ''}`}>
        <span className="status-led" />
        <div>
          <strong>{configured ? 'AI 服务已配置' : '等待配置 AI 服务'}</strong>
          <p>{configured ? health.model : '本地指令模式随时可用'}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          disabled={loading || saving}
          aria-label="刷新 AI 连接状态"
          onClick={() => {
            void onRefresh().catch(() => setError('无法刷新连接状态，请稍后重试。'))
          }}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <form onSubmit={submit} aria-busy={loading || saving}>
        <fieldset disabled={loading || saving || !saved}>
          <label className="form-label" htmlFor="ai-base-url">
            AI 服务地址
          </label>
          <input
            id="ai-base-url"
            className="field"
            type="url"
            value={baseUrl}
            required
            maxLength={2048}
            spellCheck={false}
            autoComplete="off"
            placeholder="https://api.openai.com/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <p className="field-hint">填写兼容服务的 API 根地址，例如 https://api.openai.com/v1。</p>
          <label className="form-label" htmlFor="ai-model">
            AI 模型
          </label>
          <input
            id="ai-model"
            className="field"
            value={model}
            required
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setModel(event.target.value)}
          />
          <label className="form-label" htmlFor="ai-api-key">
            API 密钥
          </label>
          <input
            id="ai-api-key"
            className="field"
            type="password"
            value={apiKey}
            maxLength={8192}
            autoComplete="new-password"
            spellCheck={false}
            disabled={clearApiKey}
            aria-describedby="ai-key-hint"
            placeholder={saved?.hasApiKey ? '留空保留已保存的密钥' : '输入服务密钥'}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <p id="ai-key-hint" className="field-hint">
            {saved?.hasApiKey ? '密钥已保存；留空保留现有密钥。' : '尚未保存 API 密钥。'}
          </p>
          {saved?.hasApiKey && (
            <label className="runtime-clear-key">
              <input
                type="checkbox"
                checked={clearApiKey}
                onChange={(event) => {
                  setClearApiKey(event.target.checked)
                  if (event.target.checked) setApiKey('')
                }}
              />
              清除已保存的 API 密钥
            </label>
          )}
        </fieldset>
        <div className="privacy-note">
          <ShieldCheck size={18} />
          <p>
            配置只保存在服务器数据库，密钥不回显。AI
            接收对话、性格、相关语料与按需读取的工作台数据。
          </p>
        </div>
        {loading && (
          <p className="runtime-feedback" role="status">
            正在加载 AI 配置…
          </p>
        )}
        {error && (
          <p className="runtime-feedback error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="runtime-feedback success" role="status">
            {notice}
          </p>
        )}
        <div className="runtime-actions">
          {(conflict || (!saved && !loading)) && (
            <button
              type="button"
              className="button button-ghost"
              onClick={() => void reload()}
              disabled={loading || saving}
            >
              <RefreshCw size={15} />
              重新加载 AI 配置
            </button>
          )}
          <button
            type="submit"
            className="button button-primary"
            disabled={loading || saving || !saved || conflict}
          >
            <Save size={15} />
            {saving ? '正在保存…' : '保存 AI 配置'}
          </button>
        </div>
      </form>
    </section>
  )
}

export function PasswordSettings() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    if (newPassword !== confirmation) {
      setError('两次输入的新密码不一致。')
      return
    }
    const size = new TextEncoder().encode(newPassword).length
    if (!newPassword.trim() || size < 8 || size > 1024) {
      setError('新密码长度应为 8–1024 字节。')
      return
    }
    inFlight.current = true
    setSaving(true)
    try {
      const result = await readResponse(
        await apiFetch('/api/auth/password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({ currentPassword, newPassword }),
        }),
      )
      if (result.authenticated !== false) throw new Error('修改密码响应异常。')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    } catch (cause) {
      setError(
        cause instanceof SettingsError ? cause.message : '无法确认修改结果，请重新登录后检查。',
      )
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <section className="panel settings-section runtime-settings password-settings">
      <SectionTitle title="访问密码" english="ACCESS SECURITY" />
      <p className="settings-copy runtime-intro">
        修改密码后，所有设备的登录会话都会退出。请使用新密码重新登录。
      </p>
      <form onSubmit={submit} aria-busy={saving}>
        <fieldset disabled={saving}>
          <label className="form-label" htmlFor="current-password">
            当前密码
          </label>
          <input
            id="current-password"
            className="field"
            type="password"
            value={currentPassword}
            required
            maxLength={1024}
            autoComplete="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <div className="runtime-password-row">
            <div>
              <label className="form-label" htmlFor="new-password">
                新密码
              </label>
              <input
                id="new-password"
                className="field"
                type="password"
                value={newPassword}
                required
                maxLength={1024}
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="confirm-password">
                确认新密码
              </label>
              <input
                id="confirm-password"
                className="field"
                type="password"
                value={confirmation}
                required
                maxLength={1024}
                autoComplete="new-password"
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
          </div>
          <p className="field-hint">8–1024 字节；密码以加盐哈希保存，无法读取原文。</p>
        </fieldset>
        {error && (
          <p className="runtime-feedback error" role="alert">
            {error}
          </p>
        )}
        <div className="runtime-actions">
          <button type="submit" className="button button-primary" disabled={saving}>
            <LockKeyhole size={15} />
            {saving ? '正在修改…' : '修改密码并重新登录'}
          </button>
        </div>
      </form>
    </section>
  )
}
