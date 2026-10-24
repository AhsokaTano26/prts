import { createServer as createHttpServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createAuth } from './auth.mjs'
import { HttpError } from './errors.mjs'
import { knowledgeManager } from './knowledge.mjs'
import { chatOptions, systemMessage } from './personality.mjs'
import { createDatabase } from './database.mjs'
import { createStorage, storageRoute } from './storage.mjs'
import { getAsset, assetManager } from './resources.mjs'
import { createSettings } from './settings.mjs'
import { createWorkspaceTools } from './assistant-tools.mjs'

const DEFAULT_DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const MAX_BODY_BYTES = 1024 * 1024
const MAX_MESSAGES = 40
const MAX_MESSAGE_LENGTH = 12_000
const MAX_TOTAL_LENGTH = 80_000

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function json(response, status, payload, headers = {}) {
  if (response.destroyed || response.writableEnded) return
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  })
  response.end(body)
}

function readJson(request) {
  const mediaType = (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new HttpError(415, '请使用 application/json 发送请求。')
  }
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
    throw new HttpError(413, '请求内容过大，请限制在 1 MB 以内。')
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    request.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        settled = true
        chunks.length = 0
        reject(new HttpError(413, '请求内容过大，请限制在 1 MB 以内。'))
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
    })
    request.once('error', () => {
      if (!settled) reject(new HttpError(400, '请求读取失败，请重新发送。'))
      settled = true
    })
    request.once('aborted', () => {
      if (!settled) reject(new HttpError(400, '请求已中断。'))
      settled = true
    })
  })
}

function validateMessages(payload, persona) {
  if (
    !payload ||
    !Array.isArray(payload.messages) ||
    payload.messages.length === 0 ||
    payload.messages.length > MAX_MESSAGES
  ) {
    throw new HttpError(400, `messages 必须包含 1 至 ${MAX_MESSAGES} 条消息。`)
  }
  let totalLength = 0
  const validated = payload.messages.map((message) => {
    if (
      !message ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string'
    ) {
      throw new HttpError(400, '每条消息必须包含 user 或 assistant 角色及文字内容。')
    }
    if (!message.content.trim() || message.content.length > MAX_MESSAGE_LENGTH) {
      throw new HttpError(400, `消息不能为空，且每条不能超过 ${MAX_MESSAGE_LENGTH} 个字符。`)
    }
    if (message.persona !== undefined && !['prts', 'amiya', 'kaltsit'].includes(message.persona))
      throw new HttpError(400, '消息人格选项无效。')
    totalLength += message.content.length
    if (totalLength > MAX_TOTAL_LENGTH) {
      throw new HttpError(400, '对话内容过长，请开启新对话后重试。')
    }
    // Only forward supported fields, even when the client includes extra keys.
    return { role: message.role, content: message.content, persona: message.persona }
  })
  const latest = validated.at(-1)
  if (latest.role !== 'user' || (latest.persona !== undefined && latest.persona !== persona))
    throw new HttpError(400, '最后一条消息必须是当前人格的用户问题。')
  return validated
    .filter((message) => message.persona === undefined || message.persona === persona)
    .map(({ role, content }) => ({ role, content }))
}

