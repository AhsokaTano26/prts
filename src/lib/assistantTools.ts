export const ASSISTANT_OPERATIONS = [
  'create_task',
  'update_task',
  'delete_task',
  'create_calendar_event',
  'update_calendar_event',
  'delete_calendar_event',
  'create_note',
  'update_note',
  'delete_note',
  'create_category',
  'rename_category',
  'delete_category',
  'update_settings',
  'start_focus',
  'pause_focus',
  'reset_focus',
] as const
export type AssistantOperation = (typeof ASSISTANT_OPERATIONS)[number]
export const TOOL_LABELS: Record<string, string> = {
  get_workspace: '查看工作台',
  search_workspace: '检索工作台',
  read_workspace_item: '读取资料',
  propose_workspace_change: '准备工作台操作',
}
export type AssistantAction = {
  id: string
  operation: AssistantOperation
  summary: string
  preview: string
  status: 'pending' | 'applied' | 'dismissed' | 'expired'
  expiresAt: number
}
export type ToolUsage = { name: string; status: 'ok' | 'error' }
export function parseAssistantActions(value: unknown): AssistantAction[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 12) throw new Error('AI 操作卡片格式无效。')
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(item.id) ||
      !ASSISTANT_OPERATIONS.includes(item.operation) ||
      typeof item.summary !== 'string' ||
      item.summary.length > 500 ||
      typeof item.preview !== 'string' ||
      item.preview.length > 8000 ||
      !['pending', 'applied', 'dismissed', 'expired'].includes(item.status) ||
      !Number.isSafeInteger(item.expiresAt)
    )
      throw new Error('AI 操作卡片格式无效。')
    return {
      id: item.id,
      operation: item.operation,
      summary: item.summary,
      preview: item.preview,
      status: item.status,
      expiresAt: item.expiresAt,
    }
  })
}
export function parseToolUsage(value: unknown): ToolUsage[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 12) throw new Error('AI 工具记录格式无效。')
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.name !== 'string' ||
      item.name.length > 80 ||
      !['ok', 'error'].includes(item.status)
    )
      throw new Error('AI 工具记录格式无效。')
    return { name: item.name, status: item.status }
  })
}
