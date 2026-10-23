import { createHash, randomUUID } from 'node:crypto'
import { HttpError } from './errors.mjs'
import { validateWorkspace } from '../src/lib/workspace.ts'
import {
  createTaskCategory,
  renameTaskCategory,
  deleteTaskCategory,
} from '../src/lib/taskCategories.ts'
import { ASSISTANT_OPERATIONS } from '../src/lib/assistantTools.ts'

const actionLifetime = 30 * 60_000
const fieldsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    content: { type: 'string' },
    tag: { type: 'string' },
    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
    categoryId: { type: 'string' },
    dueDate: { type: 'string', description: 'YYYY-MM-DD，空字符串表示无截止日期' },
    done: { type: 'boolean' },
    pinned: { type: 'boolean' },
    name: { type: 'string' },
    focusMinutes: { type: 'integer', minimum: 1, maximum: 180 },
    sound: { type: 'boolean' },
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
export const WORKSPACE_TOOLS = [
  tool(
    'get_workspace',
    '读取当前任务、分类、笔记目录、文件目录、普通设置及专注状态的有界摘要。详细内容通过其他工具读取。',
    {},
  ),
  tool(
    'search_workspace',
    '检索或分页列出工作台任务、笔记和文件。query为空列出所有；返回记录ID，笔记仅返回摘要。',
    {
      query: { type: 'string' },
      kind: { type: 'string', enum: ['all', 'tasks', 'notes', 'files'] },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
  ),
  tool(
    'read_workspace_item',
    '按已知ID读取任务、笔记正文或UTF-8文本附件；支持offset/limit分页。不能读取服务器路径、密码或密钥；不支持PDF/二进制解析。',
    {
      kind: { type: 'string', enum: ['task', 'note', 'file'] },
      id: { type: 'string' },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 8000 },
    },
    ['kind', 'id'],
  ),
  tool(
    'propose_workspace_change',
    '仅在用户明确要求修改时准备一项操作。返回待确认卡片；只有用户在界面确认后才执行，不可声称已完成。创建任务须title；修改/删除须id；分类须name；笔记正文用content；普通设置只支持name/focusMinutes/sound。',
    {
      operation: { type: 'string', enum: [...ASSISTANT_OPERATIONS] },
      id: { type: 'string' },
      fields: fieldsSchema,
    },
    ['operation'],
  ),
]

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, '工具参数应为对象。')
  return value
}
function page(args, max = 8000) {
  const offset = args.offset ?? 0,
    limit = args.limit ?? Math.min(4000, max)
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 1_000_000 ||
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
  function overview() {
    const document = storage.getDocument('workspace')
    const files = storage.listFiles().files
    const focus = storage.getDocument('focus')?.value ?? null
    if (!document)
      return {
        initialized: false,
        currentTime: new Date(now()).toISOString(),
        tasks: [],
        notes: [],
        files: files.slice(0, 10),
        focus,
      }
    const { value, revision } = document
    return {
      currentTime: new Date(now()).toISOString(),
      revision,
      settings: value.settings,
      focus,
      focusSessions: value.focusSessions,
      counts: {
        tasks: value.tasks.length,
        incompleteTasks: value.tasks.filter((task) => !task.done).length,
        notes: value.notes.length,
        files: files.length,
      },
      categories: value.taskCategories,
      tasks: value.tasks.slice(0, 20),
      notes: value.notes
        .slice(0, 10)
        .map(({ id, title, tag, updatedAt, pinned }) => ({ id, title, tag, updatedAt, pinned })),
      files: files.slice(0, 10),
      truncated: {
        tasks: value.tasks.length > 20,
        notes: value.notes.length > 10,
        files: files.length > 10,
      },
    }
  }
  function search(args) {
    onlyKeys(args, ['query', 'kind', 'offset', 'limit'])
    const { offset, limit } = page({ ...args, limit: args.limit ?? 10 }, 20)
    const query = args.query ?? '',
      kind = args.kind ?? 'all'
    if (
      typeof query !== 'string' ||
      query.length > 200 ||
      !['all', 'tasks', 'notes', 'files'].includes(kind)
    )
      throw new HttpError(400, '检索条件无效。')
    const needle = query.toLocaleLowerCase().trim()
    const value = workspace().value
    const items = []
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
  function read(args) {
    onlyKeys(args, ['kind', 'id', 'offset', 'limit'])
    const { offset, limit } = page(args)
    if (typeof args.id !== 'string' || args.id.length > 200)
      throw new HttpError(400, '记录ID无效。')
    if (args.kind === 'task') return target(workspace().value.tasks, args.id)
    let text, metadata
    if (args.kind === 'note') {
      const note = target(workspace().value.notes, args.id)
      const { content, ...rest } = note
      text = content
      metadata = rest
    } else if (args.kind === 'file') {
      const file = target(storage.listFiles().files, args.id)
      if (file.size > 2 * 1024 * 1024)
        throw new HttpError(400, '文本附件超过 2 MB，暂不支持自动读取。')
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
    } else throw new HttpError(400, '只支持读取任务、笔记和文本附件。')
    return {
      ...metadata,
      content: text.slice(offset, offset + limit),
      totalCharacters: text.length,
      offset,
      hasMore: offset + limit < text.length,
    }
  }
  function mutation(change) {
    const fields = object(change.fields ?? {})
    if (typeof fields.content === 'string' && fields.content.length > 6000)
      throw new HttpError(400, '单次笔记修改最多 6000 个字符，请拆分操作。')
    const operation = change.operation
    const focusOperation = ['start_focus', 'pause_focus', 'reset_focus'].includes(operation)
    const key = focusOperation ? 'focus' : 'workspace'
    const document = storage.getDocument(key)
    const current = workspace().value
    const value = structuredClone(
      document?.value ?? {
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
        if (value.endAt !== null) throw new HttpError(400, '专注计时已在运行。')
        if (!value.remaining) {
          value.remaining = current.settings.focusMinutes * 60
          value.sessionId = randomUUID()
        }
        value.sessionId ||= randomUUID()
        value.endAt = now() + value.remaining * 1000
        summary = '开始专注计时'
      } else if (operation === 'pause_focus') {
        if (value.endAt === null) throw new HttpError(400, '专注计时尚未运行。')
        value.remaining = Math.max(0, Math.ceil((value.endAt - now()) / 1000))
        value.endAt = null
        summary = '暂停专注计时'
      } else {
        value.remaining = current.settings.focusMinutes * 60
        value.endAt = null
        value.sessionId = null
        summary = '重置专注计时'
      }
      before = document?.value
      after = value
    } else if (operation.endsWith('_task')) {
      onlyKeys(
        fields,
        operation === 'delete_task' ? [] : ['title', 'priority', 'categoryId', 'dueDate', 'done'],
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
        summary = `新建任务：${after.title}`
      } else {
        const item = target(value.tasks, change.id)
        before = { ...item }
        if (operation === 'delete_task') {
          value.tasks = value.tasks.filter((task) => task.id !== change.id)
          summary = `删除任务：${item.title}`
        } else {
          Object.assign(item, fields)
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
        done: '已完成',
        pinned: '置顶',
        name: '名称',
        focusMinutes: '专注时长（分钟）',
        sound: '完成提示音',
        remaining: '剩余时间',
        endAt: '计时结束于',
        explanation: '说明',
      }
      return Object.entries(item)
        .filter(([key]) => Object.hasOwn(labels, key))
        .map(([key, val]) => {
          if (key === 'categoryId')
            val = current.taskCategories.find((category) => category.id === val)?.name || '未分类'
          if (key === 'priority') val = { high: '高', medium: '中', low: '低' }[val]
          if (key === 'remaining') val = `${Math.floor(val / 60)} 分 ${val % 60} 秒`
          if (key === 'endAt') val = val === null ? '未运行' : new Date(val).toISOString()
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
    }
  }
  function publicAction(row) {
    return {
      id: row.id,
      operation: row.operation,
      summary: row.summary,
      preview: row.preview,
      status: row.status === 'pending' && row.expires_at <= now() ? 'expired' : row.status,
      expiresAt: row.expires_at,
    }
  }
  function guard(change) {
    const value = workspace().value
    let relevant
    if (change.operation.endsWith('_task'))
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
  function prepare(args) {
    onlyKeys(args, ['operation', 'id', 'fields'])
    if (!ASSISTANT_OPERATIONS.includes(args.operation)) throw new HttpError(400, '不支持此操作。')
    const change = {
      operation: args.operation,
      id: args.operation.startsWith('create_') ? randomUUID() : args.id,
      fields: args.fields ?? {},
    }
    return storage.atomic(() => {
      const preview = mutation(change)
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
        }),
        'pending',
        expiresAt,
      )
      return publicAction(action(id))
    })
  }
  function decide(id, decision) {
    if (!['apply', 'dismiss'].includes(decision)) throw new HttpError(400, '操作选项无效。')
    return storage.atomic(() => {
      const row = action(id)
      if (row.status === 'applied') return { action: publicAction(row) }
      if (row.status !== 'pending' || row.expires_at <= now())
        throw new HttpError(409, '该操作已取消或过期，请重新发起请求。')
      if (decision === 'apply') {
        const saved = JSON.parse(row.data)
        if (guard(saved.change) !== saved.guard)
          throw new HttpError(409, '工作台数据已变化，请让 AI 重新读取并准备操作，当前数据未覆盖。')
        const change = mutation(saved.change)
        storage.putDocument(change.key, {
          value: change.value,
          expectedRevision: change.revision,
          mutationId: `assistant-${id}`,
        })
      }
      database
        .prepare('UPDATE prts_assistant_actions SET status = ? WHERE id = ?')
        .run(decision === 'apply' ? 'applied' : 'dismissed', id)
      return { action: publicAction(action(id)) }
    })
  }
  function session() {
    const actions = [],
      toolsUsed = []
    return {
      definitions: WORKSPACE_TOOLS,
      actions,
      toolsUsed,
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
            result = overview()
          } else if (name === 'search_workspace') result = search(args)
          else if (name === 'read_workspace_item') result = read(args)
          else if (name === 'propose_workspace_change') {
            const proposed = prepare(args)
            actions.push(proposed)
            result = { action: proposed, requiresConfirmation: true }
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
  return { overview, session, getAction: (id) => publicAction(action(id)), decide }
}
