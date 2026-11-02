import { createHash, randomUUID } from 'node:crypto'
import { HttpError } from './errors.mjs'
import { validateWorkspace } from '../src/lib/workspace.ts'
import {
  createTaskCategory,
  renameTaskCategory,
  deleteTaskCategory,
} from '../src/lib/taskCategories.ts'
import { ASSISTANT_OPERATIONS } from '../src/lib/assistantTools.ts'
import { changeCalendar, searchCalendar } from './assistant-calendar.mjs'
import { captureWarnings, sameCapture } from './assistant-capture.mjs'
import { focusRunning, resetFocus, toggleFocus, formatFocusTime } from '../src/lib/focusTimer.ts'

const actionLifetime = 30 * 60_000
const changeFieldsDescription =
  '创建任务或日程须title；修改/删除须id。日程用create_calendar_event/update_calendar_event/delete_calendar_event；定时须startAt/endAt（带时区），全天须allDay=true及startDate/endDate；切换类型须完整新范围。分类须name；个人思考用简短贴题的title和用户口吻的content，编辑前先读原文；普通设置只支持name/focusMinutes/sound。'
const fieldsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    content: {
      type: 'string',
      maxLength: 6000,
      description:
        '个人思考正文，以用户自己的视角自然记录，沿用原始材料的细节和不确定性；不混入聊天角色口吻、助手寒暄或虚构的个人经历。默认短段落，用户明确要求其他文体时遵循其要求。',
    },
    tag: { type: 'string' },
    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
    categoryId: { type: 'string' },
    dueDate: { type: 'string', description: 'YYYY-MM-DD，空字符串表示无截止日期' },
    dueAt: {
      type: 'string',
      description: '可选，带时区的ISO截止时间，例如2026-10-25T18:30:00+08:00；空字符串清除具体时刻',
    },
    done: { type: 'boolean' },
    pinned: { type: 'boolean' },
    name: { type: 'string' },
    focusMinutes: { type: 'integer', minimum: 1, maximum: 180 },
    sound: { type: 'boolean' },
    description: { type: 'string', maxLength: 5000, description: '日程备注' },
    location: { type: 'string', maxLength: 200, description: '日程地点' },
    allDay: {
      type: 'boolean',
      description: '日程是否全天；新建默认 false。切换类型时须给出新类型的完整起止范围。',
    },
    startDate: { type: 'string', description: '全天日程开始日期 YYYY-MM-DD' },
    endDate: { type: 'string', description: '全天日程结束日期 YYYY-MM-DD，包含当天' },
    startAt: {
      type: 'string',
      description: '定时日程开始时间，须带时区的 ISO 日期时间；例如 2026-10-27T15:00:00+08:00',
    },
    endAt: {
      type: 'string',
      description: '定时日程结束时间，须带时区的 ISO 日期时间，并晚于 startAt',
    },
  },
}
const tool = (name, description, properties, required = []) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  },
})
const changeProperties = {
  operation: { type: 'string', enum: [...ASSISTANT_OPERATIONS] },
  id: { type: 'string' },
  fields: fieldsSchema,
  allowDuplicate: {
    type: 'boolean',
    description: '默认false。仅用户明确要求另建完全重复的任务或日程时设为true。',
  },
}
export const WORKSPACE_TOOLS = [
  tool(
    'get_workspace',
    '读取当前任务、日程、分类、笔记目录、文件目录、普通设置、客户端时区及专注状态的有界摘要。详细内容或日期范围通过其他工具读取。',
    {},
  ),
  tool(
    'search_workspace',
    '检索或分页列出任务、日程、笔记和文件。query为空列出所有；返回ID与摘要。按日期查询日程用kind=events和fromDate/toDate，可指定IANA timeZone，默认使用当前客户端时区；日期范围包含两端。',
    {
      query: { type: 'string' },
      kind: { type: 'string', enum: ['all', 'tasks', 'events', 'notes', 'files'] },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
      fromDate: { type: 'string', description: '仅kind=events，查询起始日期 YYYY-MM-DD' },
      toDate: { type: 'string', description: '仅kind=events，查询结束日期 YYYY-MM-DD（含当天）' },
      timeZone: {
        type: 'string',
        description:
          '仅kind=events，可选IANA时区，如Asia/Shanghai；日期查询在未知客户端时区时必须指定',
      },
    },
  ),
  tool(
    'read_workspace_item',
    '按已知ID读取任务、完整日程、笔记正文、5 MB以内的UTF-8文本附件或图片。图片支持PNG/JPEG/WebP/GIF，每轮最多4张，原图会作为视觉输入发送给模型；图片不分页。笔记与文本支持offset/limit分页。不能读取服务器路径、密码或密钥；不支持PDF及其他二进制解析。',
    {
      kind: { type: 'string', enum: ['task', 'event', 'note', 'file'] },
      id: { type: 'string' },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 8000 },
    },
    ['kind', 'id'],
  ),
  tool(
    'propose_workspace_change',
    `仅在用户明确要求修改时准备一项操作。返回待确认卡片；只有用户在界面确认后才执行，不可声称已完成。${changeFieldsDescription}`,
    changeProperties,
    ['operation'],
  ),
  tool(
    'propose_workspace_changes',
    `用户要求从文字、笔记或图片记录多项安排时，优先一次准备完整批次，最多12项；可混合任务与日程。任何一项无效时整批不产生操作卡片，按错误序号修正，缺少时间则先询问用户。重复记录会跳过或复用，时间重叠会提示，不能自行猜测日期、时长、地点。${changeFieldsDescription}`,
    {
      changes: {
        type: 'array',
        minItems: 1,
        maxItems: 12,
        items: {
          type: 'object',
          properties: changeProperties,
          required: ['operation'],
          additionalProperties: false,
        },
      },
    },
    ['changes'],
  ),
]

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, '工具参数应为对象。')
  return value
}
const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_FILES = 4

