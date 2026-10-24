type DeadlineTask = { dueDate: string; dueAt?: string }
const pad = (value: number) => String(value).padStart(2, '0')

export function taskLocalDate(task: DeadlineTask): string {
  if (!task.dueAt) return task.dueDate
  const date = new Date(task.dueAt)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
export function taskLocalTime(task: DeadlineTask): string {
  if (!task.dueAt) return ''
  const date = new Date(task.dueAt)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function editedTaskDeadline(
  original: DeadlineTask | null,
  dueDate: string,
  dueTime: string,
): string | undefined {
  if (!dueTime) return undefined
  if (!dueDate) throw new Error('设置截止时间前请先选择日期。')
  if (original?.dueAt && taskLocalDate(original) === dueDate && taskLocalTime(original) === dueTime)
    return original.dueAt
  const date = new Date(`${dueDate}T${dueTime}:00`)
  if (
    !Number.isFinite(date.getTime()) ||
    taskLocalTime({ dueDate, dueAt: date.toISOString() }) !== dueTime
  )
    throw new Error('此时刻在当前时区不存在，请重新选择。')
  return date.toISOString()
}

/** Date-only deadlines use the configured timezone, never the server's locale. */
export function taskDeadline(task: DeadlineTask, timeZone: string): number | null {
  if (task.dueAt) return Number.isFinite(Date.parse(task.dueAt)) ? Date.parse(task.dueAt) : null
  if (!task.dueDate) return null
  const target = Date.parse(`${task.dueDate}T23:59:00Z`)
  if (!Number.isFinite(target)) return null
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  let candidate = target
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
    )
    const represented = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    )
    const difference = target - represented
    if (difference === 0) return candidate
    candidate += difference
  }
  return null
}

export function reminderOffsets({
  leadDays,
  leadMinutes,
}: {
  leadDays: readonly number[]
  leadMinutes: number
}): number[] {
  return [
    ...new Set([...leadDays.map((days) => days * 1440), ...(leadMinutes ? [leadMinutes] : [])]),
  ].sort((a, b) => b - a)
}

export function qqReminderPayload(
  event: { title: string; dueAt: number; offsetMinutes: number },
  { now, timeZone }: { now: number; timeZone: string },
) {
  const deadline = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(event.dueAt)
  const payload = {
    title: '任务截止提醒',
    message: `博士，任务「${event.title}」即将截止，请及时处理。`,
    source: 'PRTS',
    level: 'warning',
    timestamp: new Date(now).toISOString(),
    fields: {
      截止时间: `${deadline} (${timeZone})`,
      提前:
        event.offsetMinutes % 1440 === 0
          ? `${event.offsetMinutes / 1440} 天`
          : `${event.offsetMinutes} 分钟`,
    },
  }
  // The QQ endpoint caps its entire rendered message, including metadata.
  const rendered = `🟡 ${payload.title}\n来源：${payload.source}\n时间：${new Date(now + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')}+08:00\n${Object.entries(
    payload.fields,
  )
    .map(([k, v]) => `${k}：${v}`)
    .join('\n')}\n\n${payload.message}`
  if (rendered.length > 1900) throw new Error('QQ 通知排版后超过 1900 个字符。')
  return payload
}
