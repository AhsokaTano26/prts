import { createHash } from 'node:crypto'

const text = (value) =>
  String(value || '')
    .replace(/\r\n|\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[;,]/g, '\\$&')

function fold(line) {
  const lines = []
  let part = '',
    bytes = 0
  for (const character of line) {
    const size = Buffer.byteLength(character)
    if (bytes + size > 75) {
      lines.push(part)
      part = ' '
      bytes = 1
    }
    part += character
    bytes += size
  }
  lines.push(part)
  return lines.join('\r\n')
}

const utc = (value) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
const date = (value) => value.replace(/-/g, '')
function allDay(start, end) {
  const lines = [`DTSTART;VALUE=DATE:${date(start)}`]
  if (end === '9999-12-31') {
    const days =
      Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1
    lines.push(`DURATION:P${days}D`)
  } else {
    const next = new Date(`${end}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    lines.push(`DTEND;VALUE=DATE:${date(next.toISOString().slice(0, 10))}`)
  }
  return lines
}

/** Serialize already-validated workspace data without exposing other documents. */
export function buildCalendarFeed({
  workspace,
  updatedAt = '1970-01-01T00:00:00Z',
  namespace,
  revision = 0,
}) {
  const stamp = utc(updatedAt)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PRTS//Calendar Subscription//ZH',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:PRTS 日历日程',
  ]
  const headerLength = lines.length
  const zones = new Map()
  function instant(property, value) {
    const year = new Date(value).getUTCFullYear()
    if (year >= 1 && year <= 9999) return `${property}:${utc(value)}`
    // Valid offset-based dates at the range boundary may normalize to UTC year 0/10000.
    // Preserve their original clock and fixed offset instead of emitting an extended ICS year.
    const offset = /([+-]\d{2}):?(\d{2})$/.exec(value) || ['', '+00', '00']
    const zone = `PRTS/Fixed${offset[1][0] === '-' ? 'M' : 'P'}${offset[1].slice(1)}${offset[2]}`
    zones.set(zone, `${offset[1]}${offset[2]}`)
    return `${property};TZID=${zone}:${value.slice(0, 19).replace(/[-:]/g, '')}`
  }
  function component(item, type, properties) {
    const identity = createHash('sha256')
      .update(JSON.stringify([namespace, type, item.id]))
      .digest('hex')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${identity}@prts`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${stamp}`,
      `SEQUENCE:${Math.min(revision, 2147483647)}`,
      'CLASS:PRIVATE',
      ...properties,
      'END:VEVENT',
    )
  }
  for (const event of workspace?.calendarEvents || []) {
    component(event, 'event', [
      ...(event.allDay
        ? allDay(event.startDate, event.endDate)
        : [
            instant('DTSTART', event.startAt),
            Math.floor(Date.parse(event.startAt) / 1000) ===
            Math.floor(Date.parse(event.endAt) / 1000)
              ? 'DURATION:PT1S'
              : instant('DTEND', event.endAt),
          ]),
      `SUMMARY:${text(event.title)}`,
      ...(event.description ? [`DESCRIPTION:${text(event.description)}`] : []),
      ...(event.location ? [`LOCATION:${text(event.location)}`] : []),
    ])
  }
  for (const task of workspace?.tasks || []) {
    if (task.done || (!task.dueAt && !task.dueDate)) continue
    component(task, 'task', [
      ...(task.dueAt
        ? [instant('DTSTART', task.dueAt), 'DURATION:PT1M']
        : allDay(task.dueDate, task.dueDate)),
      `SUMMARY:${text(`截止 · ${task.title}`)}`,
      'TRANSP:TRANSPARENT',
    ])
  }
  const zoneLines = []
  for (const [name, offset] of zones)
    zoneLines.push(
      'BEGIN:VTIMEZONE',
      `TZID:${name}`,
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      `TZOFFSETFROM:${offset}`,
      `TZOFFSETTO:${offset}`,
      'END:STANDARD',
      'END:VTIMEZONE',
    )
  lines.splice(headerLength, 0, ...zoneLines)
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