function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png'
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg'
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp'
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif'
  throw new HttpError(400, '图片格式无效或暂不支持，请使用 PNG、JPEG、WebP 或 GIF 图片。')
}

function page(args, max = 8000, maxOffset = 1_000_000) {
  const offset = args.offset ?? 0,
    limit = args.limit ?? Math.min(4000, max)
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > maxOffset ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > max
  )
    throw new HttpError(400, '分页参数无效。')
  return { offset, limit }
}
function onlyKeys(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new HttpError(400, '包含不支持的工具参数。')
}
function target(items, id) {
  const found = items.find((item) => item.id === id)
  if (!found) throw new HttpError(404, '指定记录不存在，请先检索当前工作台。')
  return found
}
const clip = (text, size) => (text.length > size ? `${text.slice(0, size)}…` : text)

export function createWorkspaceTools(database, storage, { now = Date.now } = {}) {
  database.exec(`CREATE TABLE IF NOT EXISTS prts_assistant_actions (
    id TEXT PRIMARY KEY, operation TEXT NOT NULL, summary TEXT NOT NULL, preview TEXT NOT NULL,
    data TEXT NOT NULL, status TEXT NOT NULL, expires_at INTEGER NOT NULL
  ) STRICT`)
  function workspace() {
    const document = storage.getDocument('workspace')
    if (!document) throw new HttpError(409, '工作台尚未初始化，请先创建工作台。')
    return document
  }
  function overview(timeZone = null) {
    const document = storage.getDocument('workspace')
    const files = storage.listFiles().files
    const focus = storage.getDocument('focus')?.value ?? null
    if (!document)
      return {
        initialized: false,
        currentTime: new Date(now()).toISOString(),
        timeZone,
        calendarEvents: [],
        tasks: [],
        notes: [],
        files: files.slice(0, 10),
        focus,
      }
    const { value, revision } = document
    return {
      currentTime: new Date(now()).toISOString(),
      timeZone,
      revision,
      settings: value.settings,
      focus,
      focusSessions: value.focusSessions,
      counts: {
        tasks: value.tasks.length,
        incompleteTasks: value.tasks.filter((task) => !task.done).length,
        calendarEvents: (value.calendarEvents || []).length,
        notes: value.notes.length,
        files: files.length,
      },
      categories: value.taskCategories,
      tasks: value.tasks.slice(0, 20),
      calendarEvents: (value.calendarEvents || [])
        .slice(0, 10)
        .map(({ description, ...event }) => event),
      notes: value.notes
        .slice(0, 10)
        .map(({ id, title, tag, updatedAt, pinned }) => ({ id, title, tag, updatedAt, pinned })),
      files: files.slice(0, 10),
      truncated: {
        tasks: value.tasks.length > 20,
        calendarEvents: (value.calendarEvents || []).length > 10,
        notes: value.notes.length > 10,
        files: files.length > 10,
      },
    }
  }
  function search(args, timeZone) {
    onlyKeys(args, ['query', 'kind', 'offset', 'limit', 'fromDate', 'toDate', 'timeZone'])
    const { offset, limit } = page({ ...args, limit: args.limit ?? 10 }, 20)
    const query = args.query ?? '',
      kind = args.kind ?? 'all'
    if (
      typeof query !== 'string' ||
      query.length > 200 ||
      !['all', 'tasks', 'events', 'notes', 'files'].includes(kind)
    )
      throw new HttpError(400, '检索条件无效。')
    if (
      kind !== 'events' &&
      ['fromDate', 'toDate', 'timeZone'].some((key) => Object.hasOwn(args, key))
    )
      throw new HttpError(400, '日期范围与时区参数仅支持kind=events的日程查询。')
    const needle = query.toLocaleLowerCase().trim()
    const value = workspace().value
    const items = []
    if (kind === 'all' || kind === 'events')
      for (const { description, ...item } of searchCalendar(
        value.calendarEvents || [],
        args,
        timeZone,
      ))
        items.push({ kind: 'event', ...item, excerpt: clip(description, 600) })
    if (kind === 'all' || kind === 'tasks')
      for (const item of value.tasks) {
        if (!needle || item.title.toLocaleLowerCase().includes(needle))
          items.push({ kind: 'task', ...item })
      }
    if (kind === 'all' || kind === 'notes')
      for (const item of value.notes) {
        const match = `${item.title}\n${item.tag}\n${item.content}`
          .toLocaleLowerCase()
          .indexOf(needle)
        if (!needle || match >= 0) {
          const start = Math.max(0, item.content.toLocaleLowerCase().indexOf(needle) - 100)
          items.push({
            kind: 'note',
            id: item.id,
            title: item.title,
            tag: item.tag,
            excerpt: item.content.slice(start, start + 600),
          })
        }
      }
    if (kind === 'all' || kind === 'files')
      for (const item of storage.listFiles().files) {
        if (!needle || item.name.toLocaleLowerCase().includes(needle))
          items.push({ kind: 'file', ...item })
      }
    return {
      results: items.slice(offset, offset + limit),
      total: items.length,
      hasMore: offset + limit < items.length,
    }
  }
  function read(args, imageFiles) {
    onlyKeys(args, ['kind', 'id', 'offset', 'limit'])
    const { offset, limit } = page(
      args,
      8000,
      args.kind === 'file' ? MAX_TEXT_FILE_BYTES : 1_000_000,
    )
    if (typeof args.id !== 'string' || args.id.length > 200)
      throw new HttpError(400, '记录ID无效。')
    if (args.kind === 'task') return target(workspace().value.tasks, args.id)
    if (args.kind === 'event') return target(workspace().value.calendarEvents || [], args.id)
    let text, metadata
    if (args.kind === 'note') {
      const note = target(workspace().value.notes, args.id)
      const { content, ...rest } = note
      text = content
      metadata = rest
    } else if (args.kind === 'file') {
      const file = target(storage.listFiles().files, args.id)
      if (
        file.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|gif|avif|bmp|svg|ico)$/i.test(file.name)
      ) {
        if (offset !== 0) throw new HttpError(400, '图片不支持分页，请从头读取整张图片。')
        if (file.size > MAX_IMAGE_FILE_BYTES)
          throw new HttpError(400, '图片超过 5 MB，请压缩后重新上传。')
        if (!imageFiles.has(file.id)) {
          if (imageFiles.size >= MAX_IMAGE_FILES)
            throw new HttpError(400, '每轮最多读取 4 张图片，请分次提问。')
          const { bytes } = storage.getFile(file.id)
          const type = imageType(bytes)
          imageFiles.set(file.id, {
            ...file,
            type,
            imageAttached: true,
            imageUrl: `data:${type};base64,${bytes.toString('base64')}`,
          })
        }
        return imageFiles.get(file.id)
      }
      if (file.size > MAX_TEXT_FILE_BYTES)
        throw new HttpError(400, '文本附件超过 5 MB，暂不支持自动读取。')
      if (
        !file.type.startsWith('text/') &&
        !/\.(txt|md|json|csv|tsv|log|js|ts|jsx|tsx|py|yaml|yml|css|html|xml|sql|ini|toml|sh)$/i.test(
          file.name,
        )
      )
        throw new HttpError(400, '该附件为二进制或未支持的类型；可以查看元信息，不能声称已读正文。')
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(storage.getFile(args.id).bytes)
      } catch {
        throw new HttpError(400, '附件不是可读取的 UTF-8 文本。')
      }
      if (text.includes('\0')) throw new HttpError(400, '附件包含二进制内容。')
      metadata = file
    } else throw new HttpError(400, '只支持读取任务、日程、笔记、文本附件和图片。')
    return {
      ...metadata,
      content: text.slice(offset, offset + limit),
      totalCharacters: text.length,
      offset,
      hasMore: offset + limit < text.length,
    }
  }
  function mutation(change, plannedWorkspace) {
    const fields = object(change.fields ?? {})
    if (typeof fields.content === 'string' && fields.content.length > 6000)
      throw new HttpError(400, '单次笔记修改最多 6000 个字符，请拆分操作。')
    const operation = change.operation
    const focusOperation = ['start_focus', 'pause_focus', 'reset_focus'].includes(operation)
    const key = focusOperation ? 'focus' : 'workspace'
    const document = storage.getDocument(key)
    const current = plannedWorkspace ?? workspace().value
    const value = structuredClone(
      (focusOperation ? document?.value : current) ?? {
        remaining: current.settings.focusMinutes * 60,
        endAt: null,
        sessionId: null,
      },
    )
    let summary,
      before = null,
      after = null
    if (focusOperation) {
      onlyKeys(fields, [])
      if (operation === 'start_focus') {
        if (focusRunning(value)) throw new HttpError(400, '专注计时已在运行。')
        Object.assign(
          value,
          toggleFocus(value, current.settings.focusMinutes * 60, now(), randomUUID()),
        )
        summary = '开始专注计时'
      } else if (operation === 'pause_focus') {
        if (!focusRunning(value)) throw new HttpError(400, '专注计时尚未运行。')
        Object.assign(
          value,
          toggleFocus(value, current.settings.focusMinutes * 60, now(), randomUUID()),
        )
        summary = '暂停专注计时'
      } else {
        Object.assign(value, resetFocus(value, current.settings.focusMinutes * 60))
        summary = '重置专注计时'
      }
      before = document?.value
      after = value
    } else if (operation.endsWith('_calendar_event')) {
      const result = changeCalendar(value.calendarEvents || [], change, now())
      value.calendarEvents = result.events
      ;({ before, after, summary } = result)
    } else if (operation.endsWith('_task')) {
      onlyKeys(
        fields,
        operation === 'delete_task'
          ? []
          : ['title', 'priority', 'categoryId', 'dueDate', 'dueAt', 'done'],
      )
      if (operation === 'create_task') {
        if (typeof fields.title !== 'string' || !fields.title.trim())
          throw new HttpError(400, '请提供任务标题。')
        after = {
          id: change.id,
          title: fields.title.trim(),
          priority: 'medium',
          categoryId: '',
          dueDate: '',
          done: false,
          createdAt: new Date(now()).toISOString(),
          ...fields,
        }
        value.tasks.unshift(after)
        if (after.dueAt && !after.dueDate) after.dueDate = after.dueAt.slice(0, 10)
        if (after.dueAt === '') delete after.dueAt
        summary = `新建任务：${after.title}`
      } else {
        const item = target(value.tasks, change.id)
        before = { ...item }
        if (operation === 'delete_task') {
          value.tasks = value.tasks.filter((task) => task.id !== change.id)
          summary = `删除任务：${item.title}`
        } else {
          if (
            Object.hasOwn(fields, 'dueDate') &&
            fields.dueDate !== item.dueDate &&
            !Object.hasOwn(fields, 'dueAt')
          )
            delete item.dueAt
          Object.assign(item, fields)
          if (item.dueAt === '') delete item.dueAt
          after = item
          summary = `更新任务：${item.title}`
        }
      }
    } else if (operation.endsWith('_note')) {
      onlyKeys(fields, operation === 'delete_note' ? [] : ['title', 'content', 'tag', 'pinned'])
      if (operation === 'create_note') {
        if (typeof fields.title !== 'string') throw new HttpError(400, '请提供笔记标题。')
        after = {
          id: change.id,
          title: fields.title,
          content: '',
          tag: '',
          pinned: false,
          ...fields,
          updatedAt: new Date(now()).toISOString(),
        }
        value.notes.unshift(after)
        summary = `新建笔记：${after.title || '无标题'}`
      } else {
        const item = target(value.notes, change.id)
        before = { ...item }
        if (operation === 'delete_note') {
          value.notes = value.notes.filter((note) => note.id !== change.id)
          summary = `删除笔记：${item.title || '无标题'}`
        } else {
          Object.assign(item, fields, { updatedAt: new Date(now()).toISOString() })
          after = item
          summary = `更新笔记：${item.title || '无标题'}`
        }
      }
    } else if (operation.includes('category')) {
      onlyKeys(fields, operation === 'delete_category' ? [] : ['name'])
      before = operation !== 'create_category' ? target(value.taskCategories, change.id) : null
      const updated =
        operation === 'create_category'
          ? createTaskCategory(value, fields.name)
          : operation === 'rename_category'
            ? renameTaskCategory(value, change.id, fields.name)
            : deleteTaskCategory(value, change.id)
      Object.assign(value, updated)
      summary = `${operation === 'create_category' ? '新建' : operation === 'rename_category' ? '重命名' : '删除'}分类：${fields.name || before.name}`
      after =
        operation === 'delete_category'
          ? { explanation: '该分类下的任务将移入未分类，任务会保留。' }
          : { name: fields.name }
    } else if (operation === 'update_settings') {
      onlyKeys(fields, ['name', 'focusMinutes', 'sound'])
      before = { ...value.settings }
      Object.assign(value.settings, fields)
      after = value.settings
      summary = '更新工作台偏好'
    } else throw new HttpError(400, '不支持此操作。')
    if (!focusOperation) {
      value.activities.unshift({
        id: randomUUID(),
        type: 'system',
        text: `AI 辅助：${summary}`,
        time: new Date(now()).toISOString(),
      })
      value.activities = value.activities.slice(0, 200)
      try {
        validateWorkspace(value)
      } catch (error) {
        throw new HttpError(400, error.message)
      }
    }
    const previewItem = (item, isBefore) => {
      if (!item) return ''
      const labels = {
        title: '标题',
        content: '正文',
        tag: '标签',
        priority: '优先级',
        categoryId: '分类',
        dueDate: '截止日期',
        dueAt: '截止时间',
        done: '已完成',
        pinned: '置顶',
        name: '名称',
        focusMinutes: '专注时长（分钟）',
        sound: '完成提示音',
        remaining: '剩余时间',
        mode: '计时模式',
        duration: '本轮时长',
        elapsed: '已专注时间',
        startedAt: '正计时开始于',
        endAt: focusOperation ? '计时结束于' : '结束时间',
        explanation: '说明',
        description: '备注',
        location: '地点',
        allDay: '全天',
        startDate: '开始日期',
        endDate: '结束日期（含当天）',
        startAt: '开始时间',
      }
      return Object.entries(item)
        .filter(([key]) => Object.hasOwn(labels, key))
        .map(([key, val]) => {
          if (key === 'categoryId')
            val = current.taskCategories.find((category) => category.id === val)?.name || '未分类'
          if (key === 'priority') val = { high: '高', medium: '中', low: '低' }[val]
          if (key === 'remaining') val = `${Math.floor(val / 60)} 分 ${val % 60} 秒`
          if (key === 'mode') val = val === 'countup' ? '正计时' : '倒计时'
          if (key === 'duration' || key === 'elapsed') val = formatFocusTime(val)
          if (key === 'startedAt') val = val === null ? '未运行' : new Date(val).toISOString()
          if (key === 'endAt' && focusOperation)
            val = val === null ? '未运行' : new Date(val).toISOString()
          if (typeof val === 'boolean') val = val ? '是' : '否'
          return `${labels[key]}：${clip(String(val ?? ''), isBefore ? 1000 : 6000) || '空'}`
        })
        .join('\n')
    }
    return {
      key,
      value,
      revision: document?.revision ?? 0,
      summary: clip(summary, 500),
      preview: clip(
        [
          before ? `当前内容\n${previewItem(before, true)}` : '',
          after ? `确认后\n${previewItem(after, false)}` : '确认后将删除上述记录。',
        ]
          .filter(Boolean)
          .join('\n\n'),
        8000,
      ),
      record: ['create_task', 'create_calendar_event'].includes(operation) ? after : null,
    }
  }
  function publicAction(row) {
    const warnings = JSON.parse(row.data).warnings
    return {
      id: row.id,
      operation: row.operation,
      summary: row.summary,
      preview: row.preview,
      status: row.status === 'pending' && row.expires_at <= now() ? 'expired' : row.status,
      expiresAt: row.expires_at,
      ...(warnings?.length ? { warnings } : {}),
    }
  }
  function guard(change) {
    const value = workspace().value
    let relevant
    if (change.operation.endsWith('_calendar_event'))
      relevant = value.calendarEvents?.find((item) => item.id === change.id) ?? null
    else if (change.operation.endsWith('_task'))
      relevant = value.tasks.find((item) => item.id === change.id) ?? null
    else if (change.operation.endsWith('_note'))
      relevant = value.notes.find((item) => item.id === change.id) ?? null
    else if (change.operation.includes('category')) {
      relevant =
        change.operation === 'create_category'
          ? null
          : {
              category: value.taskCategories.find((item) => item.id === change.id) ?? null,
              assignments: value.tasks
                .filter((item) => item.categoryId === change.id)
                .map((item) => item.id)
                .sort(),
            }
    } else if (change.operation === 'update_settings') relevant = value.settings
    else relevant = storage.getDocument('focus')?.value ?? null
    return createHash('sha256').update(JSON.stringify(relevant)).digest('hex')
  }
  function action(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
      throw new HttpError(400, '操作ID无效。')
    const row = database.prepare('SELECT * FROM prts_assistant_actions WHERE id = ?').get(id)
    if (!row) throw new HttpError(404, '该操作不存在或已过期，请重新发起请求。')
    return row
  }
  function prepare(args, { records = [], timeZone = null, plannedWorkspace } = {}) {
    object(args)
    onlyKeys(args, ['operation', 'id', 'fields', 'allowDuplicate'])
    if (!ASSISTANT_OPERATIONS.includes(args.operation)) throw new HttpError(400, '不支持此操作。')
    if (args.allowDuplicate !== undefined && typeof args.allowDuplicate !== 'boolean')
      throw new HttpError(400, '重复创建选项须为布尔值。')
    const change = {
      operation: args.operation,
      id: args.operation.startsWith('create_') ? randomUUID() : args.id,
      fields: args.fields ?? {},
      ...(args.allowDuplicate ? { allowDuplicate: true } : {}),
    }
    return storage.atomic(() => {
      const preview = mutation(change, plannedWorkspace)
      const planned = plannedWorkspace ?? workspace().value
      if (preview.record && !args.allowDuplicate) {
        const existing =
          planned[args.operation === 'create_task' ? 'tasks' : 'calendarEvents'] || []
        const duplicate = existing.find((item) => sameCapture(args.operation, preview.record, item))
        if (duplicate) {
          const pending = records.find(
            (item) =>
              item.record.id === duplicate.id &&
              publicAction(action(item.actionId)).status === 'pending',
          )
          return {
            ...(pending ? { action: publicAction(action(pending.actionId)) } : {}),
            duplicateRecord: { operation: args.operation, record: duplicate },
            skipped: {
              reason: pending
                ? '本轮已准备相同安排，已复用操作卡片。'
                : '已有相同任务或日程，未重复创建；如需修改请使用对应更新操作。',
              id: pending?.actionId ?? duplicate.id,
              title: duplicate.title,
            },
          }
        }
      }
      const warnings =
        args.operation === 'create_calendar_event'
          ? captureWarnings(preview.record, planned.calendarEvents || [], timeZone)
          : []
      const id = randomUUID(),
        expiresAt = now() + actionLifetime
      database
        .prepare('DELETE FROM prts_assistant_actions WHERE expires_at < ?')
        .run(now() - 24 * 60 * 60_000)
      if (
        database.prepare('SELECT COUNT(*) AS count FROM prts_assistant_actions').get().count >= 1000
      )
        throw new HttpError(429, '操作记录过多，请稍后重试。')
      database.prepare('INSERT INTO prts_assistant_actions VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id,
        args.operation,
        preview.summary,
        preview.preview,
        JSON.stringify({
          change,
          key: preview.key,
          revision: preview.revision,
          guard: guard(change),
          ...(warnings.length ? { warnings } : {}),
        }),
        'pending',
        expiresAt,
      )
      return {
        action: publicAction(action(id)),
        record: preview.record,
        ...(preview.key === 'workspace' ? { plannedWorkspace: preview.value } : {}),
      }
    })
  }
  function actionIds(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 12 || new Set(ids).size !== ids.length)
      throw new HttpError(400, '每批应包含 1 至 12 个不重复的操作ID。')
    return ids.map((id) => action(id))
  }
  function getActions(ids) {
    return actionIds(ids).map(publicAction)
  }
  function decideBatch(ids, decision) {
    if (!['apply', 'dismiss'].includes(decision)) throw new HttpError(400, '操作选项无效。')
    return storage.atomic(() => {
      const rows = actionIds(ids)
      const pending = rows.filter(
        (row) =>
          row.status !== 'applied' && !(decision === 'dismiss' && row.status === 'dismissed'),
      )
      // Compare every guard against the original state before applying ordered edits.
      for (const row of pending) {
        if (row.status !== 'pending' || row.expires_at <= now())
          throw new HttpError(409, '该批次包含已取消或过期的操作，请重新发起请求。')
        if (
          decision === 'apply' &&
          guard(JSON.parse(row.data).change) !== JSON.parse(row.data).guard
        )
          throw new HttpError(409, '工作台数据已变化，请让 AI 重新读取并准备操作，当前数据未覆盖。')
      }
      for (const row of pending) {
        if (decision === 'apply') {
          const saved = JSON.parse(row.data).change
          const change = mutation(saved)
          if (change.record && !saved.allowDuplicate) {
            const existing =
              workspace().value[saved.operation === 'create_task' ? 'tasks' : 'calendarEvents'] ||
              []
            if (existing.some((item) => sameCapture(saved.operation, change.record, item)))
              throw new HttpError(409, '相同任务或日程已存在，本批次未写入，请重新核对。')
          }
          storage.putDocument(change.key, {
            value: change.value,
            expectedRevision: change.revision,
            mutationId: `assistant-${row.id}`,
          })
        }
        database
          .prepare('UPDATE prts_assistant_actions SET status = ? WHERE id = ?')
          .run(decision === 'apply' ? 'applied' : 'dismissed', row.id)
      }
      return { actions: getActions(ids) }
    })
  }
  function decide(id, decision) {
    return { action: decideBatch([id], decision).actions[0] }
  }
  function session({ timeZone = null } = {}) {
    const actions = [],
      toolsUsed = [],
      imageFiles = new Map(),
      records = [],
      skippedRecords = []
    function prepareBatch(changes) {
      if (!Array.isArray(changes) || !changes.length || changes.length > 12)
        throw new HttpError(400, '每批应包含 1 至 12 项操作。')
      const nextRecords = [...records]
      const nextSkipped = [...skippedRecords]
      const prepared = [],
        skipped = []
      storage.atomic(() => {
        let plannedWorkspace = workspace().value
        // Rebuild the preview from current data and this request's earlier
        // proposals. Nothing is written until the user confirms the plan.
        for (const item of actions) {
          const row = action(item.id)
          if (publicAction(row).status !== 'pending') continue
          const previous = mutation(JSON.parse(row.data).change, plannedWorkspace)
          if (previous.key === 'workspace') plannedWorkspace = previous.value
        }
        for (let index = 0; index < changes.length; index++) {
          try {
            const result = prepare(changes[index], {
              records: nextRecords,
              timeZone,
              plannedWorkspace,
            })
            if (result.plannedWorkspace) plannedWorkspace = result.plannedWorkspace
            if (result.duplicateRecord) nextSkipped.push(result.duplicateRecord)
            if (result.skipped) skipped.push({ index: index + 1, ...result.skipped })
            if (result.action && !prepared.some((item) => item.id === result.action.id)) {
              prepared.push(result.action)
              if (result.record)
                nextRecords.push({
                  operation: changes[index].operation,
                  record: result.record,
                  actionId: result.action.id,
                })
            }
            if (new Set([...actions, ...prepared].map((item) => item.id)).size > 12)
              throw new HttpError(400, '每轮最多准备 12 项操作，请分次录入。')
          } catch (error) {
            if (error instanceof HttpError)
              throw new HttpError(error.status, `第 ${index + 1} 项：${error.message}`)
            throw error
          }
        }
        // A skipped create is safe only while its material is still represented
        // in the final preview, including changes proposed by later tool calls.
        for (const skipped of nextSkipped) {
          const items =
            plannedWorkspace[skipped.operation === 'create_task' ? 'tasks' : 'calendarEvents'] || []
          if (!items.some((item) => sameCapture(skipped.operation, skipped.record, item)))
            throw new HttpError(
              400,
              `本批修改会移除先前作为重复项跳过的「${skipped.record.title}」。请按先修改或删除、再新建的顺序重新整批准备，当前批次未产生操作卡片。`,
            )
        }
      })
      records.splice(0, records.length, ...nextRecords)
      skippedRecords.splice(0, skippedRecords.length, ...nextSkipped)
      for (const item of prepared)
        if (!actions.some((action) => action.id === item.id)) actions.push(item)
      return {
        actions: prepared,
        skipped,
        requiresConfirmation: !autoConfirm && prepared.length > 0,
        ...(autoConfirm ? { execution: 'after_reply' } : {}),
      }
    }
    const autoConfirm = storage.getDocument('preferences')?.value.assistantAutoConfirm === true
    return {
      autoConfirm,
      definitions: WORKSPACE_TOOLS.map((tool) =>
        ['propose_workspace_change', 'propose_workspace_changes'].includes(tool.function.name) &&
        autoConfirm
          ? {
              ...tool,
              function: {
                ...tool.function,
                description: `${tool.function.description} 用户已开启自动确认：所有准备成功的操作将在最终回复生成后作为一个事务自动执行，无需要求手动确认。当前尚未写入，不要提前声称完成。`,
              },
            }
          : tool,
      ),
      actions,
      toolsUsed,
      finalize() {
        if (!actions.length) return {}
        const ids = actions.map((item) => item.id)
        try {
          return storage.atomic(() => {
            if (
              !autoConfirm ||
              storage.getDocument('preferences')?.value.assistantAutoConfirm !== true
            )
              return { actions: getActions(ids), actionConfirmation: 'manual' }
            return { ...decideBatch(ids, 'apply'), actionConfirmation: 'automatic' }
          })
        } catch (error) {
          return {
            actions: getActions(ids),
            actionConfirmation: 'manual',
            actionError:
              error instanceof HttpError
                ? `自动确认未执行：${error.message}`
                : '自动确认未执行，整批修改已回滚，请检查后重试。',
          }
        }
      },
      execute(name, rawArgs) {
        let result
        try {
          if (typeof rawArgs !== 'string' || rawArgs.length > 24_000)
            throw new HttpError(400, '工具参数过大或无效。')
          let args
          try {
            args = object(JSON.parse(rawArgs))
          } catch {
            throw new HttpError(400, '工具参数不是有效的JSON对象。')
          }
          if (name === 'get_workspace') {
            onlyKeys(args, [])
            result = overview(timeZone)
          } else if (name === 'search_workspace') result = search(args, timeZone)
          else if (name === 'read_workspace_item') result = read(args, imageFiles)
          else if (name === 'propose_workspace_change') {
            const batch = prepareBatch([args])
            result = {
              ...batch,
              ...(batch.actions[0] ? { action: batch.actions[0] } : {}),
            }
          } else if (name === 'propose_workspace_changes') {
            onlyKeys(args, ['changes'])
            result = prepareBatch(args.changes)
          } else throw new HttpError(400, '该工具不可用。')
          toolsUsed.push({ name, status: 'ok' })
          return result
        } catch (error) {
          toolsUsed.push({ name: String(name).slice(0, 80), status: 'error' })
          return {
            error: error instanceof HttpError ? error.message : '工具操作无效，请核对参数。',
          }
        }
      },
    }
  }
  return {
    overview,
    session,
    getAction: (id) => publicAction(action(id)),
    getActions,
    decide,
    decideBatch,
  }
}
