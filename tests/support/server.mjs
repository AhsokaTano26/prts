// Isolated browser-test service. Never imported by the production server.
import { createServer } from '../../server/index.mjs'
import { createStorage } from '../../server/storage.mjs'
import { createInitialWorkspace } from '../../src/lib/workspace.ts'
import { randomUUID } from 'node:crypto'

const server = createServer({
  env: { PRTS_PASSWORD: 'prts-e2e-test-password-only' },
  assetsDir: new URL('../../public/assets/', import.meta.url).pathname,
})
const storage = createStorage(server.database)
const route = server.listeners('request')[0]
server.removeAllListeners('request')
server.on('request', (request, response) => {
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
      const payload = JSON.parse(body || '{}')
      for (const table of [
        'prts_documents',
        'prts_mutations',
        'prts_messages',
        'prts_files',
        'prts_focus_completions',
      ])
        server.database.exec(`DELETE FROM ${table}`)
      if (!payload.keepSessions) {
        server.database.exec('DELETE FROM auth_sessions; DELETE FROM auth_failures;')
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
