import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { resolveConfig } from 'vite'
import { getAppVersion } from '../scripts/version.ts'

test('Vite exposes the current Git version to the page at build time', async () => {
  const version = execFileSync(
    'git',
    ['describe', '--tags', '--match', 'v[0-9]*', '--always', '--abbrev=7', '--dirty'],
    { encoding: 'utf8' },
  ).trim()
  const config = await resolveConfig({}, 'build')
  assert.equal(
    config.define?.__APP_VERSION__,
    JSON.stringify(process.env.PRTS_VERSION?.trim() || version),
  )
})

test('an explicit Docker build version takes precedence over the checkout version', async (t) => {
  const previous = process.env.PRTS_VERSION
  t.after(() => {
    if (previous === undefined) delete process.env.PRTS_VERSION
    else process.env.PRTS_VERSION = previous
  })
  process.env.PRTS_VERSION = ' v9.8.7-2-gabcdef0 '
  const config = await resolveConfig({}, 'build')
  assert.equal(config.define?.__APP_VERSION__, JSON.stringify('v9.8.7-2-gabcdef0'))
})

test('a source archive without Git metadata is clearly marked as a local package build', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prts-version-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '2.3.4' }))
  assert.equal(getAppVersion(root), 'v2.3.4-local')
  assert.equal(getAppVersion(root, '  '), 'v2.3.4-local')
  assert.equal(getAppVersion(root, 'v3.0.0'), 'v3.0.0')
})
