export const NOTIFICATIONS_CHANGED = 'prts:notifications-changed'
export type NotificationConfig = {
  revision: number
  enabled: boolean
  browserEnabled: boolean
  leadDays: number[]
  leadMinutes: number
  timeZone: string
  webhook: {
    enabled: boolean
    hasUrl: boolean
    displayHost: string
    url?: string
    clearUrl?: boolean
  }
  smtp: {
    enabled: boolean
    host: string
    port: number
    security: 'tls' | 'starttls'
    user: string
    hasPassword: boolean
    password?: string
    clearPassword?: boolean
    from: string
    to: string
  }
}
export type TaskReminder = {
  id: string
  taskId: string
  title: string
  dueAt: number
  scheduledAt: number
  offsetMinutes: number
}
export type ReminderDelivery = {
  eventId: string
  target: string
  channel: string
  status: string
  attempts: number
  sentAt: number | null
  error: string
  title: string
  dueAt: number
  scheduledAt: number
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' || !window.isSecureContext
    ? 'unsupported'
    : Notification.permission
}
