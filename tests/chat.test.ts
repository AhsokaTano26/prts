import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildChatHistory,
  runLocalCommand,
  withChatCancellation,
  type ChatTurn,
} from '../src/lib/chat.ts'
import { createInitialWorkspace } from '../src/lib/workspace.ts'

test('one local task command creates exactly one task with the supplied title', () => {
  const created: string[] = []
  const reply = runLocalCommand('新建任务：整理阅读笔记', createInitialWorkspace(), (title) =>
    created.push(title),
  )
  assert.deepEqual(created, ['整理阅读笔记'])
  assert.match(reply, /已添加任务「整理阅读笔记」/)
})

test('an overlong local task command does not create a task', () => {
  const created: string[] = []
  const reply = runLocalCommand(
    `添加任务：${'长'.repeat(201)}`,
    createInitialWorkspace(),
    (title) => created.push(title),
  )
  assert.deepEqual(created, [])
  assert.match(reply, /最多 200 个字符/)
})

test('the built-in view notes command lists notes without creating tasks', () => {
  const workspace = createInitialWorkspace()
  const created: string[] = []
  const reply = runLocalCommand('查看笔记', workspace, (title) => created.push(title))
  assert.deepEqual(created, [])
  assert.match(reply, new RegExp(`找到了 ${workspace.notes.length} 篇笔记`))
  assert.ok(reply.includes(workspace.notes[0].title))
})

test('chat context keeps prior turns and puts the current request last', () => {
  const history: ChatTurn[] = [
    { role: 'user', content: '旧问题' },
    { role: 'assistant', content: '先前回答' },
  ]
  const before = structuredClone(history)
  assert.deepEqual(buildChatHistory(history, '  新问题  '), [
    { role: 'user', content: '旧问题' },
    { role: 'assistant', content: '先前回答' },
    { role: 'user', content: '新问题' },
  ])
  assert.deepEqual(history, before)
})

test('long assistant replies cannot make the next request exceed the per-message limit', () => {
  const result = buildChatHistory([{ role: 'assistant', content: 'a'.repeat(13_000) }], '继续')
  assert.deepEqual(result, [
    { role: 'assistant', content: 'a'.repeat(12_000) },
    { role: 'user', content: '继续' },
  ])
})

test('context reserves the full current input and drops the oldest content to fit the total budget', () => {
  const history: ChatTurn[] = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: String(index).repeat(12_000),
  }))
  const result = buildChatHistory(history, 'new'.repeat(4_000))
  assert.equal(
    result.reduce((total, message) => total + message.content.length, 0),
    80_000,
  )
  assert.ok(result.every((message) => message.content.length <= 12_000))
  assert.deepEqual(result.at(-1), { role: 'user', content: 'new'.repeat(4_000) })
  assert.equal(result[0].content, '4'.repeat(8_000))
  assert.equal(result.at(-2)?.content, '9'.repeat(12_000))
  assert.equal(result.length, 7)
})

test('context keeps at most 40 messages including the newest user request', () => {
  const history: ChatTurn[] = Array.from({ length: 60 }, (_, index) => ({
    role: 'user',
    content: `old-${index}`,
  }))
  const result = buildChatHistory(history, 'new')
  assert.equal(result.length, 40)
  assert.deepEqual(result[0], { role: 'user', content: 'old-21' })
  assert.deepEqual(result.at(-1), { role: 'user', content: 'new' })
})

test('empty stored messages are omitted from outgoing context', () => {
  assert.deepEqual(
    buildChatHistory(
      [
        { role: 'assistant', content: '   ' },
        { role: 'user', content: '' },
      ],
      '继续',
    ),
    [{ role: 'user', content: '继续' }],
  )
})

test('invalid current input is rejected instead of silently changing the request', () => {
  assert.throws(() => buildChatHistory([], ' \n '), /不能为空/)
  assert.throws(() => buildChatHistory([], 'x'.repeat(12_001)), /12000/)
  assert.deepEqual(buildChatHistory([], 'x'.repeat(12_000)), [
    { role: 'user', content: 'x'.repeat(12_000) },
  ])
})

test('persona context excludes both sides of other conversations and labels the new turn', () => {
  const history = [
    { role: 'user' as const, content: 'PRTS问题', persona: 'prts' as const },
    { role: 'assistant' as const, content: 'PRTS回答', persona: 'prts' as const },
    { role: 'user' as const, content: '阿米娅问题', persona: 'amiya' as const },
    { role: 'assistant' as const, content: '阿米娅回答', persona: 'amiya' as const },
    { role: 'assistant' as const, content: '未标记的旧回复' },
  ]
  assert.deepEqual(buildChatHistory(history, '继续', { persona: 'amiya' }), [
    { role: 'user', content: '阿米娅问题', persona: 'amiya' },
    { role: 'assistant', content: '阿米娅回答', persona: 'amiya' },
    { role: 'user', content: '继续', persona: 'amiya' },
  ])
})

test('cancellation finishes without waiting for an uncooperative response and ignores its late result', async () => {
  const controller = new AbortController()
  let finish: (value: string) => void = () => {}
  const response = withChatCancellation(
    controller.signal,
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  )
  controller.abort()
  await assert.rejects(response, { name: 'AbortError' })
  finish('迟来的回复')
  await assert.rejects(response, { name: 'AbortError' })
  let called = false
  await assert.rejects(
    withChatCancellation(controller.signal, async () => {
      called = true
      return ''
    }),
    { name: 'AbortError' },
  )
  assert.equal(called, false)
  assert.equal(
    await withChatCancellation(new AbortController().signal, async () => '正常回复'),
    '正常回复',
  )
})
