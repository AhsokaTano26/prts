import { useEffect, useRef, useState, type FormEvent } from 'react'
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
import { buildChatHistory, runLocalCommand } from '../lib/chat'
import { Logo, Modal } from './UI'
import KnowledgePanel, { KnowledgeSources } from './KnowledgePanel'
import PrtsSelect from './PrtsSelect'
import {
  PERSONALITIES,
  isPersona,
  parseAssistantPreferences,
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
}
import { apiFetch } from '../lib/api'

export default function AssistantView({
  workspace,
  health,
  onSettings,
  onNewTask,
}: {
  workspace: Workspace
  health: ApiHealth
  onSettings: () => void
  onNewTask: (title: string) => void
}) {
  const [mode, setMode] = useState<'local' | 'ai' | 'knowledge'>(() => {
    try {
      const saved = sessionStorage.getItem('prts-assistant-mode')
      if (saved === 'local' || saved === 'ai' || saved === 'knowledge') return saved
    } catch {
      /* fall back when browser storage is unavailable */
    }
    return health.configured ? 'ai' : 'local'
  })
  const [preferences, setPreferences] = useState<AssistantPreferences>(() => {
    try {
      return parseAssistantPreferences(
        JSON.parse(localStorage.getItem('prts-assistant-v1') || '{}'),
      )
    } catch {
      return parseAssistantPreferences(null)
    }
  })
  const persona = PERSONALITIES.find((item) => item.id === preferences.persona)!
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem('prts-chat-v1') || '[]')
      return Array.isArray(v)
        ? v
            .filter(
              (m) =>
                m &&
                !m.pending &&
                typeof m.id === 'string' &&
                ['user', 'assistant'].includes(m.role) &&
                typeof m.content === 'string' &&
                ['local', 'ai'].includes(m.mode),
            )
            .map((m) => ({
              ...m,
              persona: isPersona(m.persona) ? m.persona : 'prts',
              sources: parseKnowledgeResults(m.sources),
            }))
            .slice(-60)
        : []
    } catch {
      return []
    }
  })
  const [input, setInput] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmClear, setConfirmClear] = useState(false)
  const controller = useRef<AbortController | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    try {
      sessionStorage.setItem('prts-assistant-mode', mode)
    } catch {
      /* keep the current tab in memory */
    }
  }, [mode])
  useEffect(() => {
    try {
      localStorage.setItem('prts-assistant-v1', JSON.stringify(preferences))
    } catch {
      /* preferences stay available in this view */
    }
  }, [preferences])
  useEffect(() => {
    try {
      sessionStorage.setItem(
        'prts-chat-v1',
        JSON.stringify(messages.filter((m) => !m.pending).slice(-60)),
      )
    } catch {
      /* chat remains available this session */
    }
  }, [messages])
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
    if (!content || busy || mode === 'knowledge') return
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
      pending: mode === 'ai',
    }
    setMessages((p) => [...p, user])
    if (mode === 'local') {
      const reply: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: runLocalCommand(content, workspace, onNewTask),
        mode,
      }
      setMessages((p) => [...p, reply])
      return
    }
    setBusy(true)
    controller.current = new AbortController()
    try {
      const history = buildChatHistory(
        messages.filter((m) => m.mode === 'ai' && !m.pending),
        content,
      )
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          persona: preferences.persona,
          knowledge: preferences.knowledge,
        }),
        signal: controller.current.signal,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。')
      if (typeof data.message !== 'string' || !data.message.trim())
        throw new Error('AI 响应格式异常。')
      const reply: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message,
        mode: 'ai',
        persona: preferences.persona,
        sources: parseKnowledgeResults(data.sources),
      }
      setMessages((p) => [
        ...p.map((m) => (m.id === user.id ? { ...m, pending: false } : m)),
        reply,
      ])
    } catch (e) {
      setMessages((p) => p.filter((m) => m.id !== user.id))
      setInput((current) => current || content)
      setError(
        e instanceof Error && e.name === 'AbortError'
          ? '本次生成已停止。'
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
  const shown = messages.filter((m) => m.mode === mode)
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
          disabled={!messages.length || busy}
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
              disabled={busy}
              onClick={() => {
                setMode('local')
                setError('')
              }}
            >
              <Terminal size={15} />
              本地指令
            </button>
            <button
              className={mode === 'ai' ? 'active' : ''}
              aria-pressed={mode === 'ai'}
              disabled={busy}
              onClick={() => {
                setMode('ai')
                setError('')
              }}
            >
              <Sparkles size={15} />
              AI 对话
            </button>
            <button
              className={mode === 'knowledge' ? 'active' : ''}
              aria-pressed={mode === 'knowledge'}
              disabled={busy}
              onClick={() => {
                setMode('knowledge')
                setError('')
              }}
            >
              <BookOpen size={15} />
              语料检索
            </button>
          </div>
          <span
            className={`connection-status ${mode !== 'ai' || health.configured ? 'success' : ''}`}
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
                ? '本地资料库'
                : mode === 'local'
                  ? '无需联网'
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
                    disabled={busy}
                    value={preferences.persona}
                    onValueChange={(value) =>
                      setPreferences((current) => ({
                        ...current,
                        persona: value as PersonaId,
                      }))
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
                      setPreferences((current) => ({
                        ...current,
                        knowledge: value as AssistantPreferences['knowledge'],
                      }))
                    }
                    options={[
                      { value: 'all', label: '明日方舟 + 终末地' },
                      { value: 'arknights', label: '仅明日方舟' },
                      { value: 'endfield', label: '仅终末地' },
                      { value: 'none', label: '关闭资料检索' },
                    ]}
                  />
                </div>
                <p className="persona-description">
                  {persona.description}
                  <span>角色风格预设 · 对后续回复生效</span>
                </p>
              </div>
            )}
            <div className="chat-messages" aria-live="polite" aria-relevant="additions">
              {!shown.length && (
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
                        ? '关于写作、计划与思考，我们可以从任何地方开始。'
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
                            '帮我制定一个切实可行的周计划',
                            '阿米娅与罗德岛有什么关系？',
                            '帮我梳理一个新项目的思路',
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
                  {persona.name} 正在思考
                </div>
              )}
              <div ref={bottom} />
            </div>
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
                    onClick={() => controller.current?.abort()}
                    aria-label="停止生成"
                  >
                    <Square size={15} />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    disabled={!input.trim() || (mode === 'ai' && !health.configured)}
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
          <p className="modal-copy">本地指令和 AI 对话记录都将清空，任务和笔记会继续保留。</p>
          <div className="modal-actions">
            <button className="button button-ghost" onClick={() => setConfirmClear(false)}>
              取消
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                setMessages([])
                setConfirmClear(false)
              }}
            >
              确认清空
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
