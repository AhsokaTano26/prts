import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCorpusSyncStatus, syncProgress, syncDescription } from '../src/lib/corpusSync.ts'

const job = {
  state: 'running',
  phase: 'downloading',
  completedFiles: 3,
  totalFiles: 10,
  completedBytes: 30,
  totalBytes: 100,
  release: 'release-1',
  startedAt: '2026-10-23T00:00:00Z',
  finishedAt: null,
  error: null,
  result: null,
} as const

test('corpus progress comes from verified server totals and handles an unknown total', () => {
  assert.equal(syncProgress(parseCorpusSyncStatus(job)), 30)
  assert.equal(syncProgress({ ...job, totalBytes: 0 }), undefined)
  assert.equal(syncProgress({ ...job, completedBytes: 101 }), 100)
  assert.match(syncDescription({ ...job, state: 'succeeded', result: 'current' }), /最新版本/)
  assert.match(syncDescription({ ...job, state: 'failed' }), /未完成/)
})

test('malformed sync payloads cannot silently display a valid progress state', () => {
  for (const value of [
    null,
    {},
    { ...job, totalBytes: -1 },
    { ...job, completedBytes: '30' },
    { ...job, state: 'done' },
    { ...job, phase: {} },
    { ...job, error: {} },
  ]) {
    assert.throws(() => parseCorpusSyncStatus(value), /格式异常/)
  }
})
