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

function autoConfirm(client, enabled) {
  const current = client.storage.getDocument('preferences')
  client.storage.putDocument('preferences', {
    value: {
      motionEnabled: true,
      assistant: { persona: 'prts', knowledge: 'none' },
      assistantMode: 'ai',
      ...current?.value,
      assistantAutoConfirm: enabled,
    },
    expectedRevision: current?.revision ?? 0,
    mutationId: randomUUID(),
  })
}

test('chat advertises calendar tools, uses client dates and confirms a real calendar mutation', async (t) => {
  const client = await fixture(t, (body, round) => {
    if (round === 0)
      return {
        content: null,
        tool_calls: [
          toolCall('get_workspace', {}),
          toolCall('search_workspace', {
            kind: 'events',
            fromDate: '2026-10-27',
            toDate: '2026-10-27',
          }),
        ],
      }
    if (round === 1) {
      const found = JSON.parse(body.messages.at(-1).content)
      if (found.error) return { content: `日程查询失败：${found.error}` }
      return {
        content: null,
        tool_calls: [
          toolCall('propose_workspace_change', {
            operation: 'create_calendar_event',
            fields: {
              title: 'AI 日程集成',
              allDay: false,
              location: '评审室',
              startAt: '2026-10-27T15:00:00+08:00',
              endAt: '2026-10-27T16:00:00+08:00',
            },
          }),
        ],
      }
    }
    return { content: '博士，日程已准备，等待确认。' }
  })
  const current = client.storage.getDocument('workspace')
  current.value.calendarEvents = [
    {
      id: 'calendar-seed',
      title: '本地今天的安排',
      description: '',
      location: '',
      allDay: false,
      startAt: '2026-10-26T16:00:00Z',
      endAt: '2026-10-26T17:00:00Z',
      createdAt: '2026-10-26T00:00:00Z',
      updatedAt: '2026-10-26T00:00:00Z',
    },
  ]
  client.storage.putDocument('workspace', {
    value: current.value,
    expectedRevision: current.revision,
    mutationId: randomUUID(),
  })
  const response = await client.call('/api/chat', {
    messages: [
      { role: 'user', content: '查看我10月27日的安排，再新建15:00到16:00的日程：AI 日程集成' },
    ],
    knowledge: 'none',
    timeZone: 'Asia/Shanghai',
  })
  assert.equal(response.status, 200)
  const result = await response.json()
  const advertised = client.requests[0].tools
  const mutationSchema = advertised.find(
    (item) => item.function.name === 'propose_workspace_change',
  ).function.parameters.properties
  assert.ok(mutationSchema.operation.enum.includes('create_calendar_event'))
  assert.ok(mutationSchema.fields.properties.startAt)
  const reads = client.requests[1].messages
    .filter((item) => item.role === 'tool')
    .map((item) => JSON.parse(item.content))
  assert.equal(reads[0].timeZone, 'Asia/Shanghai')
  assert.equal(reads[1].error, undefined)
  assert.deepEqual(
    reads[1].results.map((item) => item.id),
    ['calendar-seed'],
  )
  assert.equal(result.actions?.length, 1)
  assert.equal(result.actions[0].status, 'pending')
  assert.equal(client.storage.getDocument('workspace').value.calendarEvents.length, 1)
  assert.equal(
    (await client.call(`/api/assistant/actions/${result.actions[0].id}`, { decision: 'apply' }))
      .status,
    200,
  )
  const created = client.storage
    .getDocument('workspace')
    .value.calendarEvents.find((item) => item.title === 'AI 日程集成')
  assert.equal(created.startAt, '2026-10-27T15:00:00+08:00')
  assert.equal(created.location, '评审室')
})

test('invalid client timezones are rejected before contacting the provider while old clients remain compatible', async (t) => {
  const client = await fixture(t, () => ({ content: '已读取。' }))
  for (const timeZone of [null, 42, '../private', 'x'.repeat(101)]) {
    const response = await client.call('/api/chat', {
      messages: [{ role: 'user', content: '查看日程' }],
      knowledge: 'none',
      timeZone,
    })
    assert.equal(response.status, 400)
  }
  assert.equal(client.requests.length, 0)
  assert.equal((await client.chat()).status, 200)
})

