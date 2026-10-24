// Isolated browser-test service. Never imported by the production server.
import { createServer } from '../../server/index.mjs'
import { createStorage } from '../../server/storage.mjs'
import { createSettings } from '../../server/settings.mjs'
import { createInitialWorkspace } from '../../src/lib/workspace.ts'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const server = createServer({
  env: { PRTS_PASSWORD: 'prts-e2e-test-password-only' },
  assetsDir: new URL('../../public/assets/', import.meta.url).pathname,
  // Browser tests never contact external Webhook or SMTP destinations.
  notificationOptions: {
    fetchImpl: async () => new Response('{"status":"forwarded"}'),
    sendMail: async (_config, message) => ({ accepted: [message.to] }),
  },
})
const initialNotificationSettings = server.database
  .prepare('SELECT data,revision FROM prts_notification_settings WHERE id=1')
  .get()
const storage = createStorage(server.database)
const originalCredentials = server.database.prepare('SELECT key, value FROM auth_metadata').all()
const route = server.listeners('request')[0]
let workerRevision = 0
server.removeAllListeners('request')
server.on('request', (request, response) => {
  if (
    request.url === '/__test/pwa-update' &&
    request.method === 'POST' &&
    request.headers['x-prts-test'] === 'isolated-browser-test'
  ) {
    request.resume()
    workerRevision += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ updated: true }))
    return
  }
  if (request.url === '/sw.js' && workerRevision > 0) {
    void readFile(new URL('../../dist/sw.js', import.meta.url), 'utf8')
      .then((source) => {
        response.writeHead(200, {
          'content-type': 'application/javascript',
          'cache-control': 'no-cache',
        })
        response.end(`${source}\n// Isolated update fixture ${workerRevision}\n`)
      })
      .catch(() => {
        response.writeHead(500)
        response.end()
      })
    return
  }
  if (
    request.url === '/__test/reset' &&
    request.method === 'POST' &&
    request.headers['x-prts-test'] === 'isolated-browser-test'
  ) {
    let body = ''
    request.on('data', (part) => {
      body += part
    })
    request.on('end', () => {
      workerRevision = 0
      const payload = JSON.parse(body || '{}')
      for (const table of [
        'prts_passkeys',
        'prts_passkey_challenges',
        'prts_reminder_deliveries',
        'prts_reminder_events',
        'prts_documents',
        'prts_mutations',
        'prts_messages',
        'prts_files',
        'prts_focus_completions',
        'prts_assistant_actions',
      ])
        server.database.exec(`DELETE FROM ${table}`)
      server.database
        .prepare('UPDATE prts_notification_settings SET data=?,revision=? WHERE id=1')
        .run(initialNotificationSettings.data, initialNotificationSettings.revision)
      if (!payload.keepSessions) {
        server.database.exec(
          'DELETE FROM auth_sessions; DELETE FROM auth_failures; DELETE FROM auth_metadata; DELETE FROM prts_ai_settings;',
        )
        const restore = server.database.prepare(
          'INSERT INTO auth_metadata (key, value) VALUES (?, ?)',
        )
        for (const row of originalCredentials) restore.run(row.key, row.value)
        createSettings(server.database)
      }
      if (payload.seed !== false) {
        storage.putDocument('workspace', {
          value: createInitialWorkspace(),
          expectedRevision: 0,
          mutationId: randomUUID(),
        })
        storage.putDocument('preferences', {
          value: {
            motionEnabled: true,
            assistant: { persona: 'prts', knowledge: 'all' },
            assistantMode: 'local',
          },
          expectedRevision: 0,
          mutationId: randomUUID(),
        })
        storage.putDocument('focus', {
          value: { remaining: 1500, endAt: null, sessionId: null },
          expectedRevision: 0,
          mutationId: randomUUID(),
        })
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ reset: true }))
    })
    return
  }
  route(request, response)
})
server.listen(8791, '127.0.0.1', () => console.log('Isolated SQLite browser test server: 8791'))
const stop = () => {
  server.close()
  server.closeAllConnections()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