async function completeChat(response, messages, config, timeoutMs, agent, authorize = () => {}) {
  if (!config.apiKey) {
    throw new HttpError(503, 'AI 尚未配置。请在系统设置中保存 AI 服务配置。')
  }
  if (!config.endpoint) {
    throw new HttpError(503, 'AI 服务地址配置无效，请在系统设置中检查服务地址。')
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  timer.unref()
  const onClose = () => controller.abort()
  response.once('close', onClose)
  try {
    const callIds = new Set()
    for (let round = 0; round < 6; round += 1) {
      authorize()
      const upstream = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          ...(agent ? { tools: agent.definitions, tool_choice: 'auto' } : {}),
        }),
        signal: controller.signal,
        redirect: 'error',
      })
      if (!upstream.ok) {
        await upstream.body?.cancel()
        if (upstream.status === 429)
          throw new HttpError(429, 'AI 服务请求过于频繁或额度不足，请稍后重试。')
        if ([401, 403].includes(upstream.status)) {
          throw new HttpError(502, 'AI 服务认证失败，请检查 API 密钥和服务地址配置。')
        }
        if (agent && [400, 422].includes(upstream.status))
          throw new HttpError(
            502,
            'AI 服务拒绝了工具调用请求，请使用支持工具调用的模型和兼容服务。',
          )
        throw new HttpError(502, 'AI 服务暂时不可用，请稍后重试。')
      }
      const payload = await upstream.json()
      authorize()
      const message = payload?.choices?.[0]?.message
      const content = message?.content
      const calls = message?.tool_calls
      if (calls !== undefined && calls !== null && (!Array.isArray(calls) || calls.length > 12))
        throw new HttpError(502, 'AI 服务返回了无效的工具调用。')
      if (calls?.length) {
        if (!agent || agent.toolsUsed.length + calls.length > 12 || round === 5)
          throw new HttpError(502, 'AI 工具调用次数过多，请缩小请求范围后重试。')
        const normalized = calls.map((call) => {
          if (
            call?.type !== 'function' ||
            typeof call.id !== 'string' ||
            call.id.length > 200 ||
            !call.id ||
            callIds.has(call.id) ||
            typeof call.function?.name !== 'string' ||
            call.function.name.length > 80 ||
            typeof call.function.arguments !== 'string'
          )
            throw new HttpError(502, 'AI 服务返回了无效的工具调用。')
          callIds.add(call.id)
          return {
            id: call.id,
            type: 'function',
            function: { name: call.function.name, arguments: call.function.arguments },
          }
        })
        messages.push({
          role: 'assistant',
          content: typeof content === 'string' ? content : null,
          tool_calls: normalized,
        })
        for (const call of normalized) {
          authorize()
          const result = agent.execute(call.function.name, call.function.arguments)
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
        }
        continue
      }
      if (typeof content !== 'string' || !content.trim()) {
        throw new HttpError(502, 'AI 服务返回了无效响应，请稍后重试。')
      }
      return {
        message: content,
        ...(agent?.actions.length ? { actions: agent.actions } : {}),
        ...(agent?.toolsUsed.length ? { toolsUsed: agent.toolsUsed } : {}),
      }
    }
    throw new HttpError(502, 'AI 工具调用次数过多，请缩小请求范围后重试。')
  } catch (error) {
    if (timedOut) throw new HttpError(504, 'AI 响应超时，请稍后重试。')
    if (error instanceof HttpError) throw error
    if (error instanceof SyntaxError)
      throw new HttpError(502, 'AI 服务返回了无效响应，请稍后重试。')
    throw new HttpError(502, '无法连接 AI 服务，请检查网络及服务地址配置。')
  } finally {
    clearTimeout(timer)
    response.off('close', onClose)
  }
}

function requestPath(url) {
  let pathname
  try {
    pathname = decodeURIComponent((url || '/').split('?')[0])
  } catch {
    throw new HttpError(400, '请求路径编码无效。')
  }
  if (!pathname.startsWith('/') || pathname.includes('\0'))
    throw new HttpError(400, '请求路径无效。')
  if (pathname.includes('\\') || pathname.split('/').includes('..'))
    throw new HttpError(403, '禁止访问此路径。')
  return pathname
}

