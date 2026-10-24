export type Priority = 'high' | 'medium' | 'low'

export interface TaskCategory {
  id: string
  name: string
}

export interface Task {
  id: string
  title: string
  priority: Priority
  categoryId: string
  done: boolean
  dueDate: string
  dueAt?: string
  createdAt: string
}

export interface Note {
  id: string
  title: string
  content: string
  tag: string
  updatedAt: string
  pinned: boolean
}

export interface Activity {
  id: string
  text: string
  time: string
  type: 'task' | 'note' | 'file' | 'system' | 'focus'
}

export interface Settings {
  name: string
  focusMinutes: number
  sound: boolean
}

export interface Workspace {
  schemaVersion: 2
  taskCategories: TaskCategory[]
  tasks: Task[]
  notes: Note[]
  activities: Activity[]
  settings: Settings
  focusSessions: number
}

export const WORKSPACE_STORAGE_KEY = 'prts-workspace-v1'
export const MAX_TASK_CATEGORIES = 50

/** Shared by import validation and category mutations, so both accept the same names. */
export function normalizeTaskCategoryName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('分类名称不能为空')
  const name = value.trim()
  if (name.length > 40) throw new Error('分类名称不能超过 40 个字符')
  if (name === '未分类') throw new Error('“未分类”为保留名称')
  return name
}

export function makeId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function createInitialWorkspace(): Workspace {
  const now = new Date()
  const taskCategories = ['工作', '学习', '生活'].map((name) => ({ id: makeId(), name }))
  const [workCategory, studyCategory, lifeCategory] = taskCategories
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()
  const day = (offset: number) => {
    const date = new Date(now)
    date.setDate(date.getDate() + offset)
    return localDate(date)
  }
  return {
    schemaVersion: 2,
    taskCategories,
    tasks: [
      {
        id: makeId(),
        title: '完善个人作品集',
        priority: 'high',
        categoryId: workCategory.id,
        done: false,
        dueDate: day(0),
        createdAt: ago(180),
      },
      {
        id: makeId(),
        title: '阅读《设计中的设计》',
        priority: 'medium',
        categoryId: studyCategory.id,
        done: false,
        dueDate: day(0),
        createdAt: ago(160),
      },
      {
        id: makeId(),
        title: '整理项目参考资料',
        priority: 'low',
        categoryId: workCategory.id,
        done: false,
        dueDate: day(1),
        createdAt: ago(140),
      },
      {
        id: makeId(),
        title: '每周复盘与下周计划',
        priority: 'medium',
        categoryId: lifeCategory.id,
        done: false,
        dueDate: day(2),
        createdAt: ago(120),
      },
      {
        id: makeId(),
        title: '梳理本周的工作重点',
        priority: 'high',
        categoryId: workCategory.id,
        done: true,
        dueDate: day(0),
        createdAt: ago(240),
      },
      {
        id: makeId(),
        title: '给书桌留一点空白',
        priority: 'low',
        categoryId: lifeCategory.id,
        done: true,
        dueDate: day(0),
        createdAt: ago(220),
      },
    ],
    notes: [
      {
        id: makeId(),
        title: '留一点时间，做喜欢的事',
        tag: '随想',
        pinned: true,
        updatedAt: ago(12),
        content:
          '# 留一点时间，做喜欢的事\n\n不必每一天都很高效。把注意力放回自己在意的事，就已经是一种进展。\n\n- 读几页一直想读的书\n- 记录一个突然出现的想法\n- 完成一件小而确定的事\n\n> 慢一点，也可以走得很远。',
      },
      {
        id: makeId(),
        title: '个人作品集 · 改版思路',
        tag: '项目',
        pinned: false,
        updatedAt: ago(48),
        content:
          '# 个人作品集 · 改版思路\n\n## 想传达的感觉\n清晰、真诚，有一点自己的性格。\n\n## 内容清单\n- 简短的自我介绍\n- 三个能说明思考过程的项目\n- 设计与开发中的小实验\n\n## 下一步\n先把项目故事写完整，再考虑版式和动效。',
      },
      {
        id: makeId(),
        title: '《设计中的设计》阅读摘记',
        tag: '阅读',
        pinned: false,
        updatedAt: ago(150),
        content:
          '# 《设计中的设计》阅读摘记\n\n## 今天的思考\n好的设计常常来自重新观察那些熟悉的事物。\n\n试着从日常里找一个习以为常的物件，记录它的形状、材料和使用方式。\n\n## 留给自己的问题\n如果去掉一个元素，体验会变得更清楚吗？',
      },
      {
        id: makeId(),
        title: '一份轻量的每周复盘',
        tag: '生活',
        pinned: false,
        updatedAt: ago(1440),
        content:
          '# 一份轻量的每周复盘\n\n## 这周做成了什么\n记录三件值得记住的小事。\n\n## 什么让我有能量\n留意那些让自己投入、好奇、感到轻松的时刻。\n\n## 下周只做三件事\n1. 推进一个重要项目\n2. 留出一次完整的阅读时间\n3. 去户外走一走',
      },
    ],
    activities: [
      { id: makeId(), text: '更新了笔记「留一点时间，做喜欢的事」', time: ago(12), type: 'note' },
      { id: makeId(), text: '完成了「梳理本周的工作重点」', time: ago(35), type: 'task' },
      { id: makeId(), text: '添加了任务「完善个人作品集」', time: ago(180), type: 'task' },
      { id: makeId(), text: '欢迎来到你的个人工作台', time: ago(240), type: 'system' },
    ],
    settings: { name: '旅行者', focusMinutes: 25, sound: true },
    focusSessions: 0,
  }
}

