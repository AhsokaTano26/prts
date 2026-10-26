import { makeId, validateCalendarEvent, type CalendarEvent } from './workspace.ts'

const pad = (value: number) => String(value).padStart(2, '0')
export function dateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const calendarDate = (day: string) => new Date(`${day}T12:00:00Z`)
const utcKey = (date: Date) => date.toISOString().split('T')[0]

export function addDays(day: string, offset: number): string {
  const date = calendarDate(day)
  date.setUTCDate(date.getUTCDate() + offset)
  return utcKey(date)
}

export function monthDays(day: string): string[] {
  const first = calendarDate(`${day.slice(0, 7)}-01`)
  first.setUTCDate(1 - ((first.getUTCDay() + 6) % 7))
  const start = utcKey(first)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function shiftMonth(day: string, offset: number): string {
  const date = calendarDate(day)
  const number = date.getUTCDate()
  date.setUTCMonth(date.getUTCMonth() + offset, 1)
  if (date.getUTCFullYear() < 1) return '0001-01-01'
  if (date.getUTCFullYear() > 9999) return '9999-12-31'
  const last = new Date(date)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  date.setUTCDate(Math.min(number, last.getUTCDate()))
  return utcKey(date)
}

export function eventStartDate(event: CalendarEvent): string {
  return event.allDay ? event.startDate : dateKey(new Date(event.startAt))
}

export function dayBounds(day: string): [number, number] {
  return [new Date(`${day}T00:00:00`).getTime(), new Date(`${addDays(day, 1)}T00:00:00`).getTime()]
}

export function eventOnDate(event: CalendarEvent, day: string): boolean {
  if (event.allDay) return event.startDate <= day && event.endDate >= day
  const [start, end] = dayBounds(day)
  return end > start && Date.parse(event.startAt) < end && Date.parse(event.endAt) > start
}

export function timeText(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function eventTimeLabel(event: CalendarEvent, day: string): string {
  if (event.allDay) return '全天'
  const start = new Date(event.startAt),
    end = new Date(event.endAt)
  const endDay = dateKey(end)
  const nextDay = endDay === addDays(day, 1)
  const endLabel =
    endDay === day
      ? timeText(end)
      : nextDay && timeText(end) === '00:00'
        ? '24:00'
        : `${nextDay ? '次日' : `${end.getMonth() + 1}/${end.getDate()}`} ${timeText(end)}`
  return `${dateKey(start) === day ? timeText(start) : '延续'} — ${endLabel}`
}

export interface CalendarDraft {
  title: string
  description: string
  location: string
  allDay: boolean
  startDate: string
  endDate: string
  startTime: string
  endTime: string
}

export function calendarDraft(event: CalendarEvent | null, day: string): CalendarDraft {
  return {
    title: event?.title ?? '',
    description: event?.description ?? '',
    location: event?.location ?? '',
    allDay: event?.allDay ?? false,
    startDate: event ? eventStartDate(event) : day,
    endDate: event ? (event.allDay ? event.endDate : dateKey(new Date(event.endAt))) : day,
    startTime: event && !event.allDay ? timeText(new Date(event.startAt)) : '09:00',
    endTime: event && !event.allDay ? timeText(new Date(event.endAt)) : '10:00',
  }
}

function localTimestamp(day: string, time: string, original?: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error('请填写有效的日程日期和时间。')
  if (original && dateKey(new Date(original)) === day && timeText(new Date(original)) === time)
    return original
  const date = new Date(`${day}T${time}:00`)
  if (!Number.isFinite(date.getTime()) || dateKey(date) !== day || timeText(date) !== time)
    throw new Error('此日期或时刻在当前时区不存在，请重新选择。')
  return date.toISOString()
}

export function eventFromDraft(
  draft: CalendarDraft,
  original?: CalendarEvent | null,
): CalendarEvent {
  const now = new Date().toISOString()
  const base = {
    id: original?.id ?? makeId(),
    title: draft.title.trim(),
    description: draft.description,
    location: draft.location.trim(),
    createdAt: original?.createdAt ?? now,
    updatedAt: now,
  }
  return validateCalendarEvent(
    draft.allDay
      ? { ...base, allDay: true, startDate: draft.startDate, endDate: draft.endDate }
      : {
          ...base,
          allDay: false,
          startAt: localTimestamp(
            draft.startDate,
            draft.startTime,
            original && !original.allDay ? original.startAt : undefined,
          ),
          endAt: localTimestamp(
            draft.endDate,
            draft.endTime,
            original && !original.allDay ? original.endAt : undefined,
          ),
        },
  )
}