function insideDirectory(root, file) {
  const relative = path.relative(root, file)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

async function staticFile(root, pathname) {
  if (pathname.split('/').some((part) => part.startsWith('.')))
    throw new HttpError(404, '文件不存在。')
  let realRoot
  try {
    realRoot = await realpath(root)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  const requested = path.resolve(realRoot, `.${pathname}`)
  if (!insideDirectory(realRoot, requested)) throw new HttpError(403, '禁止访问此路径。')

  async function locate(candidate) {
    try {
      const file = await realpath(candidate)
      if (!insideDirectory(realRoot, file)) throw new HttpError(403, '禁止访问此路径。')
      const info = await stat(file)
      return info.isFile() ? { file, size: info.size } : null
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null
      throw error
    }
  }

  const found = await locate(requested)
  if (found) return found
  // Missing assets remain 404; only application routes receive the SPA shell.
  if (!path.extname(pathname)) return locate(path.join(realRoot, 'index.html'))
  return null
}

async function route(
  request,
  response,
  settings,
  auth,
  knowledge,
  distDir,
  upstreamTimeoutMs,
  storage,
  assets,
  assetsDir,
  workspaceTools,
) {
  const corpus = knowledge.corpus
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('referrer-policy', 'same-origin')
  const pathname = requestPath(request.url)
  auth.checkOrigin(request)
  if (['/api/auth/session', '/api/auth/login', '/api/auth/logout'].includes(pathname)) {
    const method = pathname === '/api/auth/session' ? 'GET' : 'POST'
    if (request.method !== method) {
      request.resume()
      return json(response, 405, { error: `此接口仅支持 ${method} 请求。` }, { allow: method })
    }
    if (pathname === '/api/auth/session') return json(response, 200, auth.state(request))
    if (pathname === '/api/auth/logout') {
      request.resume()
      return json(response, 200, { authenticated: false }, { 'set-cookie': auth.logout(request) })
    }
    const result = await auth.login(request, () => readJson(request))
    return json(response, 200, result.state, { 'set-cookie': result.cookie })
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) auth.requireSession(request)
  const assistantAction = /^\/api\/assistant\/actions\/([a-f0-9-]{36})$/.exec(pathname)
  if (assistantAction) {
    if (request.method === 'GET')
      return json(response, 200, { action: workspaceTools.getAction(assistantAction[1]) })
    if (request.method === 'POST') {
      const payload = await readJson(request)
      auth.requireSession(request)
      return json(response, 200, workspaceTools.decide(assistantAction[1], payload?.decision))
    }
    throw new HttpError(405, '此接口仅支持 GET 或 POST 请求。', { allow: 'GET, POST' })
  }
  if (pathname === '/api/auth/password') {
    if (request.method !== 'POST')
      throw new HttpError(405, '此接口仅支持 POST 请求。', { allow: 'POST' })
    const cookie = await auth.changePassword(request, () => readJson(request))
    return json(response, 200, { authenticated: false }, { 'set-cookie': cookie })
  }
  if (pathname === '/api/settings/ai') {
    if (request.method === 'GET') return json(response, 200, settings.read())
    if (request.method === 'PUT') {
      const payload = await readJson(request)
      auth.requireSession(request)
      return json(response, 200, settings.update(payload))
    }
    throw new HttpError(405, '此接口仅支持 GET 或 PUT 请求。', { allow: 'GET, PUT' })
  }
  if (await storageRoute(request, response, pathname, storage, () => auth.requireSession(request)))
    return
  if (pathname === '/api/assets/sync') {
    if (request.method === 'GET') return json(response, 200, await assets.status())
    if (request.method === 'POST') {
      const payload = await readJson(request)
      auth.requireSession(request)
      return json(response, 202, await assets.start(payload?.mode))
    }
    throw new HttpError(405, '此接口仅支持 GET 或 POST 请求。', { allow: 'GET, POST' })
  }
  if (pathname === '/api/knowledge/sync') {
    if (request.method === 'GET') return json(response, 200, knowledge.status())
    if (request.method === 'POST') {
      const payload = await readJson(request)
      auth.requireSession(request)
      return json(response, 202, await knowledge.start(payload?.mode))
    }
    request.resume()
    return json(response, 405, { error: '此接口仅支持 GET 或 POST 请求。' }, { allow: 'GET, POST' })
  }
  if (pathname === '/api/knowledge' || pathname === '/api/knowledge/search') {
    if (request.method !== 'GET') {
      request.resume()
      return json(response, 405, { error: '此接口仅支持 GET 请求。' }, { allow: 'GET' })
    }
    if (pathname === '/api/knowledge') return json(response, 200, await corpus.status())
    const query = new URL(request.url, 'http://localhost').searchParams
    const results = await corpus.search(query.get('q'), {
      source: query.get('source') ?? 'all',
      limit: query.has('limit') ? Number(query.get('limit')) : 6,
    })
    return json(response, 200, results)
  }
  if (pathname === '/api/health') {
    if (request.method !== 'GET') {
      request.resume()
      return json(response, 405, { error: '此接口仅支持 GET 请求。' }, { allow: 'GET' })
    }
    const config = settings.configuration()
    return json(response, 200, {
      configured: config.configured,
      model: config.model,
      provider: config.provider,
    })
  }
  if (pathname === '/api/chat') {
    if (request.method !== 'POST') {
      request.resume()
      return json(response, 405, { error: '此接口仅支持 POST 请求。' }, { allow: 'POST' })
    }
    const payload = await readJson(request)
    auth.requireSession(request)
    const config = settings.configuration()
    const { persona, knowledge } = chatOptions(
      payload ?? {},
      storage.getDocument('preferences')?.value.assistant,
    )
    const messages = validateMessages(payload, persona)
    if (!config.configured) return completeChat(response, messages, config, upstreamTimeoutMs)
    const sources = await corpus.context(messages, knowledge)
    auth.requireSession(request)
    const result = await completeChat(
      response,
      [systemMessage(persona, sources, workspaceTools.overview()), ...messages],
      config,
      upstreamTimeoutMs,
      workspaceTools.session(),
      () => auth.requireSession(request),
    )
    return json(response, 200, { ...result, model: config.model, persona, sources })
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    request.resume()
    return json(response, 404, { error: 'API 接口不存在。' })
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    request.resume()
    return json(
      response,
      405,
      { error: '静态资源仅支持 GET 或 HEAD 请求。' },
      { allow: 'GET, HEAD' },
    )
  }
  const storedAsset = await getAsset(assetsDir, pathname)
  const gameResource =
    pathname === '/assets/amiya.png' || pathname.startsWith('/assets/corpus-images/')
  const asset = storedAsset || (gameResource ? null : await staticFile(distDir, pathname))
  if (!asset) return json(response, 404, { error: '页面或资源不存在，请先构建前端。' })
  const extension = path.extname(asset.file).toLowerCase()
  response.writeHead(200, {
    'content-type': asset.mime || MIME_TYPES[extension] || 'application/octet-stream',
    'content-length': asset.size,
    'cache-control':
      extension === '.html' || pathname === '/sw.js' || extension === '.webmanifest'
        ? 'no-cache'
        : 'public, max-age=3600',
  })
  if (request.method === 'HEAD') return response.end()
  const stream = createReadStream(asset.file)
  stream.on('error', () => response.destroy())
  response.once('close', () => stream.destroy())
  stream.pipe(response)
}

export function createServer({
  env = process.env,
  distDir = DEFAULT_DIST,
  upstreamTimeoutMs = 60_000,
  now = Date.now,
  corpusDir,
  syncCorpus,
  assetsDir,
  uploadsDir,
  syncAssets,
  database: suppliedDatabase,
  databasePath = env.PRTS_DB_PATH,
  logger = console.log,
} = {}) {
  const database = suppliedDatabase || createDatabase({ filename: databasePath || ':memory:' })
  const dataDirectory =
    databasePath && databasePath !== ':memory:'
      ? path.dirname(path.resolve(databasePath))
      : fileURLToPath(new URL('../data/', import.meta.url))
  assetsDir ||= path.join(dataDirectory, 'assets')
  const storage = createStorage(database, {
    now,
    uploadsDir:
      uploadsDir ||
      (databasePath && databasePath !== ':memory:'
        ? path.join(dataDirectory, 'uploads')
        : undefined),
  })
  const assets = assetManager({ database, directory: assetsDir, synchronize: syncAssets, now })
  const settings = createSettings(database)
  const workspaceTools = createWorkspaceTools(database, storage, { now })
  const auth = createAuth({ env, now, database, logger })
  const knowledge = knowledgeManager({
    directory: corpusDir || path.join(dataDirectory, 'corpus'),
    synchronize: syncCorpus,
    now,
    database: suppliedDatabase || databasePath ? database : undefined,
  })
  const server = createHttpServer((request, response) => {
    route(
      request,
      response,
      settings,
      auth,
      knowledge,
      distDir,
      upstreamTimeoutMs,
      storage,
      assets,
      assetsDir,
      workspaceTools,
    ).catch((error) => {
      request.resume()
      json(
        response,
        error instanceof HttpError ? error.status : 500,
        {
          error: error instanceof HttpError ? error.message : '服务暂时出现异常，请稍后重试。',
        },
        error instanceof HttpError ? error.headers : {},
      )
    })
  })
  server.requestTimeout = 60_000
  server.headersTimeout = 10_000
  server.database = database
  server.once('close', () => {
    storage.close?.()
    if (!suppliedDatabase) database.close()
  })
  return server
}

// Importing this module for tests or embedding does not open a listening socket.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1'
  const port = Number(process.env.PORT || 8787)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT 必须是 1 至 65535 之间的整数。')
    process.exitCode = 1
  } else {
    const server = createServer({
      databasePath:
        process.env.PRTS_DB_PATH || fileURLToPath(new URL('../data/prts.sqlite', import.meta.url)),
    })
    server.on('error', () => {
      console.error('PRTS 服务启动失败，请检查 HOST / PORT 及端口占用情况。')
      process.exitCode = 1
    })
    server.listen(port, host, () => {
      console.log(`PRTS API ready at http://${host}:${port}`)
    })
    const stop = () => {
      server.close()
      server.closeAllConnections()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }
}
