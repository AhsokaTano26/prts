import { useEffect, useState } from 'react'
import { Check, X, Wrench } from 'lucide-react'
import { apiFetch, WORKSPACE_UPDATED_EVENT } from '../lib/api'
import {
  parseAssistantActions,
  TOOL_LABELS,
  type AssistantAction,
  type ToolUsage,
} from '../lib/assistantTools'
import '../styles/assistant-tools.css'

function ActionCard({ initial }: { initial: AssistantAction }) {
  const [action, setAction] = useState(initial)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await apiFetch(`/api/assistant/actions/${initial.id}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '无法读取操作状态。')
        const [current] = parseAssistantActions([data.action])
        setAction(current)
        setReady(true)
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '无法读取操作状态。')
      }
    })()
    return () => controller.abort()
  }, [initial.id])
  async function decide(decision: 'apply' | 'dismiss') {
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch(`/api/assistant/actions/${action.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
        signal: AbortSignal.timeout(30_000),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '操作未能完成。')
      const [current] = parseAssistantActions([result.action])
      setAction(current)
      if (current.status === 'applied') window.dispatchEvent(new Event(WORKSPACE_UPDATED_EVENT))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法确认操作结果，请刷新后检查。')
    } finally {
      setBusy(false)
    }
  }
  const pending = action.status === 'pending'
  return (
    <section className="assistant-action" aria-label={action.summary}>
      <div className="assistant-action-heading">
        <Wrench size={15} />
        <strong>{action.summary}</strong>
      </div>
      <span className="assistant-action-state">
        {pending
          ? '等待确认 · 30 分钟内有效'
          : action.status === 'applied'
            ? '已执行'
            : action.status === 'dismissed'
              ? '已取消'
              : '已过期，请重新发起'}
      </span>
      <details>
        <summary>查看修改预览</summary>
        <pre>{action.preview}</pre>
      </details>
      {error && (
        <p role="alert" className="assistant-action-error">
          {error}
        </p>
      )}
      {pending && (
        <div className="assistant-action-buttons">
          <button
            type="button"
            className="button button-ghost"
            disabled={!ready || busy}
            onClick={() => void decide('dismiss')}
          >
            <X size={14} />
            取消操作
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!ready || busy}
            onClick={() => void decide('apply')}
          >
            <Check size={14} />
            {busy ? '正在处理…' : '确认执行'}
          </button>
        </div>
      )}
    </section>
  )
}

export default function AssistantActions({
  actions,
  toolsUsed,
}: {
  actions?: AssistantAction[]
  toolsUsed?: ToolUsage[]
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
      {actions?.map((action) => (
        <ActionCard initial={action} key={action.id} />
      ))}
    </>
  )
}
