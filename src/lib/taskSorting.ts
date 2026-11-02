import type { Task } from './workspace.ts'
import { taskDeadline } from './reminders.ts'

const priorityOrder = { high: 0, medium: 1, low: 2 }
const titleOrder = new Intl.Collator('zh-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' })

/** Sort display copies; the stored task array and completion status stay independent. */
export function sortTasks(
  tasks: readonly Task[],
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Task[] {
  return tasks
    .map((task) => ({
      task,
      deadline: taskDeadline(task, timeZone) ?? Number.POSITIVE_INFINITY,
      createdAt: Date.parse(task.createdAt),
    }))
    .sort(
      (a, b) =>
        priorityOrder[a.task.priority] - priorityOrder[b.task.priority] ||
        a.deadline - b.deadline ||
        a.createdAt - b.createdAt ||
        titleOrder.compare(a.task.title.trimStart(), b.task.title.trimStart()),
    )
    .map(({ task }) => task)
}
