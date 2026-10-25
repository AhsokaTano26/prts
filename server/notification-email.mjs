import { qqReminderPayload } from '../src/lib/reminders.ts'
import { portraits } from '../src/lib/portraits.ts'
import { readFile } from 'node:fs/promises'
import { getAsset } from './resources.mjs'

const MAX_PORTRAIT_BYTES = 2 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')

export async function loadEmailPortrait(directory, id = 'amiya') {
  if (!directory || typeof id !== 'string' || !Object.hasOwn(portraits, id)) return null
  try {
    const metadata = portraits[id]
    const asset = await getAsset(directory, metadata.src)
    if (!asset || asset.size > MAX_PORTRAIT_BYTES) return null
    const content = await readFile(asset.file)
    if (content.length > MAX_PORTRAIT_BYTES || !content.subarray(0, 8).equals(PNG_SIGNATURE))
      return null
    return {
      id,
      name: metadata.name,
      english: metadata.english,
      cid: `prts-portrait-${id}@prts.local`,
      content,
    }
  } catch {
    // A missing or unreadable optional illustration must not suppress a deadline reminder.
    return null
  }
}

function escapeHtml(value) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(value).replace(/[&<>"']/g, (character) => replacements[character])
}

/** Inline styles and presentation tables also work in mail clients without web CSS. */
export function renderReminderEmail(event, { now, timeZone, theme = 'rhodes', portrait = null }) {
  const payload = qqReminderPayload(event, { now, timeZone })
  const rhine = theme === 'rhine'
  const accent = rhine ? '#246e43' : '#d94b18'
  const headerBackground = rhine ? '#e7eee3' : '#151a1f'
  const headerColor = rhine ? '#1d3025' : '#ffffff'
  const background = rhine ? '#f0f2ed' : '#f1f3f5'
  const brand = rhine ? 'RHINE LAB' : 'PRTS'
  const fields = Object.entries(payload.fields)
  const watermark = portrait
    ? `background-image:linear-gradient(90deg,rgba(255,255,255,0.97),rgba(255,255,255,0.87)),url('cid:${escapeHtml(portrait.cid)}');background-repeat:no-repeat;background-position:center,right center;background-size:100% 100%,contain;`
    : ''
  return {
    subject: `PRTS · ${payload.title}`,
    text: `${payload.message}\n\n${fields.map(([key, value]) => `${key}：${value}`).join('\n')}`,
    attachments: portrait
      ? [
          {
            filename: `${portrait.id}.png`,
            content: portrait.content,
            contentType: 'image/png',
            contentDisposition: 'inline',
            cid: portrait.cid,
          },
        ]
      : [],
    html: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(payload.title)} · PRTS</title>
  <style>
    @media only screen and (max-width:520px) {
      .mail-copy { padding:24px 20px 12px!important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${background};color:#24312b;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(payload.message)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:${background};">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #d6ddd6;border-collapse:collapse;">
        <tr><td style="padding:26px 24px;background:${headerBackground};color:${headerColor};border-top:4px solid ${accent};">
          <p style="margin:0 0 8px;font-size:25px;font-weight:700;letter-spacing:2px;">${brand}</p>
          <p style="margin:0;font-size:11px;letter-spacing:2px;">PERSONAL TERMINAL / TASK REMINDER</p>
        </td></tr>
        <tr><td class="mail-copy${portrait ? ' mail-watermark' : ''}" style="padding:28px 24px 12px;vertical-align:top;background-color:#ffffff;${watermark}">
          <p style="margin:0 0 12px;color:${accent};font-size:12px;font-weight:700;letter-spacing:2px;">任务截止提醒</p>
          <h1 style="margin:0 0 18px;color:#202e27;font-size:25px;font-weight:700;line-height:1.5;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap;">${escapeHtml(event.title)}</h1>
          <p style="margin:0 0 22px;color:#52645a;font-size:15px;line-height:1.9;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(payload.message)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f5f7f3;border-left:3px solid ${accent};">
            ${fields.map(([key, value]) => `<tr><td style="padding:12px 14px;border-bottom:1px solid #e3e8e0;font-size:13px;color:#52645a;line-height:1.6;vertical-align:top;white-space:nowrap;">${escapeHtml(key)}</td><td style="padding:12px 14px;border-bottom:1px solid #e3e8e0;font-size:14px;font-weight:600;color:#24312b;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(value)}</td></tr>`).join('')}
          </table>
        </td></tr>
        <tr><td style="padding:22px 24px 26px;color:#68766d;font-size:12px;line-height:1.8;">
          由 PRTS 个人终端发送 · 任务通知
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  }
}
