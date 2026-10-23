import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseAssistantPreferences,
  parseKnowledgeResults,
  parseKnowledgeStatus,
  sourceUrl,
} from '../src/lib/assistant.ts'

test('assistant preferences preserve valid choices and recover from invalid persisted data', () => {
  assert.deepEqual(parseAssistantPreferences({ persona: 'amiya', knowledge: 'endfield' }), {
    persona: 'amiya',
    knowledge: 'endfield',
  })
  for (const value of [
    null,
    42,
    [],
    { knowledge: ['none'] },
    { persona: 'custom-system-prompt', knowledge: '../private' },
  ]) {
    assert.deepEqual(parseAssistantPreferences(value), { persona: 'prts', knowledge: 'all' })
  }
})

test('malformed corpus status is rejected before rendering and unavailable status is supported', () => {
  for (const value of [
    null,
    { ready: true, sources: [] },
    { ready: true, release: {}, sources: [], documentCount: 10 },
    { ready: true, release: 'v1', sources: [null], documentCount: 10 },
  ]) {
    assert.throws(() => parseKnowledgeStatus(value), /格式异常/)
  }
  assert.equal(
    parseKnowledgeStatus({ ready: false, release: null, sources: [], documentCount: 0 }).ready,
    false,
  )
})

test('reference URLs reject executable schemes and credentials while preserving source links', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,test',
    '//example.com',
    'https://name:password@example.com',
    'file:///private',
  ]) {
    assert.equal(sourceUrl(url), undefined)
  }
  assert.equal(sourceUrl('https://prts.wiki/w/Amiya'), 'https://prts.wiki/w/Amiya')
  const results = parseKnowledgeResults([
    {
      id: 'test',
      title: 'Amiya',
      source: 'arknights',
      sourceLabel: '明日方舟',
      url: 'javascript:alert(1)',
      excerpt: '原文',
      lineStart: -1,
    },
    { invalid: true },
  ])
  assert.equal(results.length, 1)
  assert.equal(results[0].url, '')
  assert.equal(results[0].lineStart, undefined)
})
