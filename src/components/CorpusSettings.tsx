import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, Check, Database } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { parseKnowledgeStatus, type KnowledgeStatus } from '../lib/assistant'
import {
  parseCorpusSyncStatus,
  syncDescription,
  syncProgress,
  type CorpusSyncStatus,
} from '../lib/corpusSync'
import { SectionTitle } from './UI'
import '../styles/corpus-settings.css'

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export default function CorpusSettings() {
  const [knowledge, setKnowledge] = useState<KnowledgeStatus | null>(null)
  const [job, setJob] = useState<CorpusSyncStatus | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [starting, setStarting] = useState(false)
  const active = useRef(true)
  const requestVersion = useRef(0)
  const request = useRef<AbortController | null>(null)
  const posting = useRef(false)
  const postingRequest = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    request.current?.abort()
    const abort = new AbortController()
    request.current = abort
    try {
      const jobResponse = await apiFetch('/api/knowledge/sync', { signal: abort.signal })
      const jobData = await jobResponse.json()
      if (!jobResponse.ok) throw new Error(jobData.error || '无法读取同步状态。')
      const parsedJob = parseCorpusSyncStatus(jobData)
      // Read the active library after job completion so the final version cannot be stale.
      const statusResponse = await apiFetch('/api/knowledge', { signal: abort.signal })
      const statusData = await statusResponse.json()
      if (!statusResponse.ok) throw new Error(statusData.error || '无法读取语料状态。')
      const parsedKnowledge = parseKnowledgeStatus(statusData)
      if (!active.current || version !== requestVersion.current) return
      setKnowledge(parsedKnowledge)
      setJob(parsedJob)
      setError('')
    } catch (cause) {
      if (active.current && version === requestVersion.current && !abort.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '无法连接语料服务。')
      }
    } finally {
      if (active.current && version === requestVersion.current) setChecking(false)
    }
  }, [])

  useEffect(() => {
    active.current = true
    void refresh()
    const onFocus = () => {
      if (!posting.current) void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      active.current = false
      request.current?.abort()
      postingRequest.current?.abort()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  useEffect(() => {
    if (job?.state !== 'running' || starting) return
    let disposed = false
    let timer: number
    const poll = async () => {
      await refresh()
      if (!disposed) timer = window.setTimeout(() => void poll(), 1500)
    }
    timer = window.setTimeout(() => void poll(), 1500)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [job?.state, starting, refresh])

  async function start(mode: 'install' | 'update') {
    if (posting.current || job?.state === 'running') return
    posting.current = true
    setStarting(true)
    setError('')
    ++requestVersion.current
    request.current?.abort()
    const abort = new AbortController()
    postingRequest.current = abort
    try {
      const response = await apiFetch('/api/knowledge/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
        signal: abort.signal,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法启动语料同步。')
      const next = parseCorpusSyncStatus(data)
      if (active.current) setJob(next)
      if (next.state !== 'running') await refresh()
    } catch (cause) {
      if (active.current && !abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : '无法启动语料同步。')
    } finally {
      posting.current = false
      postingRequest.current = null
      if (active.current) setStarting(false)
    }
  }

  const running = starting || job?.state === 'running'
  const unavailable = checking || !knowledge || !job || Boolean(error)
  const percent = job ? syncProgress(job) : undefined
  return (
    <section className="panel settings-section data-section corpus-settings">
      <SectionTitle title="语料管理" english="CORPUS MANAGEMENT" />
      <div className="corpus-settings-overview">
        <div className="corpus-settings-info">
          <h3>
            <Database size={18} />
            {knowledge?.ready
              ? '本地语料已就绪'
              : checking
                ? '正在读取语料状态'
                : !knowledge
                  ? '暂时无法读取语料状态'
                  : '首次使用，下载语料后即可检索'}
          </h3>
          <p>明日方舟与终末地语料保存在本机。首次下载约 260 MB，更新时自动复用已校验的文件。</p>
          {knowledge?.ready && (
            <div className="corpus-settings-counts">
              {knowledge.sources.map((source) => (
                <span key={source.id}>
                  {source.name}
                  <strong>{source.documentCount.toLocaleString('zh-CN')} 篇</strong>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="corpus-settings-actions">
          <button
            className={`button ${knowledge?.ready ? 'button-ghost' : 'button-primary'}`}
            disabled={running || unavailable || knowledge?.ready}
            onClick={() => void start('install')}
          >
            <Download size={15} />
            首次下载语料
          </button>
          <button
            className={`button ${knowledge?.ready ? 'button-primary' : 'button-ghost'}`}
            disabled={running || unavailable || !knowledge?.ready}
            onClick={() => void start('update')}
          >
            <RefreshCw size={15} />
            检查并更新语料
          </button>
        </div>
      </div>
      {knowledge?.release && (
        <p className="corpus-settings-version">
          <span>当前版本</span>
          <code>{knowledge.release}</code>
        </p>
      )}
      {job && (starting || job.state !== 'idle') && (
        <div className={`corpus-sync-status ${job.state}`}>
          <div className="corpus-sync-heading" role="status">
            {!starting && job.state === 'succeeded' && <Check size={15} />}
            {starting ? '正在启动同步' : syncDescription(job)}
            {job.state === 'running' && percent !== undefined && (
              <span className="mono">{percent}%</span>
            )}
          </div>
          {job.state === 'running' && (
            <>
              <progress aria-label="语料同步进度" max={100} value={percent} />
              <p className="corpus-sync-numbers">
                {job.totalFiles > 0
                  ? `已处理 ${job.completedFiles.toLocaleString('zh-CN')} / ${job.totalFiles.toLocaleString('zh-CN')} 个文件`
                  : '正在获取发布清单…'}
                {job.totalBytes > 0 && (
                  <span>
                    {megabytes(job.completedBytes)} / {megabytes(job.totalBytes)}
                  </span>
                )}
              </p>
              <p className="corpus-sync-hint">
                可离开此页面，后台会继续同步。新版本校验完成后自动生效。
              </p>
            </>
          )}
          {!starting && job.state === 'failed' && (
            <p role="alert">
              {job.error || '同步失败，请重试。'}
              {knowledge?.ready ? ' 已安装的语料仍可使用。' : ' 再次下载会复用已完成的文件。'}
            </p>
          )}
          {!starting && job.state === 'succeeded' && job.finishedAt && (
            <p>
              完成时间：
              {Number.isNaN(Date.parse(job.finishedAt))
                ? '刚刚'
                : new Date(job.finishedAt).toLocaleString('zh-CN')}
            </p>
          )}
        </div>
      )}
      {error && (
        <div className="corpus-settings-error">
          <p role="alert">{error}</p>
          <button
            className="text-button"
            disabled={starting || checking}
            onClick={() => {
              setChecking(true)
              void refresh()
            }}
          >
            <RefreshCw size={14} />
            重新连接
          </button>
        </div>
      )}
    </section>
  )
}
