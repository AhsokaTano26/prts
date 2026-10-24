import { isIP } from 'node:net'
import { HttpError } from './errors.mjs'

const invalid = (message) => {
  throw new HttpError(400, message)
}
const defaults = () => ({
  enabled: false,
  browserEnabled: true,
  leadDays: [1],
  leadMinutes: 10,
  timeZone: 'Asia/Shanghai',
  webhook: { enabled: false, url: '' },
  smtp: {
    enabled: false,
    host: '',
    port: 465,
    security: 'tls',
    user: '',
    password: '',
    from: '',
    to: '',
  },
})
function string(value, label, max = 512, trim = true) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value))
    invalid(`${label}格式无效。`)
  return trim ? value.trim() : value
}
function flag(value, label) {
  if (typeof value !== 'boolean') invalid(`${label}选项无效。`)
  return value
}
const email = (value) => /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value)
export function createNotificationSettings(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS prts_notification_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision INTEGER NOT NULL
  ) STRICT`)
  database
    .prepare('INSERT OR IGNORE INTO prts_notification_settings VALUES (1,?,1)')
    .run(JSON.stringify(defaults()))
  function configuration() {
    const row = database
      .prepare('SELECT data,revision FROM prts_notification_settings WHERE id=1')
      .get()
    return { ...JSON.parse(row.data), revision: row.revision }
  }
  function read() {
    const value = configuration()
    return {
      ...value,
      webhook: {
        enabled: value.webhook.enabled,
        hasUrl: Boolean(value.webhook.url),
        displayHost: value.webhook.url ? new URL(value.webhook.url).origin : '',
      },
      smtp: { ...value.smtp, password: undefined, hasPassword: Boolean(value.smtp.password) },
    }
  }
  function update(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      invalid('通知配置格式无效。')
    const current = configuration()
    if (!Number.isSafeInteger(payload.revision)) invalid('通知配置版本无效。')
    if (current.revision !== payload.revision)
      throw new HttpError(409, '通知配置已在其他页面更新，请重新加载后再保存。')
    if (
      !Array.isArray(payload.leadDays) ||
      payload.leadDays.length > 10 ||
      payload.leadDays.some((day) => !Number.isInteger(day) || day < 1 || day > 365)
    )
      invalid('提前天数应为 1 至 365 的整数，最多 10 档。')
    if (
      !Number.isInteger(payload.leadMinutes) ||
      payload.leadMinutes < 0 ||
      payload.leadMinutes > 1440
    )
      invalid('提前分钟应为 0 至 1440 的整数。')
    const timeZone = string(payload.timeZone, '时区', 100)
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format()
    } catch {
      invalid('请选择有效的 IANA 时区。')
    }
    const webhook = payload.webhook
    const smtp = payload.smtp
    if (!webhook || !smtp) invalid('请提供通知渠道配置。')
    for (const value of [webhook.clearUrl, smtp.clearPassword])
      if (value !== undefined && typeof value !== 'boolean') invalid('清除配置选项无效。')
    const incomingUrl = webhook.url === undefined ? '' : string(webhook.url, 'Webhook 地址', 4096)
    if (webhook.clearUrl && incomingUrl) invalid('替换和清除 Webhook 地址不能同时操作。')
    let url = webhook.clearUrl ? '' : incomingUrl || current.webhook.url
    if (url) {
      try {
        const parsed = new URL(url)
        if (
          !['http:', 'https:'].includes(parsed.protocol) ||
          !parsed.hostname ||
          parsed.username ||
          parsed.password ||
          parsed.hash
        )
          throw new Error()
        url = parsed.href
      } catch {
        invalid('Webhook 必须是有效的 HTTP(S) 地址，不含账号、密码或片段。')
      }
    }
    const host = string(smtp.host, 'SMTP 主机', 253)
    if (host && !isIP(host) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))
      invalid('SMTP 主机格式无效。')
    if (!Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535)
      invalid('SMTP 端口应为 1 至 65535。')
    if (!['tls', 'starttls'].includes(smtp.security)) invalid('SMTP 必须使用 TLS 或 STARTTLS。')
    const user = string(smtp.user, 'SMTP 账号')
    const password =
      smtp.password === undefined ? '' : string(smtp.password, 'SMTP 密码', 8192, false)
    if (smtp.clearPassword && password) invalid('替换和清除 SMTP 密码不能同时操作。')
    const from = string(smtp.from, '发件邮箱', 254)
    const to = string(smtp.to, '收件邮箱', 2600)
      .split(/[,，;]/)
      .map((address) => address.trim())
      .filter(Boolean)
    if ((from && !email(from)) || to.length > 10 || to.some((address) => !email(address)))
      invalid('请输入有效的邮箱地址，收件人最多 10 个，用逗号分隔。')
    const value = {
      enabled: flag(payload.enabled, '任务提醒'),
      browserEnabled: flag(payload.browserEnabled, '网页提醒'),
      leadDays: [...new Set(payload.leadDays)].sort((a, b) => b - a),
      leadMinutes: payload.leadMinutes,
      timeZone,
      webhook: { enabled: flag(webhook.enabled, 'Webhook'), url },
      smtp: {
        enabled: flag(smtp.enabled, 'SMTP'),
        host,
        port: smtp.port,
        security: smtp.security,
        user,
        password: smtp.clearPassword ? '' : password || current.smtp.password,
        from,
        to: [...new Set(to)].join(','),
      },
    }
    if (value.enabled && !value.leadDays.length && !value.leadMinutes)
      invalid('请至少设置一档提前提醒。')
    if (value.webhook.enabled && !url) invalid('启用 Webhook 前请填写地址。')
    if (value.smtp.enabled && (!host || !from || !to.length || (user && !value.smtp.password)))
      invalid('请完整填写 SMTP 主机、发件人、收件人及账号密码。')
    const result = database
      .prepare(
        'UPDATE prts_notification_settings SET data=?,revision=revision+1 WHERE id=1 AND revision=?',
      )
      .run(JSON.stringify(value), payload.revision)
    if (!result.changes) throw new HttpError(409, '通知配置已更新，请重新加载。')
    return read()
  }
  return { read, configuration, update }
}