test('one authenticated batch confirms multiple changes atomically and repeat requests are idempotent', async (t) => {
  const client = await fixture(t, () => ({ content: 'ok' }))
  const tools = createWorkspaceTools(client.server.database, client.storage)
  const session = tools.session()
  const actions = ['合并确认 A', '合并确认 B'].map(
    (title) =>
      session.execute(
        'propose_workspace_change',
        JSON.stringify({ operation: 'create_task', fields: { title } }),
      ).action,
  )
  const ids = actions.map((action) => action.id)
  const url = '/api/assistant/actions/batch'
  assert.equal(
    (
      await fetch(`${client.base}${url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, decision: 'apply' }),
      })
    ).status,
    401,
  )
  const read = await client.call(`/api/assistant/actions?ids=${ids.join(',')}`)
  assert.equal(read.status, 200)
  assert.ok((await read.json()).actions.every((action) => action.status === 'pending'))
  for (let retry = 0; retry < 2; retry++) {
    const response = await client.call(url, { ids, decision: 'apply' })
    assert.equal(response.status, 200)
    assert.ok((await response.json()).actions.every((action) => action.status === 'applied'))
  }
  assert.equal(
    client.storage
      .getDocument('workspace')
      .value.tasks.filter((task) => task.title.startsWith('合并确认')).length,
    2,
  )
  assert.equal((await client.call(url, { ids: [ids[0], ids[0]], decision: 'apply' })).status, 400)
})

test('a conflicting or failed batch writes none of its proposed changes', async (t) => {
  const client = await fixture(t, () => ({ content: 'ok' }))
  const tools = createWorkspaceTools(client.server.database, client.storage)
  const session = tools.session()
  const first = session.execute(
    'propose_workspace_change',
    JSON.stringify({ operation: 'create_task', fields: { title: '整批回滚任务' } }),
  ).action
  const second = session.execute(
    'propose_workspace_change',
    JSON.stringify({ operation: 'update_note', id: 'note-tools', fields: { content: '计划内容' } }),
  ).action
  const initial = client.storage.getDocument('workspace')
  client.server.database.exec(
    `CREATE TRIGGER fail_batch BEFORE UPDATE ON prts_assistant_actions WHEN NEW.id='${second.id}' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
  )
  assert.throws(() => tools.decideBatch([first.id, second.id], 'apply'))
  assert.deepEqual(client.storage.getDocument('workspace'), initial)
  assert.equal(tools.getAction(first.id).status, 'pending')
  client.server.database.exec('DROP TRIGGER fail_batch')
  initial.value.notes[0].content = '另一页面的新内容'
  client.storage.putDocument('workspace', {
    value: initial.value,
    expectedRevision: initial.revision,
    mutationId: randomUUID(),
  })
  assert.throws(() => tools.decideBatch([first.id, second.id], 'apply'), { status: 409 })
  assert.equal(
    client.storage
      .getDocument('workspace')
      .value.tasks.some((task) => task.title === '整批回滚任务'),
    false,
  )
  assert.equal(tools.getAction(second.id).status, 'pending')
})

test('batched edits of the same item compose in order and cancellation applies to the whole batch', async (t) => {
  const client = await fixture(t, () => ({ content: 'ok' }))
  const tools = createWorkspaceTools(client.server.database, client.storage)
  const session = tools.session()
  const ids = [{ content: '合并后的正文' }, { pinned: true }].map(
    (fields) =>
      session.execute(
        'propose_workspace_change',
        JSON.stringify({ operation: 'update_note', id: 'note-tools', fields }),
      ).action.id,
  )
  tools.decideBatch(ids, 'apply')
  assert.equal(client.storage.getDocument('workspace').value.notes[0].content, '合并后的正文')
  assert.equal(client.storage.getDocument('workspace').value.notes[0].pinned, true)
  const cancelled = ['取消 A', '取消 B'].map(
    (title) =>
      session.execute(
        'propose_workspace_change',
        JSON.stringify({ operation: 'create_task', fields: { title } }),
      ).action.id,
  )
  assert.ok(
    tools
      .decideBatch(cancelled, 'dismiss')
      .actions.every((action) => action.status === 'dismissed'),
  )
  assert.throws(() => tools.decideBatch(cancelled, 'apply'), { status: 409 })
})

test('saved automatic confirmation executes the complete successful reply and reports actual statuses', async (t) => {
  const client = await fixture(t, (_body, round) =>
    round === 0
      ? {
          content: null,
          tool_calls: ['自动执行 A', '自动执行 B'].map((title) =>
            toolCall('propose_workspace_change', { operation: 'create_task', fields: { title } }),
          ),
        }
      : { content: '博士，我会统一处理这两项任务。' },
  )
  autoConfirm(client, true)
  const response = await client.chat()
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.actionConfirmation, 'automatic')
  assert.ok(result.actions.every((action) => action.status === 'applied'))
  assert.equal(
    client.storage
      .getDocument('workspace')
      .value.tasks.filter((task) => task.title.startsWith('自动执行')).length,
    2,
  )
  assert.match(client.requests[0].messages[0].content, /自动确认/)
  const toolResult = JSON.parse(
    client.requests[1].messages.filter((message) => message.role === 'tool')[0].content,
  )
  assert.equal(toolResult.requiresConfirmation, false)
})

test('request flags cannot enable auto confirmation and failed replies never execute prepared changes', async (t) => {
  let fail = false
  const client = await fixture(t, (_body, round) =>
    round % 2 === 0
      ? {
          content: null,
          tool_calls: [
            toolCall('propose_workspace_change', {
              operation: 'create_task',
              fields: { title: '不应自动执行' },
            }),
          ],
        }
      : { content: fail ? '' : '请确认本轮操作。' },
  )
  const response = await client.call('/api/chat', {
    messages: [{ role: 'user', content: '创建任务' }],
    knowledge: 'none',
    autoConfirm: true,
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).actions[0].status, 'pending')
  autoConfirm(client, true)
  fail = true
  assert.equal((await client.chat()).status, 502)
  assert.equal(
    client.storage
      .getDocument('workspace')
      .value.tasks.some((task) => task.title === '不应自动执行'),
    false,
  )
})

test('automatic confirmation falls back to a visible pending batch if concurrent edits conflict', async (t) => {
  let client
  client = await fixture(t, (_body, round) => {
    if (round === 0)
      return {
        content: null,
        tool_calls: [
          toolCall('propose_workspace_change', {
            operation: 'create_task',
            fields: { title: '自动失败回滚' },
          }),
          toolCall('propose_workspace_change', {
            operation: 'update_note',
            id: 'note-tools',
            fields: { content: '拟修改内容' },
          }),
        ],
      }
    const document = client.storage.getDocument('workspace')
    document.value.notes[0].content = '外部已修改'
    client.storage.putDocument('workspace', {
      value: document.value,
      expectedRevision: document.revision,
      mutationId: randomUUID(),
    })
    return { content: '本轮计划已整理。' }
  })
  autoConfirm(client, true)
  const response = await client.chat()
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.match(result.actionError, /变化|冲突/)
  assert.ok(result.actions.every((action) => action.status === 'pending'))
  assert.equal(
    client.storage
      .getDocument('workspace')
      .value.tasks.some((task) => task.title === '自动失败回滚'),
    false,
  )
})

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

test('disabling automatic confirmation before the final reply keeps all changes pending', async (t) => {
  let client
  client = await fixture(t, (_body, round) => {
    if (round === 0)
      return {
        content: null,
        tool_calls: [
          toolCall('propose_workspace_change', {
            operation: 'create_task',
            fields: { title: '中途关闭自动确认' },
          }),
        ],
      }
    autoConfirm(client, false)
    return { content: '计划已整理。' }
  })
  autoConfirm(client, true)
  const response = await client.chat()
  assert.equal(response.status, 200)
  const answer = await response.json()
  assert.equal(answer.actionConfirmation, 'manual')
  assert.equal(answer.actions[0].status, 'pending')
  assert.equal(
    client.storage
      .getDocument('workspace')
      .value.tasks.some((task) => task.title === '中途关闭自动确认'),
    false,
  )
})

test('a session revoked during the final reply cannot automatically write proposed changes', async (t) => {
  let client
  client = await fixture(t, async (_body, round) => {
    if (round === 0)
      return {
        content: null,
        tool_calls: [
          toolCall('propose_workspace_change', {
            operation: 'create_task',
            fields: { title: '撤销会话不执行' },
          }),
        ],
      }
    const logout = await client.call('/api/auth/logout', {})
    assert.equal(logout.status, 200)
    return { content: '最终回复。' }
  })
  autoConfirm(client, true)
  assert.equal((await client.chat()).status, 401)
  assert.equal(
    client.storage
      .getDocument('workspace')
      .value.tasks.some((task) => task.title === '撤销会话不执行'),
    false,
  )
})

test('canceling a reply after proposals were prepared never auto-executes them', async (t) => {
  const reached = Promise.withResolvers()
  const release = Promise.withResolvers()
  t.after(() => release.resolve())
  const client = await fixture(t, async (_body, round) => {
    if (round === 0)
      return {
        content: null,
        tool_calls: [
          toolCall('propose_workspace_change', {
            operation: 'create_task',
            fields: { title: '取消生成不执行' },
          }),
        ],
      }
    reached.resolve()
    await release.promise
    return { content: '已整理计划。' }
  })
  autoConfirm(client, true)
  const login = await client.call('/api/auth/login', { password: PASSWORD })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  await login.json()
  const closed = Promise.withResolvers()
  client.server.on('request', (request, response) => {
    if (request.url === '/api/chat') response.once('close', () => closed.resolve())
  })
  const controller = new AbortController()
  const request = fetch(`${client.base}/api/chat`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '创建任务' }], knowledge: 'none' }),
    signal: controller.signal,
  })
  // Attach the rejection handler before aborting the in-flight request.
  const rejected = assert.rejects(request, { name: 'AbortError' })
  await reached.promise
  controller.abort()
  await rejected
  await closed.promise
  release.resolve()
  assert.equal(
    client.storage
      .getDocument('workspace')
      .value.tasks.some((task) => task.title === '取消生成不执行'),
    false,
  )
  assert.equal(
    client.server.database.prepare('SELECT status FROM prts_assistant_actions LIMIT 1').get()
      .status,
    'pending',
  )
})
