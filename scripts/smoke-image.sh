#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "Usage: bash scripts/smoke-image.sh IMAGE" >&2
  exit 2
fi

container=''
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$container" ]]; then
    if [[ "$status" -ne 0 ]]; then docker logs "$container" >&2 || true; fi
    docker rm --force --volumes "$container" >/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# No host mounts, published ports, credentials, or outbound network access.
container=$(docker run --detach --pull never --network none \
  --env PRTS_PASSWORD=prts-image-smoke-test-only \
  --env PRTS_COOKIE_SECURE=false \
  "$1")

docker exec --interactive "$container" node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'

const base = 'http://127.0.0.1:8787'
const get = (path) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(1000) })
const deadline = Date.now() + 30_000
let session
while (Date.now() < deadline) {
  try {
    const response = await get('/api/auth/session')
    assert.equal(response.status, 200)
    session = await response.json()
    break
  } catch {
    await delay(250)
  }
}
assert.ok(session, 'Server did not become ready within 30 seconds')
assert.equal(session.configured, true)
assert.equal(session.authenticated, false)

for (const [path, status] of [['/', 200], ['/api/state', 401]]) {
  const response = await get(path)
  assert.equal(response.status, status, `Unexpected status for ${path}`)
  await response.body?.cancel()
}

assert.ok(statSync('/app/data/prts.sqlite').isFile(), 'SQLite file was not created')
const database = new DatabaseSync('/app/data/prts.sqlite', { readOnly: true })
for (const table of ['prts_documents', 'prts_messages', 'prts_files']) {
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0)
}
database.close()
for (const directory of ['corpus', 'assets', 'uploads']) {
  const path = `/app/data/${directory}`
  if (existsSync(path)) assert.deepEqual(readdirSync(path), [], `${path} must start empty`)
}
assert.deepEqual(readdirSync('/app').filter((name) => /^\.env(?:\.|$)/.test(name)), [])
assert.equal(existsSync('/app/public/assets'), false, 'Game assets must not be bundled')
console.log('Image smoke check passed: HTTP, authentication, SQLite, and empty resource storage.')
NODE
