import assert from 'node:assert/strict'
import { createServer as httpServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createServer } from '../server/index.mjs'
import { createStorage } from '../server/storage.mjs'
import { createSettings } from '../server/settings.mjs'
import { createInitialWorkspace } from '../src/lib/workspace.ts'
import { createWorkspaceTools } from '../server/assistant-tools.mjs'

const PASSWORD = 'tools-test-password-only'
async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  return `http://127.0.0.1:${server.address().port}`
}
const toolCall = (name, args, id = randomUUID()) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})
const completion = (message) => ({ choices: [{ message }] })

async function fixture(t, reply) {
  const requests = []
  const upstream = await listen(
    t,
    httpServer(async (req, res) => {
      let text = ''
      for await (const chunk of req) text += chunk
      const body = JSON.parse(text)
      requests.push(body)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(completion(await reply(body, requests.length - 1))))
    }),
  )
  const uploadsDir = await mkdtemp(path.join(os.tmpdir(), 'prts-tool-uploads-'))
  t.after(() => rm(uploadsDir, { recursive: true, force: true }))
  const server = createServer({ env: { PRTS_PASSWORD: PASSWORD }, uploadsDir })
  const storage = createStorage(server.database, { uploadsDir })
  const workspace = createInitialWorkspace()
  workspace.settings.name = '工具测试博士'
  workspace.notes = [
    {
      id: 'note-tools',
      title: '项目暗号',
      content: '项目代号是晨星，周五交付。',
      tag: '项目',
      pinned: false,
      updatedAt: new Date().toISOString(),
    },
  ]
  storage.putDocument('workspace', {
    value: workspace,
    expectedRevision: 0,
    mutationId: randomUUID(),
  })
  const file = {
    id: 'file-tools',
    name: 'meeting.txt',
    type: 'text/plain',
    size: Buffer.byteLength('会议定于周三下午。'),
    createdAt: new Date().toISOString(),
    data: Buffer.from('会议定于周三下午。').toString('base64'),
  }
  storage.putFiles([file])
  const settings = createSettings(server.database)
  settings.update({
    baseUrl: upstream,
    model: 'tool-model',
    apiKey: 'private-provider-test-key',
    revision: settings.read().revision,
  })
  const base = await listen(t, server)
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const call = (route, data, method = data === undefined ? 'GET' : 'POST') =>
    fetch(`${base}${route}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
  const chat = () =>
    call('/api/chat', {
      messages: [
        {
          role: 'user',
          content: '查看我的任务、项目笔记和会议文件，再为我准备一个高优先级任务：跟进晨星。',
        },
      ],
      knowledge: 'none',
    })
  return { base, server, storage, workspace, requests, call, chat }
}

test('AI receives live workspace context and callable tools while credentials stay private', async (t) => {
  const client = await fixture(t, () => ({ content: '我能看到你的工作台。' }))
  const response = await client.chat()
  assert.equal(response.status, 200)
  assert.ok(client.requests[0].tools.some((tool) => tool.function.name === 'search_workspace'))
  const prompt = client.requests[0].messages[0].content
  assert.match(prompt, /工具测试博士|完善个人作品集/)
  assert.match(prompt, /项目暗号/)
  assert.doesNotMatch(
    prompt,
    /private-provider-test-key|tools-test-password-only|password-credential/,
  )
})

test('saved persona reaches every tool round and foreign persona history never reaches the provider', async (t) => {
  const client = await fixture(t, (_body, round) =>
    round === 0
      ? { content: null, tool_calls: [toolCall('get_workspace', {})] }
      : { content: '博士，我已经核对了工作台。' },
  )
  client.storage.putDocument('preferences', {
    value: {
      motionEnabled: false,
      assistantMode: 'ai',
      assistant: { persona: 'amiya', knowledge: 'none' },
    },
    expectedRevision: 0,
    mutationId: randomUUID(),
  })
  const response = await client.call('/api/chat', {
    messages: [
      { role: 'user', content: '凯尔希的旧问题', persona: 'kaltsit' },
      { role: 'assistant', content: '凯尔希的旧回答', persona: 'kaltsit' },
      { role: 'user', content: '请查看工作台', persona: 'amiya' },
    ],
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).persona, 'amiya')
  assert.equal(client.requests.length, 2)
  for (const body of client.requests) {
    assert.match(body.messages[0].content, /IDENTITY_AMIYA/)
    assert.match(body.messages[0].content, /温柔但意志坚定/)
    assert.ok(body.messages.every((m) => !Object.hasOwn(m, 'persona')))
    assert.ok(!JSON.stringify(body.messages).includes('凯尔希的旧'))
  }
  assert.equal(client.requests[1].messages.at(-1).role, 'tool')
  const explicit = await client.call('/api/chat', {
    persona: 'kaltsit',
    messages: [{ role: 'user', content: '你好' }],
  })
  assert.equal((await explicit.json()).persona, 'kaltsit')
  assert.match(client.requests.at(-1).messages[0].content, /IDENTITY_KALTSIT/)
  for (const messages of [
    [{ role: 'user', content: '错误人格', persona: 'custom' }],
    [{ role: 'user', content: '错误会话', persona: 'prts' }],
    [{ role: 'assistant', content: '缺少新问题', persona: 'amiya' }],
  ])
    assert.equal((await client.call('/api/chat', { messages })).status, 400)
  assert.equal(client.requests.length, 3)
})

test('message HTTP scopes preserve other personas and local commands when clearing', async (t) => {
  const client = await fixture(t, () => ({ content: '测试回复' }))
  const messages = [
    { id: 'local-turn', role: 'user', content: '本地', mode: 'local' },
    { id: 'amiya-turn', role: 'user', content: '阿米娅', mode: 'ai', persona: 'amiya' },
    { id: 'prts-turn', role: 'user', content: 'PRTS', mode: 'ai', persona: 'prts' },
  ]
  assert.equal((await client.call('/api/messages', { messages })).status, 200)
  const scoped = await (await client.call('/api/messages?mode=ai&persona=amiya')).json()
  assert.deepEqual(scoped.messages, [messages[1]])
  assert.equal(
    (await client.call('/api/messages?mode=ai&persona=amiya', undefined, 'DELETE')).status,
    200,
  )
  assert.deepEqual((await (await client.call('/api/messages')).json()).messages, [
    messages[0],
    messages[2],
  ])
})

test('real tool loop reads SQLite and attachments, prepares changes and confirms them once', async (t) => {
  const client = await fixture(t, (body, round) => {
    if (round === 0)
      return {
        content: null,
        tool_calls: [toolCall('search_workspace', { query: '项目', kind: 'notes' })],
      }
    if (round === 1)
      return {
        content: null,
        tool_calls: [
          toolCall('read_workspace_item', { kind: 'note', id: 'note-tools' }),
          toolCall('read_workspace_item', { kind: 'file', id: 'file-tools' }),
        ],
      }
    if (round === 2)
      return {
        content: null,
        tool_calls: [
          toolCall('propose_workspace_change', {
            operation: 'create_task',
            fields: { title: '跟进晨星', priority: 'high' },
          }),
        ],
      }
    return { content: '晨星项目周五交付，会议在周三。任务已准备，请确认操作卡片。' }
  })
  const response = await client.chat()
  assert.equal(response.status, 200)
  const answer = await response.json()
  assert.equal(answer.actions.length, 1)
  assert.equal(answer.toolsUsed.length, 4)
  const toolMessages = client.requests.at(-1).messages.filter((message) => message.role === 'tool')
  assert.ok(toolMessages.some((message) => message.content.includes('项目代号是晨星')))
  assert.ok(toolMessages.some((message) => message.content.includes('会议定于周三')))
  assert.equal(
    client.storage.getDocument('workspace').value.tasks.some((task) => task.title === '跟进晨星'),
    false,
  )
  const action = answer.actions[0]
  assert.equal((await fetch(`${client.base}/api/assistant/actions/${action.id}`)).status, 401)
  const apply = () => client.call(`/api/assistant/actions/${action.id}`, { decision: 'apply' })
  assert.equal((await apply()).status, 200)
  assert.equal((await apply()).status, 200)
  assert.equal(
    client.storage.getDocument('workspace').value.tasks.filter((task) => task.title === '跟进晨星')
      .length,
    1,
  )
  assert.equal(
    (await (await client.call(`/api/assistant/actions/${action.id}`)).json()).action.status,
    'applied',
  )
  const stored = await client.call('/api/messages', {
    messages: [
      {
        id: randomUUID(),
        role: 'assistant',
        mode: 'ai',
        content: answer.message,
        actions: answer.actions,
        toolsUsed: answer.toolsUsed,
      },
    ],
  })
  assert.equal(stored.status, 200)
  const history = await (await client.call('/api/messages')).json()
  assert.equal(history.messages[0].actions[0].id, action.id)
})

test('stale and dismissed operations never overwrite current workspace data', async (t) => {
  const client = await fixture(t, (body, round) =>
    round % 2 === 0
      ? {
          content: null,
          tool_calls: [
            toolCall('propose_workspace_change', {
              operation: 'update_note',
              id: 'note-tools',
              fields: { content: '待确认的新内容' },
            }),
          ],
        }
      : { content: '请确认笔记。' },
  )
  const first = await (await client.chat()).json()
  const current = client.storage.getDocument('workspace')
  current.value.notes[0].content = '其他页面修改'
  client.storage.putDocument('workspace', {
    value: current.value,
    expectedRevision: current.revision,
    mutationId: randomUUID(),
  })
  assert.equal(
    (await client.call(`/api/assistant/actions/${first.actions[0].id}`, { decision: 'apply' }))
      .status,
    409,
  )
  assert.equal(client.storage.getDocument('workspace').value.notes[0].content, '其他页面修改')
  const second = await (await client.chat()).json()
  const url = `/api/assistant/actions/${second.actions[0].id}`
  assert.equal((await client.call(url, { decision: 'dismiss' })).status, 200)
  assert.equal((await client.call(url, { decision: 'apply' })).status, 409)
  assert.equal(client.storage.getDocument('workspace').value.notes.length, 1)
})

test('unknown tools and invalid arguments are returned as tool errors without granting arbitrary access', async (t) => {
  const client = await fixture(t, (body, round) =>
    round === 0
      ? {
          content: null,
          tool_calls: [
            toolCall('execute_sql', { sql: 'SELECT * FROM auth_metadata' }),
            toolCall('read_workspace_item', { kind: 'file', id: '../../.env' }),
            {
              ...toolCall('search_workspace', {}),
              function: { name: 'search_workspace', arguments: '{bad json' },
            },
          ],
        }
      : { content: '这些操作不可用。' },
  )
  const response = await client.chat()
  assert.equal(response.status, 200)
  const sent = client.requests[1].messages.filter((message) => message.role === 'tool')
  assert.equal(sent.length, 3)
  assert.ok(sent.every((message) => JSON.parse(message.content).error))
  assert.doesNotMatch(JSON.stringify(sent), /private-provider-test-key|tools-test-password-only/)
})

test('an endless tool sequence is bounded and returns a clear error', async (t) => {
  const client = await fixture(t, () => ({
    content: null,
    tool_calls: [toolCall('get_workspace', {})],
  }))
  const response = await client.chat()
  assert.equal(response.status, 502)
  assert.ok(client.requests.length <= 6)
  assert.match((await response.json()).error, /工具|调用/)
})

test('independent task proposals can be confirmed together without creating duplicates', async (t) => {
  const client = await fixture(t, () => ({ content: 'ok' }))
  const tools = createWorkspaceTools(client.server.database, client.storage)
  const session = tools.session()
  const proposals = ['多任务A', '多任务B'].map(
    (title) =>
      session.execute(
        'propose_workspace_change',
        JSON.stringify({ operation: 'create_task', fields: { title } }),
      ).action,
  )
  for (const action of proposals)
    assert.equal(tools.decide(action.id, 'apply').action.status, 'applied')
  for (const action of proposals) tools.decide(action.id, 'apply')
  assert.equal(
    client.storage
      .getDocument('workspace')
      .value.tasks.filter((task) => task.title.startsWith('多任务')).length,
    2,
  )
})

test('action approval and document mutation roll back together when the action write fails', async (t) => {
  const client = await fixture(t, () => ({ content: 'ok' }))
  const tools = createWorkspaceTools(client.server.database, client.storage)
  const result = tools
    .session()
    .execute(
      'propose_workspace_change',
      JSON.stringify({ operation: 'create_task', fields: { title: '不应写入' } }),
    )
  client.server.database.exec(
    "CREATE TRIGGER fail_action BEFORE UPDATE ON prts_assistant_actions BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
  )
  assert.throws(() => tools.decide(result.action.id, 'apply'))
  assert.equal(
    client.storage.getDocument('workspace').value.tasks.some((task) => task.title === '不应写入'),
    false,
  )
  assert.equal(tools.getAction(result.action.id).status, 'pending')
})

test('category, task, note, preference and focus operations preserve valid workspace state', async (t) => {
  const client = await fixture(t, () => ({ content: 'ok' }))
  const tools = createWorkspaceTools(client.server.database, client.storage)
  function apply(operation, fields = {}, id) {
    const result = tools
      .session()
      .execute(
        'propose_workspace_change',
        JSON.stringify({ operation, fields, ...(id ? { id } : {}) }),
      )
    assert.ok(result.action, JSON.stringify(result))
    return tools.decide(result.action.id, 'apply')
  }
  apply('create_category', { name: 'AI 分类' })
  const category = client.storage
    .getDocument('workspace')
    .value.taskCategories.find((item) => item.name === 'AI 分类')
  apply('create_task', { title: '分类中的任务', categoryId: category.id })
  const task = client.storage
    .getDocument('workspace')
    .value.tasks.find((item) => item.title === '分类中的任务')
  apply('update_task', { done: true }, task.id)
  assert.equal(
    client.storage.getDocument('workspace').value.tasks.find((item) => item.id === task.id).done,
    true,
  )
  apply('delete_category', {}, category.id)
  assert.equal(
    client.storage.getDocument('workspace').value.tasks.find((item) => item.id === task.id)
      .categoryId,
    '',
  )
  apply('update_note', { content: '更新后的项目记录', pinned: true }, 'note-tools')
  assert.equal(client.storage.getDocument('workspace').value.notes[0].content, '更新后的项目记录')
  apply('update_settings', { focusMinutes: 10 })
  apply('start_focus')
  assert.equal(client.storage.getDocument('focus').value.remaining, 600)
  assert.ok(client.storage.getDocument('focus').value.endAt > Date.now())
  apply('pause_focus')
  assert.equal(client.storage.getDocument('focus').value.endAt, null)
  apply('reset_focus')
  assert.equal(client.storage.getDocument('focus').value.sessionId, null)
  const rejected = tools
    .session()
    .execute(
      'propose_workspace_change',
      JSON.stringify({ operation: 'update_settings', fields: { apiKey: 'not-allowed' } }),
    )
  assert.ok(rejected.error)
})

test('expired actions cannot be applied and current data remains intact', async (t) => {
  const client = await fixture(t, () => ({ content: 'ok' }))
  let time = Date.now()
  const tools = createWorkspaceTools(client.server.database, client.storage, { now: () => time })
  const result = tools
    .session()
    .execute(
      'propose_workspace_change',
      JSON.stringify({ operation: 'delete_note', id: 'note-tools' }),
    )
  time += 31 * 60_000
  assert.equal(tools.getAction(result.action.id).status, 'expired')
  assert.throws(() => tools.decide(result.action.id, 'apply'), { status: 409 })
  assert.equal(client.storage.getDocument('workspace').value.notes.length, 1)
})
