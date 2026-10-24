import type { Workspace } from './workspace.ts'
import type { PersonaId } from './assistant.ts'

export type ChatTurn = { role: 'user' | 'assistant'; content: string; persona?: PersonaId }

/** Stop promptly even if a provider, proxy or response body ignores cancellation. */
export async function withChatCancellation<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  signal.throwIfAborted()
  let onAbort: () => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([operation(), cancelled])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export function runLocalCommand(
  text: string,
  workspace: Workspace,
  onNewTask: (title: string) => void,
): string {
  const title = text.match(/^(?:新建任务|添加任务)[：:\s]+(.+)/s)?.[1]?.trim()
  if (title) {
    if (title.length > 200) return '任务内容最多 200 个字符，请简化后重试。'
    onNewTask(title)
    return `已添加任务「${title}」。你可以前往 **任务中枢** 设置优先级和截止日期。`
  }
  if (/笔记|档案/.test(text)) {
    const query = text.replace(/查看|搜索|查找|笔记|档案|[：:]/g, '').trim()
    const notes = workspace.notes.filter(
      (note) => !query || note.title.includes(query) || note.content.includes(query),
    )
    return notes.length
      ? `找到了 ${notes.length} 篇笔记：\n\n${notes
          .slice(0, 8)
          .map((note) => `- **${note.title}** · ${note.tag || '未分类'}`)
          .join('\n')}\n\n可在「个人档案」中阅读和编辑。`
      : '没有找到匹配的笔记。试试「查看笔记」或换一个关键词。'
  }
  if (/任务|待办|计划|概况|今日|今天/.test(text)) {
    const pending = workspace.tasks.filter((task) => !task.done)
    return `博士，当前有 **${pending.length} 项待办**，已完成 **${workspace.tasks.filter((task) => task.done).length} 项任务**。\n\n${pending
      .slice(0, 8)
      .map(
        (task) =>
          `- ${task.priority === 'high' ? '【优先】' : ''}${task.title}${task.dueDate ? ' · ' + task.dueDate : ''}`,
      )
      .join(
        '\n',
      )}\n\n${pending.length ? '建议从最高优先级的任务开始，配合一轮专注计时。' : '当前任务已经清空。可以休息一下，或写下新的目标。'}`
  }
  if (/专注/.test(text)) {
    return `专注协议已设置为 **${workspace.settings.focusMinutes} 分钟**。你已完成 **${workspace.focusSessions} 轮**。\n\n回到「总览」点击「开始专注」即可启动计时。每次只做一件事。`
  }
  return '本地指令终端已就绪。你可以输入：\n\n- **今日任务** — 查看待办与工作概况\n- **查看笔记** / **搜索笔记 关键词** — 检索个人档案\n- **新建任务：任务内容** — 快速记录待办\n- **专注状态** — 查看专注协议\n\n当前为规则驱动的本地指令模式。连接 AI 服务后，可切换到「AI 对话」进行开放式交流。'
}

export function buildChatHistory(
  history: readonly ChatTurn[],
  content: string,
  options: { persona?: PersonaId } = {},
): ChatTurn[] {
  const current = content.trim()
  if (!current) throw new Error('消息不能为空。')
  if (current.length > 12_000) throw new Error('每条消息不能超过 12000 个字符。')

  const identity = options.persona ? { persona: options.persona } : {}
  const result: ChatTurn[] = [{ role: 'user', content: current, ...identity }]
  let remaining = 80_000 - current.length
  for (
    let index = history.length - 1;
    index >= 0 && result.length < 40 && remaining > 0;
    index -= 1
  ) {
    const message = history[index]
    if (options.persona && (message.persona ?? 'prts') !== options.persona) continue
    if (!message.content.trim()) continue
    const excerpt = message.content.slice(0, Math.min(12_000, remaining))
    result.push({ role: message.role, content: excerpt, ...identity })
    remaining -= excerpt.length
  }
  return result.reverse()
}
