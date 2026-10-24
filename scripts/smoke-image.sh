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
  "$1")

check_container() {
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
const manifestResponse = await get('/manifest.webmanifest')
assert.equal(manifestResponse.status, 200)
assert.match(manifestResponse.headers.get('content-type'), /application\/manifest\+json/)
assert.equal((await manifestResponse.json()).display, 'standalone')
const workerResponse = await get('/sw.js')
assert.equal(workerResponse.status, 200)
assert.match(workerResponse.headers.get('content-type'), /javascript/)
assert.match(workerResponse.headers.get('cache-control'), /no-cache/)
await workerResponse.body?.cancel()
for (const path of ['/offline.html', '/icons/rhodes-island-512.png', '/rhodes-island.svg', '/branding/rhodes-island.png']) {
  const response = await get(path)
  assert.equal(response.status, 200)
  await response.body?.cancel()
}

assert.ok(statSync('/app/data/prts.sqlite').isFile(), 'SQLite file was not created')
const database = new DatabaseSync('/app/data/prts.sqlite', { readOnly: true })
for (const table of ['prts_documents', 'prts_messages', 'prts_files', 'prts_passkeys', 'prts_passkey_challenges']) {
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
}

check_container
docker restart "$container" >/dev/null
check_container
# The generated test-container password must appear once, including after restart.
# Consume logs without printing the password into the CI step output.
docker logs "$container" 2>/dev/null | node --input-type=module -e '
import assert from "node:assert/strict";
let logs = "";
for await (const part of process.stdin) logs += part;
const generated = logs.match(/PRTS 初始访问密码（仅显示一次）：[A-Za-z0-9_-]{32,}/g) || [];
assert.equal(generated.length, 1, "First-run password must be generated and logged exactly once");
console.log("Password bootstrap check passed: no environment file and one-time log across restart.");
'

# Read real stdout/stderr, including after restart; never print bootstrap credentials.
docker logs "$container" 2>&1 | node --input-type=module -e '
import assert from "node:assert/strict";
let logs = "";
for await (const part of process.stdin) logs += part;
const records = logs.split("\n").flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
assert.equal(records.filter((row) => row.event === "server.started").length, 2, "Every container start must emit a runtime log");
assert.ok(records.some((row) => row.event === "server.stopped"), "Graceful restart must log shutdown");
for (const [path, status, level] of [["/", 200, "info"], ["/api/state", 401, "warn"]]) {
  const requests = records.filter((row) => row.event === "http.request" && row.path === path && row.status === status && row.level === level);
  assert.ok(requests.length >= 2, `Requests must remain visible after restart: ${path}`);
  assert.ok(requests.every((row) => Number.isFinite(row.durationMs) && row.requestId && row.time));
}
console.log("Container runtime log check passed: startup, shutdown, HTTP status and timing remain visible across restart.");
'
