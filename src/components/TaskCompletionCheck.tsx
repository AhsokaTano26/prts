import { Check } from 'lucide-react'
import type { Task } from '../lib/workspace'
import '../styles/task-completion.css'

export default function TaskCompletionCheck({
  task,
  completing,
  onToggle,
}: {
  task: Task
  completing: boolean
  onToggle: (id: string) => void
}) {
  return (
    <button
      type="button"
      className="task-check"
      role="checkbox"
      aria-checked={task.done}
      aria-disabled={completing || undefined}
      aria-label={`${task.done ? '恢复' : '完成'}任务：${task.title}`}
      onClick={() => {
        if (!completing) onToggle(task.id)
      }}
    >
      {task.done && <Check size={13} strokeWidth={2.5} />}
      {completing && (
        <span className="task-check-burst" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </button>
  )
}
