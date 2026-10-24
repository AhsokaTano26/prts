export const PERSONALITIES = [
  {
    id: 'prts',
    name: 'PRTS',
    tone: '理性分析',
    description: '清晰、客观，给出有条理的判断与行动建议。',
    greeting: '博士，终端已就绪。',
    thinking: 'PRTS 正在核对信息…',
    waiting: '博士，仍在等待模型响应，可以随时停止并保留输入。',
    timeout: '博士，本次响应超时。输入已保留，可以稍后重试。',
    stopped: '博士，本次生成已停止，输入已保留。',
  },
  {
    id: 'amiya',
    name: '阿米娅',
    tone: '温和鼓励',
    description: '罗德岛的阿米娅，温柔、聪慧而坚定，陪博士一起面对眼前的事。',
    greeting: '博士，我们一起慢慢来。',
    thinking: '阿米娅正在认真整理思绪…',
    waiting: '博士，回复还需要一点时间。先放松一下吧，随时可以停止等待。',
    timeout: '博士，这次回复超时了。我们先稍微休息一下，再试一次，好吗？输入已经保留。',
    stopped: '嗯，博士，已经停止了。输入还在，等你准备好了我们再继续。',
  },
  {
    id: 'kaltsit',
    name: '凯尔希',
    tone: '严谨直言',
    description: '直指问题，重视证据、边界与计划的可执行性。',
    greeting: '博士，先明确问题。',
    thinking: '凯尔希正在核对事实与方案…',
    waiting: '博士，模型尚未返回结果。可以继续等待，或停止后重试。',
    timeout: '博士，本次响应超时。输入已保留，确认连接后再试。',
    stopped: '博士，生成已停止。输入已保留，可以重新调整问题。',
  },
] as const
export type PersonaId = (typeof PERSONALITIES)[number]['id']
export type KnowledgeScope = 'all' | 'arknights' | 'endfield' | 'none'
export type AssistantPreferences = { persona: PersonaId; knowledge: KnowledgeScope }
export type KnowledgeStatus = {
  ready: boolean
  release: string | null
  documentCount: number
  sources: { id: string; name: string; documentCount: number }[]
}
export type KnowledgeResult = {
  id: string
  title: string
  source: string
  sourceLabel: string
  url: string
  excerpt: string
  lineStart?: number
  lineEnd?: number
  authority?: string
  releaseId?: string
  dataVersion?: string
  sourceRef?: string
}

export const CORPUS_DOWNLOADS = [
  {
    id: 'arknights',
    name: '明日方舟',
    repository: 'HTiantian/prts-agent-corpus-arknights',
    url: 'https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-arknights',
  },
  {
    id: 'endfield',
    name: '明日方舟：终末地',
    repository: 'HTiantian/prts-agent-corpus-endfield',
    url: 'https://modelscope.cn/datasets/HTiantian/prts-agent-corpus-endfield',
  },
] as const

export function isPersona(value: unknown): value is PersonaId {
  return PERSONALITIES.some((persona) => persona.id === value)
}

export function parseAssistantPreferences(value: unknown): AssistantPreferences {
  const preferences = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    persona: isPersona(preferences.persona) ? preferences.persona : 'prts',
    knowledge:
      typeof preferences.knowledge === 'string' &&
      ['all', 'arknights', 'endfield', 'none'].includes(preferences.knowledge)
        ? (preferences.knowledge as KnowledgeScope)
        : 'all',
  }
}

export function parseKnowledgeStatus(value: unknown): KnowledgeStatus {
  const data = value as KnowledgeStatus | null
  if (
    !data ||
    typeof data.ready !== 'boolean' ||
    (data.release !== null && typeof data.release !== 'string') ||
    !Number.isSafeInteger(data.documentCount) ||
    data.documentCount < 0 ||
    !Array.isArray(data.sources) ||
    data.sources.some(
      (source) =>
        !source ||
        typeof source.id !== 'string' ||
        typeof source.name !== 'string' ||
        !Number.isSafeInteger(source.documentCount) ||
        source.documentCount < 0,
    )
  ) {
    throw new Error('语料库状态格式异常。')
  }
  return data
}

export function sourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

export function parseKnowledgeResults(value: unknown): KnowledgeResult[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is KnowledgeResult =>
        item &&
        ['id', 'title', 'source', 'sourceLabel', 'url', 'excerpt'].every(
          (key) => typeof item[key] === 'string',
        ),
    )
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      title: item.title.slice(0, 300),
      source: item.source,
      sourceLabel: item.sourceLabel.slice(0, 120),
      url: sourceUrl(item.url) || '',
      excerpt: item.excerpt.slice(0, 1800),
      authority: typeof item.authority === 'string' ? item.authority.slice(0, 80) : undefined,
      releaseId: typeof item.releaseId === 'string' ? item.releaseId.slice(0, 200) : undefined,
      dataVersion: typeof item.dataVersion === 'string' ? item.dataVersion.slice(0, 80) : undefined,
      sourceRef: typeof item.sourceRef === 'string' ? item.sourceRef.slice(0, 500) : undefined,
      lineStart:
        Number.isInteger(item.lineStart) && item.lineStart! > 0 ? item.lineStart : undefined,
      lineEnd: Number.isInteger(item.lineEnd) && item.lineEnd! > 0 ? item.lineEnd : undefined,
    }))
}
