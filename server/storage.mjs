import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { HttpError } from './errors.mjs'
import { parseAssistantActions, parseToolUsage } from '../src/lib/assistantTools.ts'
import { validateWorkspace } from '../src/lib/workspace.ts'
import { parseKnowledgeResults } from '../src/lib/assistant.ts'

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_TOTAL_FILE_BYTES = 100 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const DOCUMENT_KEYS = ['workspace', 'preferences', 'focus']
const RASTER_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
])

function invalid(message) {
  throw new HttpError(400, message)
}
function text(value, label, max, allowEmpty = false) {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && !value.trim()) ||
    value.length > max ||
    value.includes('\0')
  )
    invalid(`${label}格式无效。`)
  return value
}
function id(value, label = 'ID') {
  const result = text(value, label, 200)
  if (result === '.' || result === '..' || /[\x00-\x20/\\]/.test(result))
    invalid(`${label}格式无效。`)
  return result
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('数据应为有效对象。')
  return value
}
function isoDate(value) {
  const result = text(value, '创建时间', 40)
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result)))
    invalid('创建时间格式无效。')
  return result
}
function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}
function jsonDocument(row) {
  return row ? { value: JSON.parse(row.data), revision: row.revision } : null
}

function validateDocument(key, value) {
  if (!DOCUMENT_KEYS.includes(key)) throw new HttpError(404, '此存储项目不存在。')
  object(value)
  if (key === 'workspace') {
    try {
      return validateWorkspace(value)
    } catch (error) {
      invalid(error.message)
    }
  }
  if (key === 'preferences') {
    const assistant = object(value.assistant)
    if (
      typeof value.motionEnabled !== 'boolean' ||
      !['local', 'ai', 'knowledge'].includes(value.assistantMode) ||
      !['prts', 'amiya', 'kaltsit'].includes(assistant.persona) ||
      !['all', 'arknights', 'endfield', 'none'].includes(assistant.knowledge)
    )
      invalid('个人偏好格式无效。')
    const result = {
      motionEnabled: value.motionEnabled,
      assistant: { persona: assistant.persona, knowledge: assistant.knowledge },
      assistantMode: value.assistantMode,
    }
    if (value.migratedBrowserIds !== undefined) {
      if (!Array.isArray(value.migratedBrowserIds) || value.migratedBrowserIds.length > 100)
        invalid('浏览器迁移记录格式无效。')
      result.migratedBrowserIds = [
        ...new Set(value.migratedBrowserIds.map((value) => id(value, '迁移 ID'))),
      ]
    }
    return result
  }
  if (
    !Number.isFinite(value.remaining) ||
    value.remaining < 0 ||
    value.remaining > 10800 ||
    (value.endAt !== null && (!Number.isSafeInteger(value.endAt) || value.endAt <= 0)) ||
    (value.sessionId !== null && typeof value.sessionId !== 'string')
  )
    invalid('专注计时格式无效。')
  const sessionId = value.sessionId === null ? null : id(value.sessionId, '专注会话 ID')
  if (value.endAt !== null && sessionId === null) invalid('运行中的专注计时需要会话 ID。')
  return { remaining: value.remaining, endAt: value.endAt, sessionId }
}

function validateMessage(value) {
  object(value)
  if (
    !['user', 'assistant'].includes(value.role) ||
    !['local', 'ai'].includes(value.mode) ||
    value.pending
  )
    invalid('聊天消息格式无效或尚未完成。')
  const result = {
    id: id(value.id, '消息 ID'),
    role: value.role,
    content: text(value.content, '消息内容', 100_000),
    mode: value.mode,
  }
  if (value.persona !== undefined) {
    if (!['prts', 'amiya', 'kaltsit'].includes(value.persona)) invalid('消息性格格式无效。')
    result.persona = value.persona
  }
  if (value.sources !== undefined) {
    if (!Array.isArray(value.sources) || value.sources.length > 12) invalid('消息引用格式无效。')
    result.sources = parseKnowledgeResults(value.sources)
    if (result.sources.length !== value.sources.length) invalid('消息引用格式无效。')
  }
  try {
    if (value.actions !== undefined) result.actions = parseAssistantActions(value.actions)
    if (value.toolsUsed !== undefined) result.toolsUsed = parseToolUsage(value.toolsUsed)
  } catch {
    invalid('消息工具记录格式无效。')
  }
  return result
}

