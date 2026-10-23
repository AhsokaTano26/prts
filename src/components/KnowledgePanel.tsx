import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, Download, ExternalLink, Search } from 'lucide-react'
import { apiFetch } from '../lib/api'
import CorpusMarkdown from './CorpusMarkdown'
import PrtsSelect from './PrtsSelect'
import {
  CORPUS_DOWNLOADS,
  parseKnowledgeResults,
  parseKnowledgeStatus,
  sourceUrl,
  type KnowledgeResult,
  type KnowledgeScope,
  type KnowledgeStatus,
} from '../lib/assistant'

export function KnowledgeSources({
  sources,
  compact = false,
}: {
  sources: KnowledgeResult[]
  compact?: boolean
}) {
  return (
    <ol className={`knowledge-results ${compact ? 'compact' : ''}`}>
      {sources.map((source, index) => (
        <li key={`${source.id}-${index}`}>
          <div className="knowledge-result-heading">
            <span className="reference-number mono">{String(index + 1).padStart(2, '0')}</span>
            {sourceUrl(source.url) ? (
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.title}
                <ExternalLink size={13} />
              </a>
            ) : (
              <strong>{source.title}</strong>
            )}
          </div>
          <div className="knowledge-result-meta">
            {source.sourceLabel}
            {source.authority &&
              ` · ${{ official: '官方文本', official_game_export: '官方游戏文本', reviewed: '社区审校', mixed: '综合资料' }[source.authority] || '来源资料'}`}
            {source.lineStart
              ? ` · 第 ${source.lineStart}${source.lineEnd && source.lineEnd !== source.lineStart ? `–${source.lineEnd}` : ''} 行`
              : ''}
          </div>
          <CorpusMarkdown>{source.excerpt}</CorpusMarkdown>
          {compact && source.sourceRef && (
            <details className="reference-provenance">
              <summary>原文定位与版本</summary>
              <code>{source.sourceRef}</code>
              {source.releaseId && <code>{source.releaseId}</code>}
            </details>
          )}
        </li>
      ))}
    </ol>
  )
}

export default function KnowledgePanel() {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<Exclude<KnowledgeScope, 'none'>>('all')
  const [results, setResults] = useState<KnowledgeResult[]>([])
  const [submitted, setSubmitted] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  useEffect(() => {
    const abort = new AbortController()
    void apiFetch('/api/knowledge', { signal: abort.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '语料库状态读取失败。')
        if (!abort.signal.aborted) setStatus(parseKnowledgeStatus(data))
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted)
          setStatusError(e instanceof Error ? e.message : '无法连接语料库。')
      })
    return () => {
      abort.abort()
      controller.current?.abort()
    }
  }, [])

  async function search(text = query, scope = source) {
    const current = text.trim()
    if (!current) return
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    const version = ++sequence.current
    setQuery(current)
    setBusy(true)
    setError('')
    setResults([])
    setSubmitted('')
    try {
      const response = await apiFetch(
        `/api/knowledge/search?${new URLSearchParams({ q: current, source: scope })}`,
        { signal: abort.signal },
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '资料检索失败，请重试。')
      if (version !== sequence.current) return
      setResults(parseKnowledgeResults(data.results))
      setSubmitted(current)
    } catch (e) {
      if (version === sequence.current && !abort.signal.aborted)
        setError(e instanceof Error ? e.message : '资料检索失败。')
    } finally {
      if (version === sequence.current) setBusy(false)
    }
  }

  return (
    <div className="knowledge-panel">
      <div className="knowledge-intro">
        <span className="mono">TERRA ARCHIVE / LOCAL CORPUS</span>
        <h2>
          <BookOpen size={21} />
          泰拉资料索引
        </h2>
        <p>从原文查找线索。两部作品独立标注来源，无需 AI 密钥即可检索。</p>
      </div>
      <div className="corpus-downloads">
        {CORPUS_DOWNLOADS.map((corpus) => (
          <article className="corpus-card" key={corpus.id}>
            <div>
              <strong>{corpus.name}</strong>
              <span>
                {status?.ready
                  ? `${(status.sources.find((item) => item.id === corpus.id)?.documentCount || 0).toLocaleString('zh-CN')} 篇文档 · 本地可用`
                  : status
                    ? '待导入'
                    : '正在检查本地资料'}
              </span>
            </div>
            <a
              href={corpus.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`下载${corpus.name}语料包`}
            >
              <Download size={14} />
              下载原包
              <ExternalLink size={12} />
            </a>
            <code>{corpus.repository}</code>
          </article>
        ))}
      </div>
      {statusError && (
        <p className="knowledge-warning" role="alert">
          {statusError}
        </p>
      )}
      {status && !status.ready && (
        <p className="knowledge-warning" role="status">
          本地语料尚未就绪。可先通过上方入口下载原包。
        </p>
      )}
      <form
        className="knowledge-search"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          void search()
        }}
      >
        <label className="sr-only" htmlFor="knowledge-query">
          搜索语料库
        </label>
        <div className="knowledge-query">
          <Search size={17} />
          <input
            id="knowledge-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="人物、地点、事件或原文关键词…"
            maxLength={200}
            required
          />
        </div>
        <label className="sr-only" htmlFor="knowledge-source">
          检索作品
        </label>
        <PrtsSelect
          id="knowledge-source"
          aria-label="检索作品"
          value={source}
          onValueChange={(value) => {
            const scope = value as Exclude<KnowledgeScope, 'none'>
            setSource(scope)
            if (query.trim()) void search(query, scope)
          }}
          options={[
            { value: 'all', label: '全部作品' },
            { value: 'arknights', label: '明日方舟' },
            { value: 'endfield', label: '终末地' },
          ]}
        />
        <button className="button button-primary" disabled={!query.trim() || busy}>
          {busy ? '检索中…' : '检索'}
        </button>
      </form>
      {!submitted && !busy && !error && (
        <div className="knowledge-suggestions">
          <span>试试检索</span>
          {['阿米娅', '罗德岛', '管理员', '塔卫二'].map((text) => (
            <button key={text} onClick={() => void search(text)}>
              {text}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="knowledge-warning" role="alert">
          {error}
        </p>
      )}
      <div className="knowledge-matches" aria-live="polite" aria-busy={busy}>
        {submitted && (
          <p className="knowledge-result-count">
            「{submitted}」·{' '}
            {results.length ? `${results.length} 条相关资料` : '未找到匹配资料，请换一个关键词。'}
          </p>
        )}
        <KnowledgeSources sources={results} />
      </div>
      <div className="corpus-footnote">
        <span>
          {status?.ready
            ? `已内置 ${status.documentCount.toLocaleString('zh-CN')} 篇文档`
            : 'HTiantian · PRTS Agent Corpus'}
        </span>
        {status?.release && <code title={status.release}>{status.release}</code>}
      </div>
    </div>
  )
}
