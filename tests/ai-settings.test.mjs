import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createServer } from '../server/index.mjs'

const PASSWORD = 'ai-settings-test-password'
const KEY = 'private-test-ai-key'

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}
async function close(server) {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
async function app(t, options = {}) {
  const server = createServer({ ...options, env: { PRTS_PASSWORD: PASSWORD, ...options.env } })
  const base = await listen(server)
  t.after(() => server.listening && close(server))
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  async function call(route, body, extra = {}) {
    return fetch(`${base}${route}`, {
      method: body === undefined ? 'GET' : 'PUT',
      headers: { cookie, 'content-type': 'application/json', ...extra.headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...extra,
    })
  }
  return {
    server,
    base,
    cookie,
    call,
    settings: () => call('/api/settings/ai').then((r) => r.json()),
  }
}

test('AI starts empty and ignores all environment AI credentials', async (t) => {
  const client = await app(t, {
    env: {
      OPENAI_API_KEY: 'ignored-env-secret',
      OPENAI_BASE_URL: 'https://ignored.example/v1',
      OPENAI_MODEL: 'ignored-model',
    },
  })
  const response = await client.call('/api/settings/ai')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const settings = await response.json()
  assert.deepEqual(settings, {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    hasApiKey: false,
    configured: false,
    revision: 1,
  })
  assert.equal((await (await client.call('/api/health')).json()).configured, false)
})

test('AI settings survive restart, never echo the key, and preserve or explicitly clear it', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prts-ai-settings-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const databasePath = path.join(directory, 'prts.sqlite')
  const client = await app(t, { databasePath })
  const settings = await client.settings()
  const saved = await client.call('/api/settings/ai', {
    ...settings,
    apiKey: KEY,
    baseUrl: 'https://example.com/v1/',
    model: 'custom-model',
  })
  assert.equal(saved.status, 200)
  const text = await saved.text()
  assert.doesNotMatch(text, /private-test-ai-key/)
  const updated = JSON.parse(text)
  assert.equal(updated.hasApiKey, true)
  assert.equal(updated.baseUrl, 'https://example.com/v1')
  assert.equal(updated.revision, settings.revision + 1)
  await close(client.server)
  const restarted = await app(t, { databasePath, env: { OPENAI_API_KEY: 'ignored-after-restart' } })
  assert.deepEqual(await restarted.settings(), updated)
  const preserved = await restarted.call('/api/settings/ai', {
    baseUrl: updated.baseUrl,
    model: 'changed-model',
    revision: updated.revision,
    apiKey: '',
  })
  assert.equal(preserved.status, 200)
  const kept = await preserved.json()
  assert.equal(kept.hasApiKey, true)
  const conflict = await restarted.call('/api/settings/ai', {
    baseUrl: updated.baseUrl,
    model: 'stale-model',
    revision: updated.revision,
    apiKey: 'stale-secret',
  })
  assert.equal(conflict.status, 409)
  assert.equal((await restarted.settings()).model, 'changed-model')
  const cleared = await restarted.call('/api/settings/ai', {
    baseUrl: kept.baseUrl,
    model: kept.model,
    revision: kept.revision,
    clearApiKey: true,
  })
  assert.equal(cleared.status, 200)
  assert.equal((await cleared.json()).configured, false)
})

test('AI changes affect the next real upstream request without restarting the server', async (t) => {
  const received = []
  const upstream = createHttpServer(async (request, response) => {
    let body = ''
    for await (const part of request) body += part
    received.push({ auth: request.headers.authorization, url: request.url, body: JSON.parse(body) })
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
  })
  const upstreamUrl = await listen(upstream)
  t.after(() => close(upstream))
  const client = await app(t)
  const settings = await client.settings()
  const update = await client.call('/api/settings/ai', {
    baseUrl: `${upstreamUrl}/v1`,
    model: 'first-model',
    apiKey: KEY,
    revision: settings.revision,
  })
  assert.equal(update.status, 200)
  const updated = await update.json()
  const chat = () =>
    client.call(
      '/api/chat',
      { messages: [{ role: 'user', content: 'hello' }], knowledge: 'none' },
      { method: 'POST' },
    )
  assert.equal((await chat()).status, 200)
  const second = await client.call('/api/settings/ai', {
    baseUrl: `${upstreamUrl}/v2`,
    model: 'second-model',
    apiKey: 'new-test-key',
    revision: updated.revision,
  })
  assert.equal(second.status, 200)
  assert.equal((await chat()).status, 200)
  assert.equal(received[0].auth, `Bearer ${KEY}`)
  assert.equal(received[0].body.model, 'first-model')
  assert.equal(received[1].auth, 'Bearer new-test-key')
  assert.equal(received[1].url, '/v2/chat/completions')
  assert.equal(received[1].body.model, 'second-model')
})

test('AI configuration rejects unauthenticated, cross-origin and invalid writes without changing stored values', async (t) => {
  const client = await app(t)
  const settings = await client.settings()
  assert.equal((await fetch(`${client.base}/api/settings/ai`)).status, 401)
  const cross = await fetch(`${client.base}/api/settings/ai`, {
    method: 'PUT',
    headers: {
      cookie: client.cookie,
      origin: 'https://other.example',
      'content-type': 'application/json',
    },
    body: '{}',
  })
  assert.equal(cross.status, 403)
  for (const patch of [
    { baseUrl: 'file:///private/secret' },
    { baseUrl: 'https://user:private-secret@example.com/v1' },
    { baseUrl: 'https://example.com/v1?key=private-secret' },
    { baseUrl: 'https://example.com/v1#secret' },
    { model: '' },
    { model: 'x'.repeat(201) },
    { apiKey: 'bad\r\nHeader' },
    { apiKey: 23 },
    { revision: -1 },
    { clearApiKey: 'true' },
    { clearApiKey: true, apiKey: KEY },
  ]) {
    const response = await client.call('/api/settings/ai', { ...settings, ...patch })
    assert.equal(response.status, 400, JSON.stringify(patch))
    assert.doesNotMatch(await response.text(), /private-secret|private-test-ai-key/)
    assert.deepEqual(await client.settings(), settings)
  }
  const unsupported = await client.call('/api/settings/ai', undefined, { method: 'DELETE' })
  assert.equal(unsupported.status, 405)
})
