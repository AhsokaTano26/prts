import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createServer } from '../server/index.mjs'
import { createStorage } from '../server/storage.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'

const port = Number(process.env.PRTS_DEMO_PORT || 8792)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PRTS_DEMO_PORT 必须是 1 至 65535 之间的整数。')

const server = createServer({
  env: { PRTS_PASSWORD: process.env.PRTS_DEMO_PASSWORD || 'prts-demo' },
  databasePath: fileURLToPath(new URL(`../data/demo/${port}/prts.sqlite`, import.meta.url)),
  assetsDir: fileURLToPath(new URL('../public/assets/', import.meta.url)),
})
const storage = createStorage(server.database, {
  uploadsDir: fileURLToPath(new URL(`../data/demo/${port}/uploads/`, import.meta.url)),
})
const existing = storage.getState().documents
for (const [key, value] of Object.entries({
  workspace: createInitialWorkspace(),
  preferences: {
    motionEnabled: true,
    assistant: { persona: 'prts', knowledge: 'all' },
    assistantMode: 'local',
    appearance: { theme: 'rhodes', portrait: 'amiya' },
  },
  focus: { remaining: 1500, endAt: null, sessionId: null },
})) {
  if (!existing[key])
    storage.putDocument(key, { value, expectedRevision: 0, mutationId: randomUUID() })
}
server.listen(port, '127.0.0.1', () => console.log(`PRTS demo: http://127.0.0.1:${port}`))
const stop = () => {
  server.close()
  server.closeAllConnections()
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
