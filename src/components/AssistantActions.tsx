import { useEffect, useRef, useState } from 'react'
import { Check, X, Wrench } from 'lucide-react'
import { apiFetch, WORKSPACE_UPDATED_EVENT } from '../lib/api'
import {
  parseAssistantActions,
  TOOL_LABELS,
  type AssistantAction,
  type ToolUsage,
} from '../lib/assistantTools'
import '../styles/assistant-tools.css'

type Confirmation = 'manual' | 'automatic'
function BatchCard({
  initial,
  confirmation,
  initialError,
}: {
  initial: AssistantAction[]
  confirmation?: Confirmation
  initialError?: string
}) {
  const [actions, setActions] = useState(initial)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError || '')
  const request = useRef<AbortController | null>(null)
  const ids = initial.map((action) => action.id).join(',')
  useEffect(() => {
    const controller = new AbortController()
    setReady(false)
    void (async () => {
      try {
        const response = await apiFetch(`/api/assistant/actions?ids=${ids}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '无法读取操作状态。')
        const current = parseAssistantActions(data.actions)
        if (current.length !== ids.split(',').length)
          throw new Error('操作状态不完整，请重新加载。')
        setActions(current)
        if (!current.some((action) => action.status === 'pending')) setError('')
        setReady(true)
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '无法读取操作状态。')
      }
    })()
    return () => {
      controller.abort()
      request.current?.abort()
    }
  }, [ids])
  async function decide(decision: 'apply' | 'dismiss') {
    if (request.current || !ready) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch('/api/assistant/actions/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ids: actions.filter((action) => action.status === 'pending').map((action) => action.id),
          decision,
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '操作未能完成。')
      const updated = parseAssistantActions(result.actions)
      setActions((current) =>
        current.map((action) => updated.find((item) => item.id === action.id) || action),
      )
      if (updated.some((action) => action.status === 'applied'))
        window.dispatchEvent(new Event(WORKSPACE_UPDATED_EVENT))
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '无法确认操作结果，请刷新后检查。')
    } finally {
      request.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const pending = actions.filter((action) => action.status === 'pending').length
  const applied = actions.filter((action) => action.status === 'applied').length
  const dismissed = actions.filter((action) => action.status === 'dismissed').length
  const multiple = actions.length > 1
  const label = multiple ? `工作台操作 · ${actions.length} 项` : actions[0].summary
  const state = pending
    ? `等待确认 · ${pending} 项 · 30 分钟内有效`
    : applied === actions.length
      ? confirmation === 'automatic'
        ? `自动确认 · 已执行 ${applied} 项`
        : multiple
          ? `已全部执行 · ${applied} 项`
          : '已执行'
      : dismissed === actions.length
        ? '已取消'
        : `已执行 ${applied} 项 · 已取消 ${dismissed} 项 · 已过期 ${actions.length - applied - dismissed} 项`
  return (
    <section className="assistant-action" aria-label={label}>
      <div className="assistant-action-heading">
        <Wrench size={15} />
        <strong>{label}</strong>
      </div>
      <span className="assistant-action-state">{state}</span>
      {multiple && (
        <p className="assistant-action-hint">本轮操作统一执行，任一操作冲突时整批不写入。</p>
      )}
      <details>
        <summary>查看修改预览</summary>
        <ol className="assistant-action-list">
          {actions.map((action) => (
            <li key={action.id}>
              {multiple && <strong>{action.summary}</strong>}
              <pre>{action.preview}</pre>
            </li>
          ))}
        </ol>
      </details>
      {error && (
        <p role="alert" className="assistant-action-error">
          {error}
        </p>
      )}
      {!!pending && (
        <div className="assistant-action-buttons">
          <button
            type="button"
            className="button button-ghost"
            disabled={!ready || busy}
            onClick={() => void decide('dismiss')}
          >
            <X size={14} />
            {multiple ? '取消全部' : '取消操作'}
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!ready || busy}
            onClick={() => void decide('apply')}
          >
            <Check size={14} />
            {busy ? '正在处理…' : multiple ? '确认全部' : '确认执行'}
          </button>
        </div>
      )}
    </section>
  )
}

export default function AssistantActions({
  actions,
  toolsUsed,
  confirmation,
  error,
}: {
  actions?: AssistantAction[]
  toolsUsed?: ToolUsage[]
  confirmation?: Confirmation
  error?: string
}) {
  return (
    <>
      {!!toolsUsed?.length && (
        <details className="assistant-tool-usage">
          <summary>工作台工具 · {toolsUsed.length} 次调用</summary>
          <ul>
            {toolsUsed.map((tool, index) => (
              <li key={index}>
                {TOOL_LABELS[tool.name] || tool.name} · {tool.status === 'ok' ? '成功' : '未完成'}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!actions?.length && (
        <BatchCard initial={actions} confirmation={confirmation} initialError={error} />
      )}
    </>
  )
}