function invalid(message: string): never {
  throw new Error(`工作台数据无效：${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    invalid(`${label}格式错误`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) {
    invalid(`${label}应为${allowEmpty ? '' : '非空'}文本，且不超过 ${max} 个字符`)
  }
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(`${label}应为布尔值`)
  return value
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    invalid(`${label}应为 ${min} 到 ${max} 之间的整数`)
  }
  return value
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 40)
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    invalid(`${label}不是有效的 ISO 日期时间`)
  const calendarDate = new Date(`${result.slice(0, 10)}T00:00:00.000Z`)
  if (
    !Number.isFinite(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== result.slice(0, 10)
  ) {
    invalid(`${label}包含不存在的日期`)
  }
  return result
}

function dueDate(value: unknown): string {
  const result = text(value, '截止日期', 10, true)
  if (result === '') return result
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) invalid('截止日期应使用 YYYY-MM-DD 格式')
  const date = new Date(`${result}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result)
    invalid('截止日期不存在')
  return result
}

function collection<T extends { id: string }>(
  value: unknown,
  label: string,
  parse: (item: unknown) => T,
): T[] {
  if (!Array.isArray(value) || value.length > 10_000) invalid(`${label}应为列表，且不超过 10000 条`)
  const result = value.map(parse)
  if (new Set(result.map((item) => item.id)).size !== result.length)
    invalid(`${label}包含重复的 ID`)
  return result
}

