import type { Task, Priority } from './workspace.ts'
import { taskDeadline } from './reminders.ts'

export type MatrixOptions = {
  urgentDays: 1 | 3 | 7 | 14
  importantPriority: 'high' | 'medium'
}
export type QuadrantId = 'act' | 'plan' | 'fit' | 'later'
export const MATRIX_OPTIONS: MatrixOptions = {
  urgentDays: 7,
  importantPriority: 'high',
}
export const QUADRANTS: { id: QuadrantId; title: string; description: string }[] = [
  { id: 'act', title: '优先处理', description: '重要 · 紧急' },
  { id: 'plan', title: '计划安排', description: '重要 · 不紧急' },
  { id: 'fit', title: '适时处理', description: '一般优先级 · 紧急' },
  { id: 'later', title: '稍后考虑', description: '一般优先级 · 不紧急' },
]
const rank: Record<Priority, number> = { high: 0, medium: 1, low: 2 }
const DAY = 86400000

// Identity, rather than list order or priority, keeps a task's color stable.
export function taskMarkerColor(id: string): string {
  let hash = 2166136261
  for (const char of id) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619)
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash ^= hash >>> 13
  const hue = (((hash >>> 0) / 4294967296) * 360).toFixed(2)
  return `hsl(${hue} 64% var(--matrix-dot-lightness, 56%))`
}

export function parseMatrixOptions(hash: string): MatrixOptions {
  const query = new URLSearchParams(hash.length <= 1000 ? hash.split('?')[1] || '' : '')
  const days = Number(query.get('days'))
  return {
    urgentDays: [1, 3, 7, 14].includes(days) ? (days as MatrixOptions['urgentDays']) : 7,
    importantPriority: query.get('important') === 'medium' ? 'medium' : 'high',
  }
}
export function matrixHash(options: MatrixOptions): string {
  const query = new URLSearchParams()
  if (options.urgentDays !== 7) query.set('days', String(options.urgentDays))
  if (options.importantPriority !== 'high') query.set('important', options.importantPriority)
  return `#quadrants${query.size ? `?${query}` : ''}`
}
export type MatrixPoint = {
  id: string
  priority: Priority
  quadrant: QuadrantId
  tasks: Task[]
  x: number
  y: number
  labelY: number
  deadlineStart: number
  deadlineEnd: number
  overdueCount: number
}

export function buildTaskMatrix(
  input: readonly Task[],
  options: MatrixOptions & { now: number; timeZone: string; columns?: number },
) {
  const tasks = input.filter((task) => !task.done)
  const cutoff = options.now + options.urgentDays * DAY
  // Priority is ordinal: divide its levels within the two fixed-size halves.
  const importantLevels = rank[options.importantPriority] + 1
  const priorityPosition = (priority: Priority) => {
    const level = rank[priority]
    return level < importantLevels
      ? ((level + 0.5) / importantLevels) * 50
      : 50 + ((level - importantLevels + 0.5) / (3 - importantLevels)) * 50
  }
  const priorityY = {
    high: priorityPosition('high'),
    medium: priorityPosition('medium'),
    low: priorityPosition('low'),
  }
  const counts: Record<QuadrantId, number> = { act: 0, plan: 0, fit: 0, later: 0 }
  const undated: Task[] = []
  const overdueIds = new Set<string>()
  const dated: { task: Task; deadline: number; quadrant: QuadrantId }[] = []
  const deadlines = new Map<string, number | null>()
  let radius = Math.max(7, options.urgentDays) * DAY
  for (const task of tasks) {
    const key = task.dueAt || task.dueDate
    if (!deadlines.has(key)) deadlines.set(key, taskDeadline(task, options.timeZone))
    const deadline = deadlines.get(key)!
    if (deadline === null) {
      undated.push(task)
      continue
    }
    if (deadline < options.now) overdueIds.add(task.id)
    const important = rank[task.priority] <= rank[options.importantPriority]
    const urgent = deadline <= cutoff
    const quadrant = important ? (urgent ? 'act' : 'plan') : urgent ? 'fit' : 'later'
    counts[quadrant]++
    radius = Math.max(radius, Math.abs(deadline - cutoff))
    dated.push({ task, deadline, quadrant })
  }
  // Symmetry keeps the urgency divider at the middle without distorting time.
  const columns = Math.max(2, Math.min(40, Math.floor(options.columns || 12)))
  radius /= 1 - 2 * Math.min(0.22, 0.5 / columns)
  const min = cutoff - radius,
    max = cutoff + radius
  const rows = new Map<string, typeof dated>()
  for (const item of dated) {
    const key = `${item.task.priority}-${item.quadrant}`
    const row = rows.get(key) || []
    row.push(item)
    rows.set(key, row)
  }
  const points: MatrixPoint[] = []
  const spacing = 100 / columns
  for (const row of rows.values()) {
    let point: MatrixPoint | undefined
    for (const { task, deadline, quadrant } of row.sort((a, b) => a.deadline - b.deadline)) {
      const x = ((deadline - min) / (max - min)) * 100
      if (point && x - point.x < spacing) {
        point.tasks.push(task)
        if (overdueIds.has(task.id)) point.overdueCount++
        point.deadlineEnd = deadline
        point.x = (((point.deadlineStart + point.deadlineEnd) / 2 - min) / (max - min)) * 100
      } else {
        const y = priorityY[task.priority]
        point = {
          id: `${task.priority}-${quadrant}-${task.id}`,
          tasks: [task],
          priority: task.priority,
          quadrant,
          x,
          y,
          labelY: y,
          deadlineStart: deadline,
          deadlineEnd: deadline,
          overdueCount: overdueIds.has(task.id) ? 1 : 0,
        }
        points.push(point)
      }
    }
  }
  // Do not merge across the urgency boundary. Separate only the hit target
  // vertically, inside its ordinal priority band, and retain the true anchor.
  for (const priority of ['high', 'medium', 'low'] as Priority[]) {
    const left = points
      .filter((point) => point.priority === priority && ['act', 'fit'].includes(point.quadrant))
      .at(-1)
    const right = points.find(
      (point) => point.priority === priority && ['plan', 'later'].includes(point.quadrant),
    )
    if (left && right && right.x - left.x < spacing) {
      const halfEnd = right.y < 50 ? 50 : 100
      right.labelY += Math.min(11.5, halfEnd - right.y - 3)
    }
  }
  return {
    tasks,
    counts,
    undated,
    overdueIds,
    points,
    min,
    max,
    cutoff,
    importanceY: 50,
    priorityY,
  }
}
