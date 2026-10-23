import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createServer } from '../server/index.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'

test('changing the password rejects old-session writes whose bodies are still arriving', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-password-inflight-'))
  const password = 'inflight-test-password'
  const server = createServer({
    databasePath: path.join(root, 'prts.sqlite'),
    env: { PRTS_PASSWORD: password },
    logger: () => {},
  })
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  assert.equal(login.status, 200)
  await login.json()
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const changes = [
    [
      '/api/state/workspace',
      'PUT',
      {
        value: createInitialWorkspace(),
        expectedRevision: 0,
        mutationId: 'delayed-workspace',
      },
    ],
    [
      '/api/state/import',
      'POST',
      {
        documents: {
          preferences: {
            motionEnabled: true,
            assistantMode: 'local',
            assistant: { persona: 'prts', knowledge: 'all' },
          },
        },
        expectedRevisions: { workspace: 0, preferences: 0, focus: 0 },
        mutationId: 'delayed-import',
      },
    ],
    [
      '/api/messages',
      'POST',
      {
        messages: [
          { id: 'delayed-message', role: 'user', mode: 'local', content: 'Must not be written' },
        ],
      },
    ],
    [
      '/api/files',
      'POST',
      {
        files: [
          {
            id: 'delayed-file',
            name: 'private.txt',
            type: 'text/plain',
            createdAt: '2026-10-23T00:00:00.000Z',
            data: Buffer.from('Must not be written').toString('base64'),
          },
        ],
      },
    ],
    ['/api/focus/complete', 'POST', { sessionId: 'delayed-focus' }],
  ]
  const pending = []
  for (const [route, method, payload] of changes) {
    const body = JSON.stringify(payload)
    let started
    const requestStarted = new Promise((resolve) => {
      started = resolve
    })
    const onRequest = (request) => {
      if (request.url === route) {
        server.off('request', onRequest)
        started()
      }
    }
    // Registered after the app handler: the initial session check has run when this fires.
    server.on('request', onRequest)
    let sendRest
    const result = new Promise((resolve, reject) => {
      const request = http.request(
        `${base}${route}`,
        {
          method,
          headers: {
            cookie,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (response) => {
          response.resume()
          response.on('end', () => resolve(response.statusCode))
        },
      )
      request.on('error', reject)
      request.write(body.slice(0, 1))
      sendRest = () => request.end(body.slice(1))
    })
    await requestStarted
    pending.push({ route, result, sendRest })
  }

  const changed = await fetch(`${base}/api/auth/password`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: password, newPassword: 'new-inflight-test-password' }),
  })
  assert.equal(changed.status, 200)
  await changed.json()
  for (const request of pending) request.sendRest()
  for (const request of pending)
    assert.equal(await request.result, 401, `${request.route} must recheck the revoked session`)
  for (const table of ['prts_documents', 'prts_messages', 'prts_files', 'prts_imports'])
    assert.equal(server.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0)
  assert.deepEqual(await readdir(path.join(root, 'uploads')), [])
})
