import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowUp,
  Command,
  Sparkles,
  Terminal,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  ArrowUpRight,
  BookOpen,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { Workspace } from '../lib/workspace'
import { buildChatHistory, runLocalCommand, withChatCancellation } from '../lib/chat'
import { Logo, Modal } from './UI'
import KnowledgePanel, { KnowledgeSources } from './KnowledgePanel'
import PrtsSelect from './PrtsSelect'
import AssistantActions from './AssistantActions'
import {
  parseAssistantActions,
  parseToolUsage,
  type AssistantAction,
  type ToolUsage,
} from '../lib/assistantTools'
import {
  PERSONALITIES,
  parseKnowledgeResults,
  type AssistantPreferences,
  type KnowledgeResult,
  type PersonaId,
} from '../lib/assistant'
import '../styles/assistant.css'
export type ApiHealth = { configured: boolean; model: string; provider: string; reachable: boolean }
type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  mode: 'local' | 'ai'
  pending?: boolean
  persona?: PersonaId
  sources?: KnowledgeResult[]
  actions?: AssistantAction[]
  toolsUsed?: ToolUsage[]
  actionConfirmation?: 'manual' | 'automatic'
  actionError?: string
}
import { apiFetch, WORKSPACE_UPDATED_EVENT } from '../lib/api'
import { useServerStore } from '../lib/serverStore'

// Failed saves remain available when navigating away and returning to this view.
const unsavedMessages = new Map<string, Message>()
let messageWrites: Promise<unknown> = Promise.resolve()
let historyEpoch = 0
function enqueueMessageWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = messageWrites.then(write)
  messageWrites = result.catch(() => {})
  return result
}

