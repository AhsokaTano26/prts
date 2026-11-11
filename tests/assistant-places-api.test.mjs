import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer as httpServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from '../server/index.mjs'
import { createStorage } from '../server/storage.mjs'
import { createSettings } from '../server/settings.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'

async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  return `http://127.0.0.1:${server.address().port}`
}

async function fixture(t, automatic = false) {
  const requests = []
  const upstream = await listen(
    t,
    httpServer(async (request, response) => {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      requests.push(body)
      const message =
        requests.length === 1
          ? {
              content: null,
              tool_calls: [
                {
                  id: crypto.randomUUID(),
                  type: 'function',
                  function: {
                    name: 'propose_workspace_changes',
                    arguments: JSON.stringify({
                      changes: [
                        {
                          operation: 'create_place',
                          fields: {
                            name: '桥下饭馆',
                            city: '成都',
                            type: 'restaurant',
                            note: '想吃砂锅',
                          },
                        },
                        { operation: 'create_place', fields: { name: '山间书屋', type: 'shop' } },
                      ],
                    }),
                  },
                },
              ],
            }
          : { content: '博士，两个地点已准备。' }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message }] }))
    }),
  )
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prts-place-ai-api-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const server = createServer({
    env: { PRTS_PASSWORD: 'place-api-test-only' },
    uploadsDir: directory,
  })
  const storage = createStorage(server.database, { uploadsDir: directory })
  storage.putDocument('workspace', {
    value: createInitialWorkspace(),
    expectedRevision: 0,
    mutationId: crypto.randomUUID(),
  })
  storage.putDocument('preferences', {
    value: {
      motionEnabled: false,
      assistant: { persona: 'prts', knowledge: 'none' },
      assistantMode: 'ai',
      assistantAutoConfirm: automatic,
      map: {
        apiKey: '1234567890abcdef1234567890abcdef',
        center: { lng: 104, lat: 35 },
        zoom: 4,
        layer: 'vector',
      },
    },
    expectedRevision: 0,
    mutationId: crypto.randomUUID(),
  })
  const settings = createSettings(server.database)
  settings.update({
    baseUrl: upstream,
    model: 'place-test-model',
    apiKey: 'upstream-test-only',
    revision: settings.read().revision,
  })
  const base = await listen(t, server)
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'place-api-test-only' }),
  })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const call = (pathname, body) =>
    fetch(`${base}${pathname}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const chat = () =>
    call('/api/chat', {
      messages: [{ role: 'user', content: '帮我把成都想吃砂锅的桥下饭馆、山间书屋加入想去。' }],
      knowledge: 'none',
      timeZone: 'Asia/Shanghai',
    })
  return { base, storage, requests, chat, call }
}

test('HTTP chat prepares real place cards, protects confirmation endpoint, and writes selected batch once', async (t) => {
  const client = await fixture(t)
  const response = await client.chat()
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.actions.length, 2)
  assert.ok(
    result.actions.every(
      (action) => action.operation === 'create_place' && action.status === 'pending',
    ),
  )
  assert.equal(client.storage.getDocument('workspace').value.places.length, 0)
  assert.match(JSON.stringify(client.requests[0].tools), /create_place/)
  assert.ok(!JSON.stringify(client.requests).includes('1234567890abcdef1234567890abcdef'))
  const ids = result.actions.map((action) => action.id)
  assert.equal(
    (
      await fetch(`${client.base}/api/assistant/actions/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, decision: 'apply' }),
      })
    ).status,
    401,
  )
  assert.equal(
    (await client.call('/api/assistant/actions/batch', { ids, decision: 'apply' })).status,
    200,
  )
  assert.equal(
    (await client.call('/api/assistant/actions/batch', { ids, decision: 'apply' })).status,
    200,
  )
  const places = client.storage.getDocument('workspace').value.places
  assert.deepEqual(places.map((place) => place.name).sort(), ['山间书屋', '桥下饭馆'])
  assert.equal(places.find((place) => place.name === '山间书屋').coordinates, undefined)
})

test('HTTP automatic confirmation saves place records only after final model response', async (t) => {
  const client = await fixture(t, true)
  const response = await client.chat()
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(client.requests.length, 2)
  assert.equal(result.actionConfirmation, 'automatic')
  assert.ok(result.actions.every((action) => action.status === 'applied'))
  assert.equal(client.storage.getDocument('workspace').value.places.length, 2)
})
