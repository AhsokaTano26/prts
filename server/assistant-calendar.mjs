import { HttpError } from './errors.mjs'
import { validateCalendarEvent } from '../src/lib/workspace.ts'

export function calendarTimeZone(value) {
  if (value === undefined) return null
  if (typeof value !== 'string' || !value || value.length > 100)
    throw new HttpError(400, '日程时区无效，请提供 IANA 时区。')
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    throw new HttpError(400, '日程时区无效，请提供 IANA 时区。')
  }
}

function dateBound(value) {
  if (value === undefined) return null
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '0001-01-01' ||
    value > '9999-12-31'
  )
    throw new HttpError(400, '日程日期范围须使用有效的 YYYY-MM-DD 日期。')
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new HttpError(400, '日程日期不存在。')
  return Number(value.replace(/-/g, ''))
}

export function searchCalendar(events, args, clientTimeZone) {
  const from = dateBound(args.fromDate),
    to = dateBound(args.toDate)
  if (from !== null && to !== null && from > to)
    throw new HttpError(400, '日程查询的结束日期不能早于开始日期。')
  const zone = args.timeZone === undefined ? clientTimeZone : calendarTimeZone(args.timeZone)
  const ranged = from !== null || to !== null
  if (ranged && !zone)
    throw new HttpError(
      400,
      '按日期查询日程需要用户时区，请提供 timeZone，例如 Asia/Shanghai；未知时请先询问用户。',
    )
  const formatter = ranged
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        era: 'short',
      })
    : null
  const localDay = (instant) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    )
    const year = parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year)
    return year * 10000 + Number(parts.month) * 100 + Number(parts.day)
  }
  const query = (args.query || '').toLocaleLowerCase().trim()
  return events.filter((event) => {
    if (
      query &&
      !`${event.title}\n${event.description}\n${event.location}`.toLocaleLowerCase().includes(query)
    )
      return false
    if (!ranged) return true
    const start = event.allDay
      ? Number(event.startDate.replace(/-/g, ''))
      : localDay(Date.parse(event.startAt))
    const end = event.allDay
      ? Number(event.endDate.replace(/-/g, ''))
      : localDay(Date.parse(event.endAt) - 1)
    return (from === null || end >= from) && (to === null || start <= to)
  })
}

export function changeCalendar(events, change, now) {
  const fields = change.fields ?? {}
  const deleting = change.operation === 'delete_calendar_event'
  const creating = change.operation === 'create_calendar_event'
  const allowed = deleting
    ? []
    : ['title', 'description', 'location', 'allDay', 'startDate', 'endDate', 'startAt', 'endAt']
  if (Object.keys(fields).some((key) => !allowed.includes(key)))
    throw new HttpError(400, '包含不支持的日程字段。')
  const index = events.findIndex((event) => event.id === change.id)
  if (!creating && index < 0) throw new HttpError(404, '指定日程不存在，请先检索当前工作台。')
  const before = creating ? null : { ...events[index] }
  const next = [...events]
  let after = null
  if (deleting) next.splice(index, 1)
  else {
    const stamp = new Date(now).toISOString()
    const candidate = before
      ? { ...before }
      : { id: change.id, title: '', description: '', location: '', allDay: false, createdAt: stamp }
    if (before && fields.allDay !== undefined && fields.allDay !== before.allDay) {
      if (fields.allDay === true) {
        delete candidate.startAt
        delete candidate.endAt
      } else if (fields.allDay === false) {
        delete candidate.startDate
        delete candidate.endDate
      }
    }
    Object.assign(candidate, fields, { updatedAt: stamp })
    try {
      after = validateCalendarEvent(candidate)
    } catch (error) {
      throw new HttpError(400, error.message)
    }
    if (creating) next.unshift(after)
    else next[index] = after
  }
  return {
    events: next,
    before,
    after,
    summary: `${creating ? '新建' : deleting ? '删除' : '更新'}日程：${(after || before).title}`,
  }
}