/** Transactions contain no awaits: BEGIN IMMEDIATE serializes competing connections. */
export function createStorage(
  db,
  {
    uploadsDir,
    now = Date.now,
    maxFileBytes = MAX_FILE_BYTES,
    maxTotalFileBytes = MAX_TOTAL_FILE_BYTES,
  } = {},
) {
  const temporaryUploads = uploadsDir === undefined
  const directory = uploadsDir || mkdtempSync(path.join(os.tmpdir(), 'prts-uploads-'))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const uploadRoot = realpathSync(directory)

  function diskPath(key) {
    if (typeof key !== 'string' || !/^[a-f0-9-]{36}\.bin$/.test(key))
      throw new HttpError(500, '文件存储记录异常。')
    return path.join(uploadRoot, key)
  }
  function removeDiskFile(key) {
    try {
      unlinkSync(diskPath(key))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  function writeDiskFile(bytes) {
    const key = `${randomUUID()}.bin`
    const destination = diskPath(key)
    const temporary = path.join(uploadRoot, `.upload-${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 })
      renameSync(temporary, destination)
      return key
    } catch (error) {
      try {
        unlinkSync(temporary)
      } catch {
        /* no published file exists */
      }
      throw error
    }
  }
  function readDiskFile(row) {
    let descriptor
    try {
      descriptor = openSync(diskPath(row.disk_key), constants.O_RDONLY | constants.O_NOFOLLOW)
      const stat = fstatSync(descriptor)
      if (!stat.isFile() || stat.size !== row.size) throw new Error('Invalid file size')
      const bytes = readFileSync(descriptor)
      if (hash(bytes) !== row.sha256) throw new Error('Invalid file checksum')
      return bytes
    } catch {
      throw new HttpError(500, '文件内容缺失或校验失败，请从备份恢复上传目录。')
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
    }
  }
  function cleanupDeletedFiles() {
    for (const row of db.prepare('SELECT disk_key FROM prts_upload_gc').all()) {
      // Never delete a path that another metadata record still references.
      if (db.prepare('SELECT 1 FROM prts_files WHERE disk_key=?').get(row.disk_key)) continue
      try {
        removeDiskFile(row.disk_key)
        db.prepare('DELETE FROM prts_upload_gc WHERE disk_key=?').run(row.disk_key)
      } catch {
        /* Persist the cleanup job and retry after the next mutation or restart. */
      }
    }
  }
  let transactionDepth = 0
  function transaction(callback) {
    const savepoint = `prts_store_${transactionDepth}`
    const nested = transactionDepth > 0
    db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE')
    transactionDepth += 1
    try {
      const result = callback()
      db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT')
      return result
    } catch (error) {
      db.exec(nested ? `ROLLBACK TO SAVEPOINT ${savepoint}` : 'ROLLBACK')
      if (nested) db.exec(`RELEASE SAVEPOINT ${savepoint}`)
      throw error
    } finally {
      transactionDepth -= 1
    }
  }
  // Preserve any files written by the earlier development schema before dropping its BLOB column.
  if (
    db
      .prepare('PRAGMA table_info(prts_files)')
      .all()
      .some((column) => column.name === 'data')
  ) {
    const published = []
    try {
      transaction(() => {
        db.exec(`CREATE TABLE prts_files_disk (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
          size INTEGER NOT NULL CHECK(size >= 0), created_at TEXT NOT NULL,
          sha256 TEXT NOT NULL, disk_key TEXT NOT NULL UNIQUE
        ) STRICT`)
        for (const row of db.prepare('SELECT * FROM prts_files').all()) {
          const bytes = Buffer.from(row.data)
          if (bytes.length !== row.size || hash(bytes) !== row.sha256)
            throw new Error('Existing file failed integrity validation')
          const key = writeDiskFile(bytes)
          published.push(key)
          db.prepare(
            'INSERT INTO prts_files_disk (id,name,type,size,created_at,sha256,disk_key) VALUES (?,?,?,?,?,?,?)',
          ).run(row.id, row.name, row.type, row.size, row.created_at, row.sha256, key)
        }
        db.exec('DROP TABLE prts_files; ALTER TABLE prts_files_disk RENAME TO prts_files')
      })
    } catch (error) {
      for (const key of published) {
        try {
          removeDiskFile(key)
        } catch {
          /* Preserve the original error. */
        }
      }
      throw error
    }
  }
  cleanupDeletedFiles()
  const selectDocument = db.prepare('SELECT data, revision FROM prts_documents WHERE key = ?')
  function getDocument(key) {
    return jsonDocument(selectDocument.get(key))
  }
  function getState() {
    const documents = Object.fromEntries(DOCUMENT_KEYS.map((key) => [key, null]))
    for (const row of db.prepare('SELECT key, data, revision FROM prts_documents').all())
      documents[row.key] = jsonDocument(row)
    return { documents }
  }
  function writeDocument(key, value, revision) {
    db.prepare(
      'INSERT INTO prts_documents (key,data,revision,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated_at=excluded.updated_at',
    ).run(key, JSON.stringify(value), revision, new Date(now()).toISOString())
    return { value, revision }
  }
  function putDocument(key, payload) {
    object(payload)
    const value = validateDocument(key, payload.value)
    const serialized = JSON.stringify(value)
    if (Buffer.byteLength(serialized) > MAX_DOCUMENT_BYTES)
      throw new HttpError(413, '单个存储项目不能超过 10 MB。')
    if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0)
      invalid('存储版本号无效。')
    const mutationId = id(payload.mutationId, '保存操作 ID')
    const requestHash = hash(`${payload.expectedRevision}\n${serialized}`)
    return transaction(() => {
      const previous = db
        .prepare('SELECT request_hash, revision FROM prts_mutations WHERE key=? AND mutation_id=?')
        .get(key, mutationId)
      if (previous) {
        if (previous.request_hash !== requestHash)
          throw new HttpError(409, '此保存操作已用于其他内容，请重新加载后重试。')
        return { value, revision: previous.revision }
      }
      const current = getDocument(key)
      if ((current?.revision ?? 0) !== payload.expectedRevision)
        throw new HttpError(
          409,
          '服务器数据已被其他页面修改。请先保留当前草稿，再重新加载服务器数据。',
        )
      const revision = payload.expectedRevision + 1
      const result = writeDocument(key, value, revision)
      db.prepare(
        'INSERT INTO prts_mutations (key,mutation_id,request_hash,revision) VALUES (?,?,?,?)',
      ).run(key, mutationId, requestHash, revision)
      db.prepare(
        'DELETE FROM prts_mutations WHERE key=? AND rowid NOT IN (SELECT rowid FROM prts_mutations WHERE key=? ORDER BY rowid DESC LIMIT 200)',
      ).run(key, key)
      return result
    })
  }
  function importDocuments(payload) {
    object(payload)
    const supplied = object(payload.documents)
    const expected = object(payload.expectedRevisions)
    if (
      !Object.hasOwn(supplied, 'preferences') ||
      Object.keys(supplied).some((key) => !DOCUMENT_KEYS.includes(key))
    )
      invalid('导入数据需要个人偏好，且只能包含工作台、个人偏好和专注状态。')
    const values = {},
      expectedRevisions = {}
    for (const key of DOCUMENT_KEYS) {
      if (!Number.isSafeInteger(expected[key]) || expected[key] < 0) invalid('导入版本号无效。')
      expectedRevisions[key] = expected[key]
      if (Object.hasOwn(supplied, key)) values[key] = validateDocument(key, supplied[key])
    }
    if (Buffer.byteLength(JSON.stringify(values)) > MAX_DOCUMENT_BYTES)
      throw new HttpError(413, '导入数据不能超过 10 MB。')
    const mutationId = id(payload.mutationId, '导入操作 ID')
    const requestHash = hash(JSON.stringify({ documents: values, expectedRevisions }))
    return transaction(() => {
      const previous = db
        .prepare('SELECT request_hash FROM prts_imports WHERE mutation_id=?')
        .get(mutationId)
      if (previous) {
        if (previous.request_hash !== requestHash)
          throw new HttpError(409, '此导入操作已用于其他内容，请重新发起导入。')
        return getState()
      }
      const current = getState().documents
      for (const key of DOCUMENT_KEYS) {
        if ((current[key]?.revision || 0) !== expectedRevisions[key])
          throw new HttpError(
            409,
            '服务器数据已变化，整次导入未覆盖任何工作台、偏好或专注状态。请重新载入后确认。',
          )
      }
      for (const key of DOCUMENT_KEYS) {
        if (Object.hasOwn(values, key)) writeDocument(key, values[key], expectedRevisions[key] + 1)
      }
      db.prepare('INSERT INTO prts_imports (mutation_id,request_hash) VALUES (?,?)').run(
        mutationId,
        requestHash,
      )
      return getState()
    })
  }
  function appendMessages(messages) {
    if (!Array.isArray(messages) || messages.length > 100) invalid('每次最多保存 100 条聊天消息。')
    const parsed = messages.map(validateMessage)
    if (Buffer.byteLength(JSON.stringify(parsed)) > MAX_DOCUMENT_BYTES)
      throw new HttpError(413, '聊天内容过大。')
    return transaction(() => {
      for (const value of parsed) {
        const serialized = JSON.stringify(value)
        const old = db.prepare('SELECT data FROM prts_messages WHERE id=?').get(value.id)
        if (old) {
          if (old.data !== serialized)
            throw new HttpError(409, '已有消息内容不同，未覆盖聊天记录。')
        } else
          db.prepare('INSERT INTO prts_messages (id,data,created_at) VALUES (?,?,?)').run(
            value.id,
            serialized,
            new Date(now()).toISOString(),
          )
      }
      return { saved: parsed.length }
    })
  }
  function listMessages({ limit = 60, before } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid('消息条数应为 1 至 100。')
    let sequence = Number.MAX_SAFE_INTEGER
    if (before !== undefined && before !== null && before !== '') {
      const row = db
        .prepare('SELECT sequence FROM prts_messages WHERE id=?')
        .get(id(before, '分页消息 ID'))
      if (!row) throw new HttpError(404, '此分页消息不存在，请重新加载聊天记录。')
      sequence = row.sequence
    }
    const rows = db
      .prepare(
        'SELECT id,data FROM prts_messages WHERE sequence < ? ORDER BY sequence DESC LIMIT ?',
      )
      .all(sequence, limit + 1)
    const hasMore = rows.length > limit
    const chosen = rows.slice(0, limit).reverse()
    return {
      messages: chosen.map((row) => JSON.parse(row.data)),
      hasMore,
      nextCursor: chosen[0]?.id ?? null,
    }
  }
  function deleteMessages() {
    db.prepare('DELETE FROM prts_messages').run()
    return { deleted: true }
  }
  const metadata = (row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    size: row.size,
    createdAt: row.created_at,
  })
  function listFiles() {
    return {
      files: db
        .prepare('SELECT id,name,type,size,created_at FROM prts_files ORDER BY created_at DESC,id')
        .all()
        .map(metadata),
    }
  }
  function putFiles(files) {
    if (!Array.isArray(files) || files.length > 200) invalid('每次最多上传 200 个文件。')
    const values = files.map((value) => {
      object(value)
      const fileId = id(value.id, '文件 ID')
      const name = text(value.name, '文件名', 500)
      if (/[\r\n]/.test(name)) invalid('文件名不能包含换行。')
      const type = text(value.type, '文件类型', 200)
      if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(type)) invalid('文件类型格式无效。')
      const createdAt = isoDate(value.createdAt)
      if (typeof value.data !== 'string' || value.data.length > Math.ceil(maxFileBytes / 3) * 4)
        throw new HttpError(413, '单个文件不能超过 20 MB。')
      // A repeated four-character regexp exhausts V8's stack on valid 20 MB files.
      // The linear character scan plus canonical round-trip also rejects misplaced padding.
      if (value.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value.data))
        invalid('文件内容不是有效的 Base64。')
      const bytes = Buffer.from(value.data, 'base64')
      if (bytes.toString('base64') !== value.data) invalid('文件内容编码无效。')
      if (bytes.length > maxFileBytes) throw new HttpError(413, '单个文件不能超过 20 MB。')
      return {
        id: fileId,
        name,
        type,
        created_at: createdAt,
        size: bytes.length,
        bytes,
        sha256: hash(bytes),
      }
    })
    if (new Set(values.map((value) => value.id)).size !== values.length)
      invalid('上传列表包含重复文件 ID。')
    const published = []
    let result
    try {
      result = transaction(() => {
        let used = db.prepare('SELECT COALESCE(SUM(size),0) AS used FROM prts_files').get().used
        const incoming = []
        // Validate the entire batch before writing any content or metadata.
        for (const value of values) {
          const old = db
            .prepare('SELECT name,type,size,created_at,sha256,disk_key FROM prts_files WHERE id=?')
            .get(value.id)
          if (old) {
            if (
              old.sha256 !== value.sha256 ||
              old.name !== value.name ||
              old.type !== value.type ||
              old.created_at !== value.created_at
            )
              throw new HttpError(409, '此文件 ID 已保存了其他内容，未覆盖已有文件。')
            readDiskFile(old)
          } else {
            used += value.size
            incoming.push(value)
          }
        }
        if (used > maxTotalFileBytes)
          throw new HttpError(413, '文件总容量不能超过 100 MB，请删除不需要的文件后重试。')
        for (const value of incoming) {
          const key = writeDiskFile(value.bytes)
          published.push(key)
          db.prepare(
            'INSERT INTO prts_files (id,name,type,size,created_at,sha256,disk_key) VALUES (?,?,?,?,?,?,?)',
          ).run(value.id, value.name, value.type, value.size, value.created_at, value.sha256, key)
        }
        return { files: values.map(metadata) }
      })
    } catch (error) {
      // Only paths newly published by this attempt are removed; idempotent existing files are untouched.
      for (const key of published) {
        try {
          removeDiskFile(key)
        } catch {
          /* Preserve the original error. */
        }
      }
      throw error
    }
    // Publication has committed; cleanup failures must never remove newly committed content.
    cleanupDeletedFiles()
    return result
  }
  function getFile(fileId) {
    const row = db.prepare('SELECT * FROM prts_files WHERE id=?').get(id(fileId, '文件 ID'))
    if (!row) throw new HttpError(404, '文件不存在。')
    return { ...metadata(row), bytes: readDiskFile(row), sha256: row.sha256 }
  }
  function deleteFile(fileId) {
    transaction(() => {
      const key = id(fileId, '文件 ID')
      const row = db.prepare('SELECT disk_key FROM prts_files WHERE id=?').get(key)
      if (!row) return
      db.prepare('INSERT OR IGNORE INTO prts_upload_gc (disk_key) VALUES (?)').run(row.disk_key)
      db.prepare('DELETE FROM prts_files WHERE id=?').run(key)
    })
    cleanupDeletedFiles()
    return { deleted: true }
  }
  function completeFocus(sessionId) {
    id(sessionId, '专注会话 ID')
    return transaction(() => {
      const workspace = getDocument('workspace')
      const focus = getDocument('focus')
      const documents = { workspace, focus }
      if (db.prepare('SELECT 1 FROM prts_focus_completions WHERE session_id=?').get(sessionId))
        return { completed: false, documents }
      if (!workspace || !focus || focus.value.sessionId !== sessionId || focus.value.endAt === null)
        return { completed: false, documents }
      if (focus.value.endAt > now()) throw new HttpError(409, '专注计时尚未结束。')
      const date = new Date(now()).toISOString()
      const updated = {
        ...workspace.value,
        focusSessions: workspace.value.focusSessions + 1,
        activities: [
          { id: randomUUID(), text: '完成了一轮专注，辛苦了博士。', type: 'focus', time: date },
          ...workspace.value.activities,
        ].slice(0, 100),
      }
      validateDocument('workspace', updated)
      db.prepare('INSERT INTO prts_focus_completions (session_id,completed_at) VALUES (?,?)').run(
        sessionId,
        date,
      )
      documents.workspace = writeDocument('workspace', updated, workspace.revision + 1)
      documents.focus = writeDocument(
        'focus',
        { remaining: 0, endAt: null, sessionId },
        focus.revision + 1,
      )
      return { completed: true, documents }
    })
  }
  return {
    atomic: transaction,
    getState,
    getDocument,
    putDocument,
    importDocuments,
    appendMessages,
    listMessages,
    deleteMessages,
    listFiles,
    putFiles,
    getFile,
    deleteFile,
    completeFocus,
    uploadsDir: uploadRoot,
    close() {
      if (temporaryUploads) rmSync(uploadRoot, { recursive: true, force: true })
    },
  }
}

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}
function method(request, allowed) {
  if (!allowed.includes(request.method))
    throw new HttpError(405, `此接口仅支持 ${allowed.join('、')} 请求。`, {
      allow: allowed.join(', '),
    })
}
function readJson(request, maxBytes = MAX_DOCUMENT_BYTES + 1024) {
  if (
    (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw new HttpError(415, '请使用 application/json 发送请求。')
  if (Number(request.headers['content-length']) > maxBytes)
    throw new HttpError(413, '请求内容超过存储接口大小限制。')
  return new Promise((resolve, reject) => {
    let chunks = [],
      size = 0,
      settled = false
    request.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        settled = true
        chunks = []
        reject(new HttpError(413, '请求内容超过存储接口大小限制。'))
        return
      }
      chunks.push(chunk)
    })
    request.once('end', () => {
      if (settled) return
      settled = true
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, '请求内容不是有效的 JSON。'))
      }
      chunks = []
    })
    request.once('error', () => {
      if (!settled) reject(new HttpError(400, '请求读取失败。'))
      settled = true
      chunks = []
    })
    request.once('aborted', () => {
      if (!settled) reject(new HttpError(400, '请求已中断。'))
      settled = true
      chunks = []
    })
  })
}

/** Call only after authentication and same-origin checks in the main router. */
export async function storageRoute(request, response, pathname, store, authorize = () => {}) {
  if (pathname === '/api/state') {
    method(request, ['GET'])
    json(response, 200, store.getState())
    return true
  }
  if (pathname === '/api/state/import') {
    method(request, ['POST'])
    const payload = await readJson(request)
    authorize()
    json(response, 200, store.importDocuments(payload))
    return true
  }
  const documentMatch = /^\/api\/state\/([^/]+)$/.exec(pathname)
  if (documentMatch) {
    method(request, ['PUT'])
    const payload = await readJson(request)
    authorize()
    json(response, 200, store.putDocument(documentMatch[1], payload))
    return true
  }
  if (pathname === '/api/messages') {
    method(request, ['GET', 'POST', 'DELETE'])
    if (request.method === 'GET') {
      const query = new URL(request.url, 'http://localhost').searchParams
      json(
        response,
        200,
        store.listMessages({
          limit: query.has('limit') ? Number(query.get('limit')) : 60,
          before: query.get('before'),
        }),
      )
    } else if (request.method === 'POST') {
      const payload = await readJson(request)
      authorize()
      json(response, 200, store.appendMessages(payload?.messages))
    } else {
      request.resume()
      authorize()
      json(response, 200, store.deleteMessages())
    }
    return true
  }
  if (pathname === '/api/files') {
    method(request, ['GET', 'POST'])
    if (request.method === 'GET') json(response, 200, store.listFiles())
    else {
      const payload = await readJson(
        request,
        Math.ceil((MAX_TOTAL_FILE_BYTES * 4) / 3) + 1024 * 1024,
      )
      authorize()
      json(response, 200, store.putFiles(payload?.files))
    }
    return true
  }
  const fileMatch = /^\/api\/files\/([^/]+)(\/content)?$/.exec(pathname)
  if (fileMatch) {
    method(request, fileMatch[2] ? ['GET', 'HEAD'] : ['DELETE'])
    if (!fileMatch[2]) {
      request.resume()
      authorize()
      json(response, 200, store.deleteFile(fileMatch[1]))
      return true
    }
    const file = store.getFile(fileMatch[1])
    const inline =
      new URL(request.url, 'http://localhost').searchParams.get('inline') === '1' &&
      RASTER_TYPES.has(file.type)
    const encodedName = encodeURIComponent(file.name).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    response.writeHead(200, {
      'content-type': inline ? file.type : 'application/octet-stream',
      'content-length': file.size,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodedName}`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    })
    response.end(request.method === 'HEAD' ? undefined : file.bytes)
    return true
  }
  if (pathname === '/api/focus/complete') {
    method(request, ['POST'])
    const payload = await readJson(request, 4096)
    authorize()
    json(response, 200, store.completeFocus(payload?.sessionId))
    return true
  }
  return false
}
