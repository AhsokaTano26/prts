import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

test('online backup includes committed WAL data, passes integrity checks and refuses overwrite', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prts-backup-'))
  const source = path.join(directory, 'original.sqlite')
  const target = path.join(directory, 'backup.sqlite')
  const db = new DatabaseSync(source)
  t.after(async () => {
    db.close()
    await rm(directory, { recursive: true, force: true })
  })
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE example(value TEXT); INSERT INTO example VALUES ('committed WAL data')",
  )
  const run = () =>
    spawnSync(process.execPath, ['scripts/backup.mjs', target], {
      encoding: 'utf8',
      env: { ...process.env, PRTS_DB_PATH: source },
    })
  const first = run()
  assert.equal(first.status, 0, first.stderr)
  const copy = new DatabaseSync(target, { readOnly: true })
  assert.equal(copy.prepare('SELECT value FROM example').get().value, 'committed WAL data')
  assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check, 'ok')
  copy.close()
  assert.equal((await stat(target)).mode & 0o777, 0o600)
  const second = run()
  assert.notEqual(second.status, 0)
  assert.match(second.stderr, /已存在/)
})
