import { useEffect, useRef, useState } from 'react'
import { Bell, ArrowUpRight } from 'lucide-react'
import { apiFetch, WORKSPACE_UPDATED_EVENT } from '../lib/api'
import {
  NOTIFICATIONS_CHANGED,
  notificationPermission,
  type TaskReminder,
} from '../lib/notifications'
import '../styles/notifications.css'

export default function TaskReminders({
  revision,
  onTasks,
  sound,
}: {
  revision: number
  onTasks: () => void
  sound: boolean
}) {
  const [reminders, setReminders] = useState<TaskReminder[]>([])
  const [error, setError] = useState('')
  const [reading, setReading] = useState('')
  const seen = useRef(new Set<string>())
  const native = useRef(new Map<string, Notification>())
  const version = useRef(0)
  const onTasksRef = useRef(onTasks)
  onTasksRef.current = onTasks
  useEffect(() => {
    let disposed = false
    let running = false
    const controller = new AbortController()
    async function refresh() {
      if (running || disposed) return
      running = true
      const requestVersion = ++version.current
      try {
        const response = await apiFetch('/api/notifications', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        })
        const data = await response.json()
        if (
          disposed ||
          requestVersion !== version.current ||
          !response.ok ||
          !Array.isArray(data.reminders)
        )
          return
        const values: TaskReminder[] = data.reminders
        setReminders(values)
        const live = new Set(values.map((value) => value.id))
        for (const [id, notification] of native.current)
          if (!live.has(id)) {
            notification.close()
            native.current.delete(id)
          }
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration()
          const notifications = await registration?.getNotifications()
          if (disposed) return
          notifications
            ?.filter(
              (item) =>
                item.tag.startsWith('prts-task-') && !live.has(item.tag.slice('prts-task-'.length)),
            )
            .forEach((item) => item.close())
        }
        if (notificationPermission() !== 'granted') return
        for (const reminder of values) {
          if (seen.current.has(reminder.id)) continue
          seen.current.add(reminder.id)
          const options = {
            body: `${reminder.title}\n截止：${new Date(reminder.dueAt).toLocaleString('zh-CN')}`,
            tag: `prts-task-${reminder.id}`,
            icon: '/icons/rhodes-island-192.png',
            data: { url: '/#tasks' },
            silent: !sound,
          }
          const registration =
            'serviceWorker' in navigator
              ? await navigator.serviceWorker.getRegistration()
              : undefined
          if (disposed) return
          if (registration?.active)
            await registration.showNotification('PRTS · 任务截止提醒', options)
          else {
            const notification = new Notification('PRTS · 任务截止提醒', options)
            notification.onclick = () => {
              window.focus()
              onTasksRef.current()
              notification.close()
            }
            native.current.set(reminder.id, notification)
          }
        }
      } catch {
        /* The reminder panel never blocks normal workspace use. */
      } finally {
        running = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    const update = () => void refresh()
    window.addEventListener('focus', update)
    window.addEventListener(WORKSPACE_UPDATED_EVENT, update)
    window.addEventListener(NOTIFICATIONS_CHANGED, update)
    return () => {
      disposed = true
      ++version.current
      controller.abort()
      clearInterval(timer)
      window.removeEventListener('focus', update)
      window.removeEventListener(WORKSPACE_UPDATED_EVENT, update)
      window.removeEventListener(NOTIFICATIONS_CHANGED, update)
    }
  }, [revision, sound])
  useEffect(
    () => () => {
      for (const notification of native.current.values()) notification.close()
      if ('serviceWorker' in navigator)
        void navigator.serviceWorker
          .getRegistration()
          .then(async (registration) => {
            const list = await registration?.getNotifications()
            list
              ?.filter((item) => item.tag.startsWith('prts-task-'))
              .forEach((item) => item.close())
          })
          .catch(() => {})
    },
    [],
  )
  async function dismiss(reminder: TaskReminder) {
    if (reading) return
    setReading(reminder.id)
    setError('')
    try {
      const response = await apiFetch(`/api/notifications/${reminder.id}/read`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error('提醒暂未标记已读，请重试。')
      setReminders((values) => values.filter((value) => value.id !== reminder.id))
      native.current.get(reminder.id)?.close()
      native.current.delete(reminder.id)
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration()
        const values = await registration?.getNotifications({ tag: `prts-task-${reminder.id}` })
        values?.forEach((value) => value.close())
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请稍后重试。')
    } finally {
      setReading('')
    }
  }
  if (!reminders.length) return null
  return (
    <section className="task-reminder-tray" aria-label="任务截止提醒" aria-live="polite">
      <div className="task-reminder-heading">
        <Bell size={17} />
        <strong>任务即将截止</strong>
        <span>{reminders.length} 项</span>
        <button className="button button-ghost" onClick={onTasks}>
          查看任务
          <ArrowUpRight size={13} />
        </button>
      </div>
      <ul>
        {reminders.map((reminder) => (
          <li key={reminder.id}>
            <div>
              <strong>{reminder.title}</strong>
              <time dateTime={new Date(reminder.dueAt).toISOString()}>
                截止：
                {new Date(reminder.dueAt).toLocaleString('zh-CN', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
            <button
              className="button button-ghost"
              disabled={!!reading}
              aria-label={`知道了：${reminder.title}`}
              onClick={() => void dismiss(reminder)}
            >
              知道了
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
