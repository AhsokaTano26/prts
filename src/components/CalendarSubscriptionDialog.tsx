import { useEffect, useId, useRef, useState } from 'react'
import { Copy, ExternalLink, LoaderCircle, Rss } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { Modal } from './UI'
import '../styles/calendar-subscription.css'

type Subscription = { enabled: boolean; token: string | null; revision: number }
const endpoint = '/api/calendar/subscription'
async function readResponse(response: Response): Promise<Subscription> {
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || '订阅操作失败，请重试。')
  if (
    typeof value.enabled !== 'boolean' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    (value.enabled
      ? typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token)
      : value.token !== null)
  )
    throw new Error('订阅状态无效，请重新加载。')
  return value
}
function subscriptionURL(value: Subscription | null) {
  return value?.enabled && value.token
    ? new URL(
        `/api/calendar/feed.ics?token=${encodeURIComponent(value.token)}`,
        window.location.origin,
      ).href
    : ''
}

export default function CalendarSubscriptionDialog({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [selectPending, setSelectPending] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const working = useRef(false)
  const readVersion = useRef(0)
  const id = useId()
  useEffect(() => {
    const controller = new AbortController()
    void reload(controller.signal)
    const refresh = () => {
      if (!working.current && document.visibilityState === 'visible') void reload(controller.signal)
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort()
      readVersion.current++
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  const url = subscriptionURL(state)
  useEffect(() => {
    if (!selectPending || !url) return
    input.current?.focus()
    input.current?.select()
    setSelectPending(false)
  }, [selectPending, url])
  const webcal = url.replace(/^https?:/, 'webcal:')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  async function reload(signal?: AbortSignal) {
    if (working.current) return
    const version = ++readVersion.current
    setLoading(true)
    setState(null)
    setError('')
    setStatus('')
    try {
      const value = await readResponse(await apiFetch(endpoint, { signal }))
      if (!signal?.aborted && version === readVersion.current) setState(value)
    } catch (cause) {
      if (!signal?.aborted && version === readVersion.current)
        setError(cause instanceof Error ? cause.message : '无法读取订阅，请重试。')
    } finally {
      if (!signal?.aborted && version === readVersion.current) setLoading(false)
    }
  }
  async function update(action: 'enable' | 'reset' | 'disable') {
    if (!state || working.current || loading) return
    working.current = true
    readVersion.current++
    setLoading(false)
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const value = await readResponse(
        await apiFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, revision: state.revision }),
        }),
      )
      setState(value)
      setStatus(
        action === 'reset'
          ? '地址已重置，旧地址已失效，请在苹果日历中重新订阅。'
          : action === 'disable'
            ? '订阅已停用，旧地址已失效。'
            : '订阅已启用，可以复制地址添加到苹果日历。',
      )
    } catch (cause) {
      // A failed response can arrive after a committed mutation. Reconcile before showing a link.
      setState(null)
      try {
        setState(await readResponse(await apiFetch(endpoint)))
      } catch {
        /* Retry remains available. */
      }
      setError(cause instanceof Error ? cause.message : '订阅操作失败，请重新加载。')
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  async function useAddress(action: 'copy' | 'open') {
    if (!state || working.current || loading) return
    working.current = true
    readVersion.current++
    setLoading(false)
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const latest = await readResponse(await apiFetch(endpoint))
      setState(latest)
      const address = subscriptionURL(latest)
      if (!address) {
        setStatus('订阅已在其他页面停用，旧地址已失效。')
        return
      }
      if (action === 'open') {
        if (latest.token !== state.token)
          setStatus('地址已在其他页面更新，请再次点击「在苹果日历订阅」。')
        else window.location.assign(address.replace(/^https?:/, 'webcal:'))
      } else {
        try {
          await navigator.clipboard.writeText(address)
          setStatus('订阅地址已复制。')
        } catch {
          setSelectPending(true)
          setStatus('自动复制不可用，已选中地址，请手动复制。')
        }
      }
    } catch (cause) {
      setState(null)
      setError(cause instanceof Error ? cause.message : '无法确认订阅地址，请重新加载。')
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  return (
    <Modal
      title="订阅日历"
      className="calendar-subscription-dialog"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="calendar-subscription-body">
        <p className="form-intro mono">
          <Rss size={14} aria-hidden="true" /> CALENDAR / SUBSCRIBE
        </p>
        <p className="modal-copy">
          在苹果日历查看全部日程和未完成任务的截止日期。内容只读，修改仍在工作台完成。
        </p>
        <p className="field-hint">订阅由日历客户端定期刷新；任务完成后会在下一次刷新时移出。</p>
        {loading && (
          <p className="subscription-loading" role="status">
            <LoaderCircle size={16} className="auth-spinner" /> 正在读取订阅…
          </p>
        )}
        {!loading && !state && (
          <button className="button button-ghost" onClick={() => void reload()}>
            重新加载
          </button>
        )}
        {state && !state.enabled && (
          <div className="subscription-empty">
            <strong>订阅尚未启用</strong>
            <p>生成一个专属地址，添加到苹果日历后持续获取更新。</p>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void update('enable')}
            >
              {busy ? '正在生成…' : '生成订阅地址'}
            </button>
          </div>
        )}
        {url && (
          <div className="subscription-address">
            <label className="form-label" htmlFor={id}>
              订阅地址
            </label>
            <input
              ref={input}
              id={id}
              className="field mono"
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="subscription-link-actions">
              <button
                className="button button-primary"
                disabled={busy || loading}
                onClick={() => void useAddress('copy')}
              >
                <Copy size={15} />
                复制地址
              </button>
              {!busy && (
                <a
                  className="button button-ghost"
                  href={webcal}
                  rel="noreferrer"
                  onClick={(event) => {
                    event.preventDefault()
                    void useAddress('open')
                  }}
                >
                  <ExternalLink size={15} />
                  在苹果日历订阅
                </a>
              )}
            </div>
            <p className="field-hint">
              持有此链接的人可以读取订阅内容，请妥善保管。重置地址或停用后，旧订阅将停止更新。
            </p>
            <div className="subscription-manage-actions">
              <button
                className="button button-ghost"
                disabled={busy}
                onClick={() => void update('reset')}
              >
                重置地址
              </button>
              <button
                className="button button-ghost danger"
                disabled={busy}
                onClick={() => void update('disable')}
              >
                停用订阅
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {!error && status && (
          <p className="subscription-status" role="status">
            {status}
          </p>
        )}
        <div className="subscription-help">
          <p>
            <strong>iPhone / iPad</strong>：日历 → 添加日历 → 添加订阅日历，粘贴地址。
          </p>
          <p>
            <strong>Mac</strong>：文件 → 新建日历订阅，粘贴地址。
          </p>
          <p>
            {local
              ? '当前为本机地址，仅适用于这台电脑。要在手机或 iCloud 订阅，请通过可访问的 HTTPS 工作台域名生成地址。'
              : window.location.protocol !== 'https:'
                ? '当前地址使用 HTTP。正式订阅请通过 HTTPS 工作台域名打开此页面，再复制地址。'
                : '在位置或账户中选择 iCloud，可在同一 Apple 账户的设备上查看。'}
          </p>
        </div>
      </div>
      <div className="modal-actions">
        <div className="action-spacer" />
        <button className="button button-ghost" disabled={busy} onClick={onClose}>
          完成
        </button>
      </div>
    </Modal>
  )
}
