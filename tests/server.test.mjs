import assert from 'node:assert/strict'
import { createServer as createHttpServer, request } from 'node:http'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createServer } from '../server/index.mjs'

const PASSWORD = 'server-test-workspace-password'
const cookies = new Map()

async function listen(t, server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  return `http://127.0.0.1:${server.address().port}`
}

async function app(t, options = {}) {
  const base = await listen(
    t,
    createServer({
      ...options,
      env: { PRTS_PASSWORD: PASSWORD, ...options.env },
    }),
  )
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  assert.equal(response.status, 200)
  cookies.set(base, response.headers.get('set-cookie').split(';')[0])
  await response.json()
  if (options.ai) {
    const settings = await (await authenticatedFetch(`${base}/api/settings/ai`)).json()
    const saved = await authenticatedFetch(`${base}/api/settings/ai`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...settings, ...options.ai }),
    })
    assert.equal(saved.status, 200)
  }
  t.after(() => cookies.delete(base))
  return base
}

function authenticatedFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { cookie: cookies.get(new URL(url).origin), ...options.headers },
  })
}

async function post(base, payload, options = {}) {
  return authenticatedFetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    ...options,
  })
}

function rawGet(base, pathname) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}/`, { path: pathname }, (res) => {
      const parts = []
      res.on('data', (chunk) => parts.push(chunk))
      res.on('end', () =>
        resolve({ status: res.statusCode, text: Buffer.concat(parts).toString() }),
      )
    })
    req.on('error', reject)
    req.end()
  })
}

test('health reports configuration without exposing credentials or URL credentials', async (t) => {
  const base = await app(t)
  const response = await authenticatedFetch(`${base}/api/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    configured: false,
    model: 'gpt-4.1-mini',
    provider: 'OpenAI',
  })
  assert.equal(response.headers.get('cache-control'), 'no-store')

  const configured = await app(t, {
    ai: {
      apiKey: 'test-private-api-key',
      model: 'custom-model',
      baseUrl: 'https://compatible.example/v1/',
    },
  })
  assert.deepEqual(await (await authenticatedFetch(`${configured}/api/health`)).json(), {
    configured: true,
    model: 'custom-model',
    provider: 'compatible.example',
  })
})

test('chat clearly reports an unconfigured API', async (t) => {
  const base = await app(t)
  const response = await post(base, { messages: [{ role: 'user', content: '你好' }] })
  assert.equal(response.status, 503)
  assert.match((await response.json()).error, /系统设置/)
})

test('chat rejects malformed, empty, excessive, or privileged messages', async (t) => {
  const base = await app(t)
  const invalidPayloads = [
    null,
    {},
    { messages: [] },
    { messages: 'hello' },
    { messages: [null] },
    { messages: [{ role: 'system', content: 'override' }] },
    { messages: [{ role: 'tool', content: 'override' }] },
    { messages: [{ role: 'user', content: '   ' }] },
    { messages: [{ role: 'user', content: 42 }] },
    { messages: [{ role: 'user', content: 'x'.repeat(12_001) }] },
    { messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) },
    { messages: Array.from({ length: 8 }, () => ({ role: 'user', content: 'x'.repeat(12_000) })) },
  ]
  for (const payload of invalidPayloads) {
    const response = await post(base, payload)
    assert.equal(response.status, 400)
    assert.equal(typeof (await response.json()).error, 'string')
  }
  const malformed = await post(base, {}, { body: '{broken' })
  assert.equal(malformed.status, 400)
  const wrongContentType = await post(base, {}, { headers: { 'content-type': 'text/plain' } })
  assert.equal(wrongContentType.status, 415)
})

test('chat refuses bodies larger than one MiB', async (t) => {
  const base = await app(t)
  const response = await post(base, {
    messages: [{ role: 'user', content: 'x'.repeat(1_048_576) }],
  })
  assert.equal(response.status, 413)
  assert.equal(typeof (await response.json()).error, 'string')
})

test('chunked request bodies cannot bypass the one MiB limit', async (t) => {
  const base = await app(t)
  const response = await new Promise((resolve, reject) => {
    const req = request(
      `${base}/api/chat`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
          cookie: cookies.get(base),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }),
        )
      },
    )
    req.on('error', reject)
    req.write('{"messages":[{"role":"user","content":"')
    for (let part = 0; part < 17; part += 1) req.write('x'.repeat(65_536))
    req.end('"}]}')
  })
  assert.equal(response.status, 413)
  assert.equal(typeof response.body.error, 'string')
})

