import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bell } from 'lucide-react'
import { apiFetch } from '../lib/api'
import {
  NOTIFICATIONS_CHANGED,
  notificationPermission,
  type NotificationConfig,
  type ReminderDelivery,
} from '../lib/notifications'
import { SectionTitle } from './UI'
import PrtsSelect from './PrtsSelect'
import '../styles/notifications.css'

async function read(path: string, init?: RequestInit) {
  const response = await apiFetch(path, { ...init, signal: AbortSignal.timeout(35_000) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '通知服务暂不可用。')
  return result
}
export default function NotificationSettings() {
  const [config, setConfig] = useState<NotificationConfig | null>(null)
  const [days, setDays] = useState('')
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [permission, setPermission] = useState(notificationPermission)
  const [deliveries, setDeliveries] = useState<ReminderDelivery[]>([])
  const alive = useRef(true)
  async function logs() {
    try {
      const result = await read('/api/notifications/deliveries')
      if (alive.current) setDeliveries(result.deliveries)
    } catch {
      /* main config surfaces connection failure */
    }
  }
  function accept(value: NotificationConfig) {
    setConfig({
      ...value,
      webhook: { ...value.webhook, url: '', clearUrl: false },
      smtp: { ...value.smtp, password: '', clearPassword: false },
    })
    setDays(value.leadDays.join(','))
    setDirty(false)
  }
  async function load() {
    setBusy(true)
    setError('')
    try {
      const result = await read('/api/settings/notifications')
      if (alive.current) accept(result)
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '通知设置读取失败。')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  useEffect(() => {
    alive.current = true
    void load()
    void logs()
    return () => {
      alive.current = false
    }
  }, [])
  function change(value: NotificationConfig) {
    setConfig(value)
    setDirty(true)
    setNotice('')
    setError('')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!config || busy) return
    const values = days.trim() ? days.split(/[,，\s]+/).filter(Boolean) : []
    if (values.some((value) => !/^\d+$/.test(value))) {
      setError('提前天数请填写整数，并用逗号分隔。')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await read('/api/settings/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, leadDays: values.map(Number) }),
      })
      if (!alive.current) return
      accept(result)
      setNotice('通知配置已保存。')
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
      void logs()
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '通知配置保存失败。')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  async function test(channel: 'webhook' | 'smtp') {
    if (dirty || busy) return
    setBusy(true)
    setNotice('')
    setError('')
    try {
      await read('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      })
      if (alive.current) setNotice(`${channel === 'smtp' ? '邮件' : 'Webhook'}测试通知已发送。`)
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '测试发送失败。')
    } finally {
      if (alive.current) {
        setBusy(false)
        void logs()
      }
    }
  }
  async function requestPermission() {
    if (typeof Notification === 'undefined') return
    try {
      setPermission(await Notification.requestPermission())
    } catch {
      setError('无法请求系统通知权限，网页提醒仍可使用。')
    }
  }
  async function retry(row: ReminderDelivery) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await read('/api/notifications/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      })
      if (alive.current) {
        setNotice('已加入重试队列。')
        void logs()
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '重试失败。')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <section className="panel settings-section notification-settings" aria-label="任务通知设置">
      <SectionTitle title="任务通知" english="DEADLINE REMINDERS" />
      <p className="field-hint">
        在截止前提醒博士。网页提醒仅在工作台打开时运行；Webhook 与邮件由 VPS 持续调度。
      </p>
      {!config && busy && <p role="status">正在读取通知设置…</p>}
      {config && (
        <form onSubmit={(event) => void save(event)}>
          <fieldset disabled={busy} className="notification-fieldset">
            <label className="notification-toggle">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(event) => change({ ...config, enabled: event.target.checked })}
              />
              启用任务提醒
            </label>
            <div className="form-row">
              <div>
                <label className="form-label" htmlFor="reminder-days">
                  提前天数
                </label>
                <input
                  id="reminder-days"
                  className="field"
                  value={days}
                  maxLength={50}
                  placeholder="7,3,1"
                  onChange={(event) => {
                    setDays(event.target.value)
                    setDirty(true)
                    setNotice('')
                  }}
                />
              </div>
              <div>
                <label className="form-label" htmlFor="reminder-minutes">
                  临近截止提前分钟
                </label>
                <input
                  id="reminder-minutes"
                  className="field"
                  type="number"
                  min={0}
                  max={1440}
                  value={config.leadMinutes}
                  onChange={(event) =>
                    change({ ...config, leadMinutes: Number(event.target.value) })
                  }
                />
              </div>
            </div>
            <p className="field-hint">
              天数可多选，用逗号分隔，最多 10 档。分钟填 0 可关闭当天的分钟提醒。
            </p>
            <label className="form-label" htmlFor="reminder-timezone">
              提醒时区
            </label>
            <input
              id="reminder-timezone"
              className="field"
              value={config.timeZone}
              onChange={(event) => change({ ...config, timeZone: event.target.value })}
            />
            <p className="field-hint">
              例如 Asia/Shanghai。只有日期的旧任务按该时区当天 23:59
              截止；明确时刻的任务按实际时间提醒。
            </p>
            <div className="notification-channel">
              <label className="notification-toggle">
                <input
                  type="checkbox"
                  checked={config.browserEnabled}
                  onChange={(event) => change({ ...config, browserEnabled: event.target.checked })}
                />
                启用网页提醒
              </label>
              <p className="field-hint">
                页面内提醒无需权限。允许系统通知后，浏览器还可显示系统横幅；网页关闭后不再提醒。
              </p>
              <button
                type="button"
                className="button button-ghost"
                disabled={
                  permission === 'unsupported' ||
                  permission === 'denied' ||
                  permission === 'granted'
                }
                onClick={() => void requestPermission()}
              >
                <Bell size={14} />
                {permission === 'granted'
                  ? '系统通知已允许'
                  : permission === 'denied'
                    ? '系统通知被浏览器禁用'
                    : permission === 'unsupported'
                      ? '当前浏览器不支持系统通知'
                      : '开启此浏览器系统通知'}
              </button>
            </div>
            <div className="notification-channel">
              <label className="notification-toggle">
                <input
                  type="checkbox"
                  checked={config.webhook.enabled}
                  onChange={(event) =>
                    change({
                      ...config,
                      webhook: { ...config.webhook, enabled: event.target.checked },
                    })
                  }
                />
                启用 Webhook
              </label>
              <label className="form-label" htmlFor="notification-webhook">
                Webhook 地址
              </label>
              <input
                id="notification-webhook"
                className="field"
                type="url"
                value={config.webhook.url || ''}
                autoComplete="off"
                placeholder={
                  config.webhook.hasUrl
                    ? `已保存至 ${config.webhook.displayHost}，留空保留`
                    : 'https://你的服务/webhook/general'
                }
                onChange={(event) =>
                  change({ ...config, webhook: { ...config.webhook, url: event.target.value } })
                }
              />
              <p className="field-hint">
                使用通用 QQ Webhook JSON 协议；接收端成功转发须返回 {`{"status":"forwarded"}`}
                。目标群在接收服务中配置。
              </p>
              {config.webhook.hasUrl && (
                <label className="notification-toggle">
                  <input
                    type="checkbox"
                    checked={!!config.webhook.clearUrl}
                    onChange={(event) =>
                      change({
                        ...config,
                        webhook: {
                          ...config.webhook,
                          clearUrl: event.target.checked,
                          enabled: event.target.checked ? false : config.webhook.enabled,
                        },
                      })
                    }
                  />
                  清除已保存的 Webhook 地址
                </label>
              )}
              <button
                type="button"
                className="button button-ghost"
                disabled={dirty || !config.webhook.enabled || !config.webhook.hasUrl}
                onClick={() => void test('webhook')}
              >
                发送 Webhook 测试
              </button>
            </div>
            <div className="notification-channel">
              <label className="notification-toggle">
                <input
                  type="checkbox"
                  checked={config.smtp.enabled}
                  onChange={(event) =>
                    change({ ...config, smtp: { ...config.smtp, enabled: event.target.checked } })
                  }
                />
                启用 SMTP 邮件
              </label>
              <label className="form-label" htmlFor="notification-smtp-host">
                SMTP 主机
              </label>
              <input
                id="notification-smtp-host"
                className="field"
                value={config.smtp.host}
                placeholder="smtp.example.com"
                onChange={(event) =>
                  change({ ...config, smtp: { ...config.smtp, host: event.target.value } })
                }
              />
              <div className="form-row">
                <div>
                  <label className="form-label" htmlFor="notification-smtp-port">
                    SMTP 端口
                  </label>
                  <input
                    id="notification-smtp-port"
                    className="field"
                    type="number"
                    min={1}
                    max={65535}
                    value={config.smtp.port}
                    onChange={(event) =>
                      change({
                        ...config,
                        smtp: { ...config.smtp, port: Number(event.target.value) },
                      })
                    }
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="notification-smtp-security">
                    传输加密
                  </label>
                  <PrtsSelect
                    id="notification-smtp-security"
                    aria-label="传输加密"
                    value={config.smtp.security}
                    onValueChange={(value) =>
                      change({
                        ...config,
                        smtp: { ...config.smtp, security: value as 'tls' | 'starttls' },
                      })
                    }
                    options={[
                      { value: 'tls', label: 'TLS（通常为 465）' },
                      { value: 'starttls', label: 'STARTTLS（通常为 587）' },
                    ]}
                  />
                </div>
              </div>
              <label className="form-label" htmlFor="notification-smtp-user">
                SMTP 账号
              </label>
              <input
                id="notification-smtp-user"
                className="field"
                value={config.smtp.user}
                autoComplete="off"
                onChange={(event) =>
                  change({ ...config, smtp: { ...config.smtp, user: event.target.value } })
                }
              />
              <label className="form-label" htmlFor="notification-smtp-password">
                SMTP 密码或授权码
              </label>
              <input
                id="notification-smtp-password"
                className="field"
                type="password"
                value={config.smtp.password || ''}
                autoComplete="new-password"
                placeholder={config.smtp.hasPassword ? '已保存，留空保留' : '邮箱密码或专用授权码'}
                onChange={(event) =>
                  change({ ...config, smtp: { ...config.smtp, password: event.target.value } })
                }
              />
              {config.smtp.hasPassword && (
                <label className="notification-toggle">
                  <input
                    type="checkbox"
                    checked={!!config.smtp.clearPassword}
                    onChange={(event) =>
                      change({
                        ...config,
                        smtp: {
                          ...config.smtp,
                          clearPassword: event.target.checked,
                          enabled: event.target.checked ? false : config.smtp.enabled,
                        },
                      })
                    }
                  />
                  清除已保存的 SMTP 密码
                </label>
              )}
              <label className="form-label" htmlFor="notification-mail-from">
                发件邮箱
              </label>
              <input
                id="notification-mail-from"
                className="field"
                value={config.smtp.from}
                type="email"
                onChange={(event) =>
                  change({ ...config, smtp: { ...config.smtp, from: event.target.value } })
                }
              />
              <label className="form-label" htmlFor="notification-mail-to">
                收件邮箱
              </label>
              <input
                id="notification-mail-to"
                className="field"
                value={config.smtp.to}
                placeholder="doctor@example.com，可用逗号分隔多个地址"
                onChange={(event) =>
                  change({ ...config, smtp: { ...config.smtp, to: event.target.value } })
                }
              />
              <p className="field-hint">
                最多 10 个收件人，逐人发送；测试仅发送给首位收件人。密码仅保存在服务器
                SQLite，留空保留；证书验证始终开启。
              </p>
              <button
                type="button"
                className="button button-ghost"
                disabled={dirty || !config.smtp.enabled}
                onClick={() => void test('smtp')}
              >
                发送邮件测试
              </button>
            </div>
            <div className="notification-actions">
              <button className="button button-primary" type="submit">
                {busy ? '正在处理…' : '保存通知配置'}
              </button>
              <button className="button button-ghost" type="button" onClick={() => void load()}>
                重新加载通知配置
              </button>
            </div>
            {dirty && <p className="field-hint">有尚未保存的通知配置；保存后才能测试发送。</p>}
          </fieldset>
        </form>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
          {!config && (
            <button className="button button-ghost" onClick={() => void load()}>
              重试读取通知配置
            </button>
          )}
        </p>
      )}
      {notice && (
        <p className="notification-notice" role="status">
          {notice}
        </p>
      )}
      {!!deliveries.length && (
        <details className="notification-history">
          <summary>最近发送记录 · {deliveries.length} 条</summary>
          <ul>
            {deliveries.map((row, index) => (
              <li key={index}>
                <strong>{row.title}</strong>
                <span>
                  {row.channel === 'smtp' ? '邮件' : 'Webhook'} ·{' '}
                  {{
                    sent: '已发送',
                    pending: '等待重试',
                    sending: '正在发送',
                    failed: '发送失败',
                    cancelled: '已取消',
                  }[row.status] || row.status}{' '}
                  · {row.attempts} 次
                </span>
                {row.error && <small>{row.error}</small>}
                {row.status === 'failed' && (
                  <button
                    type="button"
                    className="button button-ghost"
                    disabled={busy || dirty}
                    onClick={() => void retry(row)}
                  >
                    重试此通知
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button className="button button-ghost" onClick={() => void logs()}>
            刷新发送记录
          </button>
        </details>
      )}
    </section>
  )
}
