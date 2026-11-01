const titleKey = (value) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export function sameCapture(operation, candidate, existing) {
  if (titleKey(candidate.title) !== titleKey(existing.title)) return false
  if (operation === 'create_task')
    return (
      candidate.done === existing.done &&
      candidate.priority === existing.priority &&
      candidate.categoryId === existing.categoryId &&
      (candidate.dueAt
        ? Boolean(existing.dueAt) && Date.parse(candidate.dueAt) === Date.parse(existing.dueAt)
        : !existing.dueAt && candidate.dueDate === existing.dueDate)
    )
  if (candidate.allDay !== existing.allDay) return false
  if (candidate.location !== existing.location || candidate.description !== existing.description)
    return false
  return candidate.allDay
    ? candidate.startDate === existing.startDate && candidate.endDate === existing.endDate
    : Date.parse(candidate.startAt) === Date.parse(existing.startAt) &&
        Date.parse(candidate.endAt) === Date.parse(existing.endAt)
}

function overlaps(a, b, day) {
  if (!a.allDay && !b.allDay)
    return (
      Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt)
    )
  if (a.allDay && b.allDay) return a.startDate <= b.endDate && b.startDate <= a.endDate
  if (!day) return false
  const range = (event) =>
    event.allDay
      ? [event.startDate, event.endDate]
      : [day(Date.parse(event.startAt)), day(Date.parse(event.endAt) - 1)]
  const [aStart, aEnd] = range(a),
    [bStart, bEnd] = range(b)
  return aStart <= bEnd && bStart <= aEnd
}

export function captureWarnings(candidate, events, timeZone) {
  const formatter = timeZone
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
    : null
  const days = new Map()
  const day = formatter
    ? (instant) => {
        if (!days.has(instant)) {
          const parts = Object.fromEntries(
            formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
          )
          days.set(instant, `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`)
        }
        return days.get(instant)
      }
    : null
  const display = (instant) => (formatter ? formatter.format(new Date(instant)) : instant)
  const warnings = []
  for (const event of events) {
    if (!overlaps(candidate, event, day)) continue
    const range = event.allDay
      ? `${event.startDate} ～ ${event.endDate}，全天`
      : `${display(event.startAt)} ～ ${display(event.endAt)}`
    warnings.push(`与「${event.title}」时间重叠（${range}）。请核对是否仍要安排。`)
    if (warnings.length === 5) break
  }
  return warnings
}