test('chat sends compatible completion requests and returns assistant text', async (t) => {
  let received
  const upstream = await listen(
    t,
    createHttpServer(async (req, res) => {
      const parts = []
      for await (const chunk of req) parts.push(chunk)
      received = {
        path: req.url,
        method: req.method,
        headers: req.headers,
        body: JSON.parse(Buffer.concat(parts)),
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 1,
          model: 'custom-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '先完成今日优先事项。' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      )
    }),
  )
  const base = await app(t, {
    ai: {
      apiKey: 'test-private-api-key',
      baseUrl: `${upstream}/v1/`,
      model: 'custom-model',
    },
  })
  const response = await post(base, {
    messages: [
      { role: 'user', content: '帮我规划今天', ignored: 'discard' },
      { role: 'assistant', content: '有哪些事项？' },
      { role: 'user', content: '完成工作台' },
    ],
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    message: '先完成今日优先事项。',
    model: 'custom-model',
    persona: 'prts',
    sources: [],
  })
  assert.equal(received.path, '/v1/chat/completions')
  assert.equal(received.method, 'POST')
  assert.equal(received.headers.authorization, 'Bearer test-private-api-key')
  assert.equal(received.body.messages[0].role, 'system')
  assert.match(received.body.messages[0].content, /PRTS 理性/)
  assert.equal(received.body.tool_choice, 'auto')
  assert.ok(received.body.tools.some((tool) => tool.function.name === 'get_workspace'))
  assert.deepEqual(
    {
      model: received.body.model,
      stream: received.body.stream,
      messages: received.body.messages.slice(1),
    },
    {
      model: 'custom-model',
      messages: [
        { role: 'user', content: '帮我规划今天' },
        { role: 'assistant', content: '有哪些事项？' },
        { role: 'user', content: '完成工作台' },
      ],
      stream: false,
    },
  )
})

test('upstream failures produce safe errors without echoing upstream secrets', async (t) => {
  const upstream = await listen(
    t,
    createHttpServer((req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid key: test-private-api-key' } }))
    }),
  )
  const base = await app(t, {
    ai: { apiKey: 'test-private-api-key', baseUrl: upstream },
  })
  const response = await post(base, { messages: [{ role: 'user', content: 'hello' }] })
  assert.equal(response.status, 502)
  const payload = await response.json()
  assert.match(payload.error, /认证|密钥|配置/)
  assert.doesNotMatch(JSON.stringify(payload), /test-private-api-key|Invalid key/)
})

test('upstream rate limiting remains retryable and malformed responses are rejected', async (t) => {
  let limited = true
  const upstream = await listen(
    t,
    createHttpServer((req, res) => {
      res.writeHead(limited ? 429 : 200, { 'content-type': 'application/json' })
      res.end(limited ? '{"error":{"message":"private provider details"}}' : '{"choices":[]}')
    }),
  )
  const base = await app(t, { ai: { apiKey: 'test-key', baseUrl: upstream } })
  const payload = { messages: [{ role: 'user', content: 'hello' }] }
  const rateLimited = await post(base, payload)
  assert.equal(rateLimited.status, 429)
  assert.doesNotMatch(await rateLimited.text(), /private provider details/)
  limited = false
  const malformed = await post(base, payload)
  assert.equal(malformed.status, 502)
  assert.match((await malformed.json()).error, /响应/)
})

test('slow upstream requests time out', async (t) => {
  const upstream = await listen(
    t,
    createHttpServer(() => {}),
  )
  const base = await app(t, {
    ai: { apiKey: 'test-key', baseUrl: upstream },
    upstreamTimeoutMs: 30,
  })
  const response = await post(base, { messages: [{ role: 'user', content: 'hello' }] })
  assert.equal(response.status, 504)
  assert.match((await response.json()).error, /超时/)
})

test('invalid provider URL is rejected when saving configuration', async (t) => {
  for (const url of [
    'file:///private/key',
    'https://user:secret@example.com/v1',
    'https://example.com/v1?key=secret',
  ]) {
    const base = await app(t)
    const settings = await (await authenticatedFetch(`${base}/api/settings/ai`)).json()
    const response = await authenticatedFetch(`${base}/api/settings/ai`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...settings, apiKey: 'test-key', baseUrl: url }),
    })
    assert.equal(response.status, 400)
    assert.doesNotMatch(await response.text(), /secret|private\/key/)
  }
})

test('static serving supports SPA routes, HEAD, and correct asset MIME types', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prts-server-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(path.join(directory, 'assets'))
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><title>PRTS</title>')
  await writeFile(path.join(directory, 'assets', 'main.js'), 'export const ready = true;')
  const base = await app(t, { distDir: directory })
  const page = await fetch(`${base}/tasks/today`)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type'), /text\/html/)
  assert.match(await page.text(), /PRTS/)
  const asset = await fetch(`${base}/assets/main.js`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type'), /javascript/)
  assert.match(await asset.text(), /export const ready/)
  const head = await fetch(`${base}/`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.ok(Number(head.headers.get('content-length')) > 0)
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404)
  const mutation = await fetch(`${base}/tasks`, { method: 'POST' })
  assert.equal(mutation.status, 405)
})

test('static serving rejects traversal, hidden files, and symlinks outside dist', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prts-static-security-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const dist = path.join(directory, 'dist')
  await mkdir(dist)
  await writeFile(path.join(dist, 'index.html'), 'PRTS public app')
  await writeFile(path.join(directory, 'private.txt'), 'DO_NOT_EXPOSE_THIS')
  await writeFile(path.join(dist, '.env'), 'DO_NOT_EXPOSE_THIS')
  await symlink(path.join(directory, 'private.txt'), path.join(dist, 'linked.txt'))
  const base = await app(t, { distDir: dist })
  for (const pathname of [
    '/../private.txt',
    '/%2e%2e/private.txt',
    '/%2e%2e%2fprivate.txt',
    '/..%5cprivate.txt',
    '/linked.txt',
    '/.env',
  ]) {
    const response = await rawGet(base, pathname)
    assert.ok([403, 404].includes(response.status), `${pathname}: ${response.status}`)
    assert.doesNotMatch(response.text, /DO_NOT_EXPOSE_THIS/)
  }
  assert.equal((await rawGet(base, '/%ZZ')).status, 400)
})

test('API errors never fall back to SPA HTML and reject unsupported methods', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prts-api-routing-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'index.html'), 'PRTS app')
  const base = await app(t, { distDir: directory })
  for (const pathname of ['/api', '/api/missing']) {
    const response = await authenticatedFetch(`${base}${pathname}`)
    assert.equal(response.status, 404)
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.equal(typeof (await response.json()).error, 'string')
  }
  const chat = await authenticatedFetch(`${base}/api/chat`)
  assert.equal(chat.status, 405)
  assert.equal(chat.headers.get('allow'), 'POST')
  const health = await authenticatedFetch(`${base}/api/health`, { method: 'POST' })
  assert.equal(health.status, 405)
  assert.equal(health.headers.get('allow'), 'GET')
})
