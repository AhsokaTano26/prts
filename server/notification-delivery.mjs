import nodemailer from 'nodemailer'
import { qqReminderPayload } from '../src/lib/reminders.ts'

async function boundedJson(response) {
  if (!response.body) throw new Error('empty response')
  const reader = response.body.getReader()
  let content = ''
  let bytes = 0
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 16_384) throw new Error('response too large')
      content += decoder.decode(value, { stream: true })
    }
    return JSON.parse(content + decoder.decode())
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export async function sendWebhook(
  config,
  event,
  { fetchImpl = fetch, now = Date.now(), signal } = {},
) {
  const payload = qqReminderPayload(event, { now, timeZone: config.timeZone })
  const response = await fetchImpl(config.webhook.url, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'X-PRTS-Event-ID': event.id },
    body: JSON.stringify(payload),
    signal,
  })
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new Error('Webhook 未确认转发成功。')
  }
  const result = await boundedJson(response)
  if (result?.status !== 'forwarded') throw new Error('Webhook 未确认转发成功。')
}

export async function sendSmtp(config, message, signal) {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    requireTLS: config.security === 'starttls',
    ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  const abort = () => transporter.close()
  signal?.throwIfAborted()
  signal?.addEventListener('abort', abort, { once: true })
  let timeout
  try {
    const expired = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        transporter.close()
        reject(new Error('SMTP 响应超时。'))
      }, 30_000)
      timeout.unref?.()
    })
    return await Promise.race([
      transporter.sendMail({ ...message, disableFileAccess: true, disableUrlAccess: true }),
      expired,
    ])
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
    transporter.close()
  }
}
