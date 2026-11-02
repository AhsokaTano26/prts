import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAssistantActions, parseToolUsage } from '../src/lib/assistantTools.ts'

test('larger replies parse fifty action cards while rejecting an extra card', () => {
  const actions = Array.from({ length: 51 }, () => ({
    id: crypto.randomUUID(),
    operation: 'create_task',
    summary: '新建任务',
    preview: '任务内容',
    status: 'pending',
    expiresAt: Date.now() + 10000,
  }))
  assert.equal(parseAssistantActions(actions.slice(0, 50)).length, 50)
  assert.throws(() => parseAssistantActions(actions), /格式/)
})

test('tool history accepts thirty-two calls and keeps the upper bound', () => {
  const usage = Array.from({ length: 33 }, () => ({ name: 'get_workspace', status: 'ok' }))
  assert.equal(parseToolUsage(usage.slice(0, 32)).length, 32)
  assert.throws(() => parseToolUsage(usage), /格式/)
})