/** Unversioned/v1 backups migrate to v2 in memory; existing tasks remain uncategorized. */
export function validateWorkspace(data: unknown): Workspace {
  const root = record(data, '工作台')
  if (root.schemaVersion !== undefined && root.schemaVersion !== 1 && root.schemaVersion !== 2)
    invalid('暂不支持此数据版本，请更新应用后重试')
  const legacy = root.schemaVersion !== 2
  if (
    !legacy &&
    (!Array.isArray(root.taskCategories) || root.taskCategories.length > MAX_TASK_CATEGORIES)
  ) {
    invalid(`任务分类应为列表，且不超过 ${MAX_TASK_CATEGORIES} 个`)
  }
  const taskCategories = legacy
    ? []
    : collection(root.taskCategories, '任务分类', (value): TaskCategory => {
        const item = record(value, '任务分类')
        let name: string
        try {
          name = normalizeTaskCategoryName(item.name)
        } catch (error) {
          invalid(error instanceof Error ? error.message : '分类名称错误')
        }
        return { id: text(item.id, '分类 ID', 200), name }
      })
  if (
    new Set(taskCategories.map((category) => category.name.toLowerCase())).size !==
    taskCategories.length
  ) {
    invalid('任务分类名称重复')
  }
  const categoryIds = new Set(taskCategories.map((category) => category.id))
  const settings = record(root.settings, '设置')
  return {
    schemaVersion: 2,
    taskCategories,
    tasks: collection(root.tasks, '任务', (value): Task => {
      const item = record(value, '任务')
      if (!['high', 'medium', 'low'].includes(item.priority as string)) invalid('任务优先级错误')
      const categoryId = legacy ? '' : text(item.categoryId, '任务分类 ID', 200, true)
      if (categoryId && !categoryIds.has(categoryId)) invalid('任务分类不存在')
      return {
        id: text(item.id, '任务 ID', 200),
        title: text(item.title, '任务标题', 300),
        priority: item.priority as Priority,
        categoryId,
        done: boolean(item.done, '任务完成状态'),
        dueDate: dueDate(item.dueDate),
        ...(item.dueAt !== undefined ? { dueAt: timestamp(item.dueAt, '任务截止时间') } : {}),
        createdAt: timestamp(item.createdAt, '任务创建时间'),
      }
    }),
    notes: collection(root.notes, '笔记', (value): Note => {
      const item = record(value, '笔记')
      return {
        id: text(item.id, '笔记 ID', 200),
        title: text(item.title, '笔记标题', 300, true),
        content: text(item.content, '笔记内容', 1_000_000, true),
        tag: text(item.tag, '笔记标签', 80, true),
        updatedAt: timestamp(item.updatedAt, '笔记更新时间'),
        pinned: boolean(item.pinned, '笔记置顶状态'),
      }
    }),
    activities: collection(root.activities, '动态', (value): Activity => {
      const item = record(value, '动态')
      if (!['task', 'note', 'file', 'system', 'focus'].includes(item.type as string))
        invalid('动态类型错误')
      return {
        id: text(item.id, '动态 ID', 200),
        text: text(item.text, '动态内容', 1000),
        time: timestamp(item.time, '动态时间'),
        type: item.type as Activity['type'],
      }
    }),
    settings: {
      name: text(settings.name, '称呼', 80),
      focusMinutes: integer(settings.focusMinutes, '专注时长', 1, 180),
      sound: boolean(settings.sound, '提示音设置'),
    },
    focusSessions: integer(root.focusSessions, '专注次数', 0, Number.MAX_SAFE_INTEGER),
  }
}

export function loadWorkspace(): Workspace {
  try {
    const raw = globalThis.localStorage?.getItem(WORKSPACE_STORAGE_KEY)
    if (raw !== null && raw !== undefined) return validateWorkspace(JSON.parse(raw))
  } catch {
    // Leave the original storage untouched, so damaged data can still be recovered.
  }
  return createInitialWorkspace()
}

export function saveWorkspace(workspace: Workspace): void {
  const serialized = JSON.stringify(validateWorkspace(workspace))
  try {
    const storage = globalThis.localStorage
    if (!storage) throw new Error('当前浏览器不支持本地存储')
    storage.setItem(WORKSPACE_STORAGE_KEY, serialized)
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      throw new Error('保存失败：浏览器本地存储空间不足，请先导出备份，再清理不需要的内容。')
    }
    throw new Error('保存失败：无法写入浏览器本地存储，请检查浏览器隐私设置并导出备份。')
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const unit = Math.max(0, Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1))
  return `${Number((bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1))} ${units[unit]}`
}

export function relativeTime(iso: string): string {
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return '时间未知'
  const elapsed = Date.now() - timestamp
  const minutes = Math.floor(Math.abs(elapsed) / 60_000)
  const suffix = elapsed < 0 ? '后' : '前'
  if (minutes < 1) return elapsed < 0 ? '片刻后' : '刚刚'
  if (minutes < 60) return `${minutes} 分钟${suffix}`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时${suffix}`
  if (minutes < 10_080) return `${Math.floor(minutes / 1440)} 天${suffix}`
  const date = new Date(timestamp)
  return date.toLocaleDateString('zh-CN', {
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}),
    month: 'long',
    day: 'numeric',
  })
}