export default function AssistantView({
  workspace,
  health,
  onSettings,
  onNewTask,
  preferences,
  mode,
  onPreferencesChange,
  onModeChange,
}: {
  workspace: Workspace
  health: ApiHealth
  onSettings: () => void
  onNewTask: (title: string) => Promise<boolean>
  preferences: AssistantPreferences
  mode: 'local' | 'ai' | 'knowledge'
  onPreferencesChange: (value: AssistantPreferences) => void
  onModeChange: (mode: 'local' | 'ai' | 'knowledge') => void
}) {
  const store = useServerStore()
  const autoConfirm = store.documents.preferences.value.assistantAutoConfirm === true
  const [policyError, setPolicyError] = useState('')
  const persona = PERSONALITIES.find((item) => item.id === preferences.persona)!
  const [messages, setMessages] = useState<Message[]>(() => [...unsavedMessages.values()])
  const scopeKey = mode === 'ai' ? `ai:${preferences.persona}` : mode
  const scopeQuery = mode === 'ai' ? `mode=ai&persona=${preferences.persona}` : `mode=${mode}`
  const inScope = (message: Message) =>
    message.mode === mode && (mode !== 'ai' || (message.persona ?? 'prts') === preferences.persona)
  const [loadedScope, setLoadedScope] = useState('')
  const loaded = loadedScope === scopeKey
  const [hasMore, setHasMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [waitingLong, setWaitingLong] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [saveError, setSaveError] = useState(
    unsavedMessages.size ? '仍有对话未保存到服务器，请重试保存。' : '',
  )
  const [input, setInput] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmClear, setConfirmClear] = useState(false)
  const historyRequest = useRef(0)
  const controller = useRef<AbortController | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    inputRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const textarea = inputRef.current
    if (!textarea) return
    const resize = () => {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [input, mode])
  async function loadMessages(before?: string) {
    const version = ++historyRequest.current
    setHistoryError('')
    try {
      await messageWrites
      if (version !== historyRequest.current) return
      const epoch = historyEpoch
      const response = await apiFetch(
        `/api/messages?${scopeQuery}&limit=60${before ? `&before=${encodeURIComponent(before)}` : ''}`,
      )
      const result = await response.json()
      if (version !== historyRequest.current || epoch !== historyEpoch) return
      if (!response.ok || !Array.isArray(result.messages))
        throw new Error(result.error || '对话历史加载失败。')
      setMessages((current) => {
        const values = before
          ? [...result.messages, ...current]
          : [
              ...current.filter((message) => !inScope(message)),
              ...result.messages,
              ...unsavedMessages.values(),
            ]
        return [...new Map(values.map((message: Message) => [message.id, message])).values()]
      })
      setHasMore(result.hasMore === true)
      setLoadedScope(scopeKey)
    } catch (cause) {
      if (version !== historyRequest.current) return
      setHistoryError(cause instanceof Error ? cause.message : '无法读取对话历史，请重试。')
    }
  }
  useEffect(() => {
    setHasMore(false)
    setError('')
    if (mode !== 'knowledge') void loadMessages()
    return () => {
      ++historyRequest.current
    }
  }, [scopeKey])
  useEffect(() => {
    setWaitingLong(false)
    if (!busy) return
    const timer = window.setTimeout(() => setWaitingLong(true), 20_000)
    return () => window.clearTimeout(timer)
  }, [busy])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (unsavedMessages.size) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  async function persistMessages(additions: Message[]) {
    for (const message of additions) unsavedMessages.set(message.id, { ...message, pending: false })
    if (!unsavedMessages.size) return
    const pending = [...unsavedMessages.values()]
    setSaving(true)
    setSaveError('')
    try {
      const response = await enqueueMessageWrite(() =>
        apiFetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: pending }),
        }),
      )
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || '对话保存失败。')
      }
      for (const message of pending) unsavedMessages.delete(message.id)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '对话未保存到服务器，请重试保存。')
    } finally {
      setSaving(false)
    }
  }
  async function clearMessages() {
    ++historyRequest.current
    ++historyEpoch
    setSaving(true)
    setSaveError('')
    try {
      const response = await enqueueMessageWrite(() =>
        apiFetch(`/api/messages?${scopeQuery}`, { method: 'DELETE' }),
      )
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || '清空对话失败。')
      }
      ++historyEpoch
      for (const [id, message] of unsavedMessages) if (inScope(message)) unsavedMessages.delete(id)
      setMessages((current) => current.filter((message) => !inScope(message)))
      setSaveError(unsavedMessages.size ? '仍有对话未保存到服务器，请重试保存。' : '')
      setLoadedScope(scopeKey)
      setHasMore(false)
      setConfirmClear(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清空失败，请重试。')
      setConfirmClear(false)
    } finally {
      setSaving(false)
    }
  }
  useEffect(() => {
    const reduceMotion =
      document.documentElement.dataset.motion === 'off' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    bottom.current?.scrollIntoView({
      block: 'nearest',
      behavior: reduceMotion ? 'instant' : 'smooth',
    })
  }, [messages, busy])
  useEffect(() => () => controller.current?.abort(), [])
  async function send(text = input) {
    const content = text.trim()
    if (!content || busy || saving || !loaded || unsavedMessages.size || mode === 'knowledge')
      return
    if (mode === 'ai' && (store.saving || store.error)) {
      setError('请等待工作台偏好保存成功后再发送消息。')
      return
    }
    if (mode === 'ai' && !health.configured) {
      setError(
        health.reachable
          ? 'AI 服务尚未配置，请前往系统设置查看连接方式。'
          : '无法连接本地服务，请确认后端正在运行。',
      )
      return
    }
    setError('')
    setInput('')
    const user: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      mode,
      ...(mode === 'ai' ? { persona: preferences.persona } : {}),
      pending: mode === 'ai',
    }
    setMessages((p) => [...p, user])
    if (mode === 'local') {
      setBusy(true)
      let taskResult: Promise<boolean> | undefined
      const replyContent = runLocalCommand(content, workspace, (title) => {
        taskResult = onNewTask(title)
      })
      const taskSaved = taskResult ? await taskResult : true
      const reply: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: taskSaved
          ? replyContent
          : '任务暂未保存到服务器。草稿已保留，请按页面保存提示重试。',
        mode,
      }
      setMessages((p) => [...p, reply])
      await persistMessages([user, reply])
      setBusy(false)
      return
    }
    setBusy(true)
    const requestController = new AbortController()
    controller.current = requestController
    try {
      const history = buildChatHistory(
        messages.filter((m) => m.mode === 'ai' && !m.pending),
        content,
        { persona: preferences.persona },
      )
      const { response, data } = await withChatCancellation(requestController.signal, async () => {
        const response = await apiFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: history,
            persona: preferences.persona,
            knowledge: preferences.knowledge,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: requestController.signal,
        })
        if (response.status === 504) throw new Error(persona.timeout)
        let data
        try {
          data = await response.json()
        } catch {
          throw new Error('AI 服务返回了无法读取的响应，请稍后重试。')
        }
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new Error('AI 响应格式异常。')
        return { response, data }
      })
      if (!response.ok)
        throw new Error(
          response.status === 504 ? persona.timeout : data.error || '请求失败，请稍后重试。',
        )
      if (typeof data.message !== 'string' || !data.message.trim())
        throw new Error('AI 响应格式异常。')
      if (data.persona !== undefined && data.persona !== preferences.persona)
        throw new Error('回复人格与当前会话不一致，请重试。')
      const reply: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message,
        mode: 'ai',
        persona: preferences.persona,
        sources: parseKnowledgeResults(data.sources),
        actions: parseAssistantActions(data.actions),
        toolsUsed: parseToolUsage(data.toolsUsed),
        ...(data.actionConfirmation === 'manual' || data.actionConfirmation === 'automatic'
          ? { actionConfirmation: data.actionConfirmation }
          : {}),
        ...(typeof data.actionError === 'string'
          ? { actionError: data.actionError.slice(0, 500) }
          : {}),
      }
      setMessages((p) => [
        ...p.map((m) => (m.id === user.id ? { ...m, pending: false } : m)),
        reply,
      ])
      await persistMessages([{ ...user, pending: false }, reply])
      if (reply.actions?.some((action) => action.status === 'applied'))
        window.dispatchEvent(new Event(WORKSPACE_UPDATED_EVENT))
    } catch (e) {
      setMessages((p) => p.filter((m) => m.id !== user.id))
      setInput((current) => current || content)
      setError(
        e instanceof Error && e.name === 'AbortError'
          ? persona.stopped
          : e instanceof Error
            ? e.message
            : '无法连接 AI 服务。',
      )
    } finally {
      setBusy(false)
      controller.current = null
      inputRef.current?.focus()
    }
  }
  const shown = messages.filter(inScope)
  return (
    <div className="page-content assistant-page">
      <div className="view-heading">
        <div>
          <div className="page-index mono">04 / INTELLIGENCE INTERFACE</div>
          <h1>
            PRTS 助手<span className="heading-dot">.</span>
          </h1>
          <p>一个思考的伙伴，一处灵感的回声。</p>
        </div>
        <button
          className="button button-ghost"
          onClick={() => setConfirmClear(true)}
          disabled={mode === 'knowledge' || !shown.length || busy || saving || !loaded}
        >
          <Trash2 size={15} />
          清空对话
        </button>
      </div>
      <section className="panel chat-shell">
        <div className="chat-toolbar">
          <div className="segmented">
            <button
              className={mode === 'local' ? 'active' : ''}
              aria-pressed={mode === 'local'}
              disabled={busy || saving}
              onClick={() => {
                onModeChange('local')
                setError('')
              }}
            >
              <Terminal size={15} />
              本地指令
            </button>
            <button
              className={mode === 'ai' ? 'active' : ''}
              aria-pressed={mode === 'ai'}
              disabled={busy || saving}
              onClick={() => {
                onModeChange('ai')
                setError('')
              }}
            >
              <Sparkles size={15} />
              AI 对话
            </button>
            <button
              className={mode === 'knowledge' ? 'active' : ''}
              aria-pressed={mode === 'knowledge'}
              disabled={busy || saving}
              onClick={() => {
                onModeChange('knowledge')
                setError('')
              }}
            >
              <BookOpen size={15} />
              语料检索
            </button>
          </div>
          <span
            className={`connection-status ${mode !== 'ai' || health.configured ? 'success' : ''}`}
            title={
              mode !== 'ai' ? '工作台服务' : health.configured ? health.model : '尚未连接 AI 服务'
            }
            aria-label={
              mode !== 'ai' ? '工作台服务' : health.configured ? health.model : '尚未连接 AI 服务'
            }
          >
            {mode !== 'ai' ? (
              <Command size={13} />
            ) : health.configured ? (
              <Wifi size={13} />
            ) : (
              <WifiOff size={13} />
            )}
            <span>
              {mode === 'knowledge'
                ? '服务器资料库'
                : mode === 'local'
                  ? '工作台指令'
                  : health.configured
                    ? health.model
                    : '尚未连接'}
            </span>
          </span>
        </div>
        {mode === 'knowledge' ? (
          <KnowledgePanel />
        ) : (
          <>
            {mode === 'ai' && (
              <div className="assistant-options">
                <div className="assistant-personality">
                  <label htmlFor="assistant-persona">AI 性格</label>
                  <PrtsSelect
                    id="assistant-persona"
                    aria-label="AI 性格"
                    disabled={busy || saving}
                    value={preferences.persona}
                    onValueChange={(value) =>
                      onPreferencesChange({
                        ...preferences,
                        persona: value as PersonaId,
                      })
                    }
                    options={PERSONALITIES.map((item) => ({
                      value: item.id,
                      label: `${item.name} · ${item.tone}`,
                    }))}
                  />
                </div>
                <div className="assistant-knowledge">
                  <label htmlFor="assistant-knowledge">参考语料</label>
                  <PrtsSelect
                    id="assistant-knowledge"
                    aria-label="参考语料"
                    disabled={busy}
                    value={preferences.knowledge}
                    onValueChange={(value) =>
                      onPreferencesChange({
                        ...preferences,
                        knowledge: value as AssistantPreferences['knowledge'],
                      })
                    }
                    options={[
                      { value: 'all', label: '明日方舟 + 终末地' },
                      { value: 'arknights', label: '仅明日方舟' },
                      { value: 'endfield', label: '仅终末地' },
                      { value: 'none', label: '关闭资料检索' },
                    ]}
                  />
                </div>
              </div>
            )}
            {mode === 'ai' && (
              <div className="assistant-confirmation-setting">
                <label>
                  <input
                    type="checkbox"
                    checked={autoConfirm}
                    disabled={busy || saving || store.saving || !!store.error}
                    onChange={async (event) => {
                      setPolicyError('')
                      const saved = await store.save('preferences', {
                        ...store.documents.preferences.value,
                        assistantAutoConfirm: event.target.checked,
                      })
                      if (!saved) setPolicyError('自动确认偏好尚未保存，请重试保存后再发送消息。')
                    }}
                  />
                  <span>自动确认工作台操作</span>
                  <small>
                    {store.saving
                      ? '正在保存…'
                      : autoConfirm
                        ? '已开启 · 含删除'
                        : '默认关闭 · 含删除'}
                  </small>
                </label>
                {policyError && <p role="alert">{policyError}</p>}
              </div>
            )}
            {mode === 'ai' && (
              <details className="assistant-guidance">
                <summary>对话与操作说明</summary>
                <p className="persona-description">
                  {persona.description}
                  <span>当前人格已启用 · 每个人格独立保留对话</span>
                </p>
                <p>
                  开启自动确认后，后续回复中的任务、日程、笔记、分类、普通设置和计时修改会自动执行，包括删除。结果仍保留在对话中；已有待确认操作需手动处理。
                </p>
                <p className="assistant-access-note">
                  已连接工作台：可按需读取任务、日程、笔记与文本附件，相关内容会发送给你配置的 AI
                  服务。
                  {autoConfirm
                    ? '本轮修改将统一自动执行。'
                    : '本轮修改合并到一张操作卡片，统一确认。'}
                </p>
              </details>
            )}
            <div className="chat-messages" aria-live="polite" aria-relevant="additions">
              {!loaded && !historyError && <p role="status">正在读取对话记录…</p>}
              {historyError && (
                <div className="inline-error" role="alert">
                  {historyError}
                  <button className="button button-ghost" onClick={() => void loadMessages()}>
                    重试读取
                  </button>
                </div>
              )}
              {hasMore && (
                <button
                  className="button button-ghost"
                  onClick={() => void loadMessages(shown[0]?.id)}
                >
                  加载更早记录
                </button>
              )}
              {!shown.length && loaded && (
                <div className="chat-welcome">
                  <div className="assistant-emblem">
                    <Logo />
                  </div>
                  <span className="mono">
                    {mode === 'ai' ? persona.id.toUpperCase() : 'PRTS'} // AT YOUR SERVICE
                  </span>
                  <h2>{mode === 'ai' ? persona.greeting : '博士，我在这里。'}</h2>
                  <p>
                    {mode === 'local'
                      ? '查看今天的任务，找回一个想法，或记录新的目标。'
                      : health.configured
                        ? autoConfirm
                          ? '查看工作台、安排日程、整理任务与笔记，按你的要求自动执行修改。'
                          : '查看工作台、安排日程、整理任务与笔记，或为你准备待确认的操作。'
                        : '连接你自己的 AI 服务，开启与 PRTS 的对话。'}
                  </p>
                  {mode === 'ai' && !health.configured ? (
                    <button className="button button-ghost" onClick={onSettings}>
                      连接 AI 服务
                      <ArrowUpRight size={15} />
                    </button>
                  ) : (
                    <div className="suggestion-grid">
                      {(mode === 'local'
                        ? ['查看今日任务', '查看笔记', '专注状态']
                        : [
                            '根据我的任务和日程安排今天的计划',
                            '阿米娅与罗德岛有什么关系？',
                            '帮我新建一个高优先级任务：整理本周计划',
                          ]
                      ).map((s) => (
                        <button onClick={() => send(s)} key={s}>
                          {s}
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {shown.map((m) => (
                <article className={`chat-message ${m.role}`} key={m.id}>
                  <div className="message-avatar mono">
                    {m.role === 'assistant' ? <Logo small /> : 'DR'}
                  </div>
                  <div className="message-body">
                    <div className="message-label mono">
                      {m.role === 'assistant'
                        ? m.mode === 'ai'
                          ? PERSONALITIES.find((item) => item.id === m.persona)?.name || 'PRTS'
                          : 'PRTS'
                        : 'DOCTOR'}
                      <span>{m.mode === 'local' ? 'LOCAL' : 'AI'}</span>
                    </div>
                    <div className="markdown-content">
                      <ReactMarkdown disallowedElements={['img']}>{m.content}</ReactMarkdown>
                    </div>
                    {m.role === 'assistant' && (
                      <AssistantActions
                        actions={m.actions}
                        toolsUsed={m.toolsUsed}
                        confirmation={m.actionConfirmation}
                        error={m.actionError}
                      />
                    )}
                    {!!m.sources?.length && (
                      <details className="message-sources">
                        <summary>参考资料 · {m.sources.length} 条</summary>
                        <KnowledgeSources sources={m.sources} compact />
                      </details>
                    )}
                  </div>
                </article>
              ))}
              {busy && (
                <div className="chat-thinking mono">
                  <span />
                  <span />
                  <span />
                  {waitingLong ? persona.waiting : persona.thinking}
                </div>
              )}
              <div ref={bottom} />
            </div>
            {saveError && (
              <div className="inline-error" role="alert">
                {saveError}
                <button
                  className="button button-ghost"
                  disabled={saving}
                  onClick={() => void persistMessages([])}
                >
                  重试保存
                </button>
              </div>
            )}
            {saving && <p role="status">正在保存对话…</p>}
            {error && (
              <div role="alert" className="inline-error">
                {error}
              </div>
            )}
            <form
              className="chat-composer"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                void send()
              }}
            >
              <label className="sr-only" htmlFor="chat-input">
                发送给 PRTS 的消息
              </label>
              <textarea
                id="chat-input"
                ref={inputRef}
                value={input}
                maxLength={12000}
                rows={2}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  mode === 'local'
                    ? '输入指令，例如「新建任务：整理这周的阅读笔记」'
                    : `向${persona.name}发送消息…`
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <div className="composer-bottom">
                <span className="mono">
                  {mode === 'local'
                    ? 'LOCAL COMMAND MODE'
                    : preferences.knowledge === 'none'
                      ? '当前对话 + 所选性格'
                      : '当前对话 + 所选性格 + 相关语料'}
                  <span className="keyboard-hint"> · ENTER 发送 / SHIFT + ENTER 换行</span>
                </span>
                {busy ? (
                  <button
                    type="button"
                    className="send-button"
                    onClick={(event) => {
                      // React reuses this node as the submit button after abort.
                      // Cancel the click's default action before changing state.
                      event.preventDefault()
                      controller.current?.abort()
                    }}
                    aria-label="停止生成"
                  >
                    <Square size={15} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-button"
                    disabled={
                      !loaded ||
                      saving ||
                      !!saveError ||
                      !input.trim() ||
                      (mode === 'ai' && (!health.configured || store.saving || !!store.error))
                    }
                    aria-label="发送消息"
                  >
                    <ArrowUp size={20} />
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </section>
      {confirmClear && (
        <Modal title="清空当前会话记录？" onClose={() => setConfirmClear(false)}>
          <p className="modal-copy">
            {mode === 'ai' ? `将清空与${persona.name}的对话历史` : '将清空本地指令历史'}
            ，所有设备都会同步此结果。其他人格的对话、任务和笔记会继续保留。
          </p>
          <div className="modal-actions">
            <button className="button button-ghost" onClick={() => setConfirmClear(false)}>
              取消
            </button>
            <button
              className="button button-primary"
              disabled={saving}
              onClick={() => void clearMessages()}
            >
              确认清空
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
