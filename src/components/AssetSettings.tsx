import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { parseCorpusSyncStatus, type CorpusSyncStatus } from '../lib/corpusSync'
import { SectionTitle } from './UI'

export default function AssetSettings() {
  const [status, setStatus] = useState<CorpusSyncStatus | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  const operation = useRef(false)
  async function read() {
    const response = await apiFetch('/api/assets/sync', { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || '无法读取图片资源状态。')
    const next = parseCorpusSyncStatus(body)
    if (active.current) {
      setStatus(next)
      setReady(body.ready === true)
    }
    return next
  }
  useEffect(() => {
    active.current = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        await read()
        if (active.current) setError('')
      } catch (cause) {
        if (active.current)
          setError(cause instanceof Error ? cause.message : '图片资源服务暂不可用。')
      }
      if (active.current) timer = setTimeout(poll, 2000)
    }
    void poll()
    return () => {
      active.current = false
      clearTimeout(timer)
    }
  }, [])
  async function start() {
    if (operation.current || status?.state === 'running') return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch('/api/assets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: ready ? 'update' : 'install' }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '图片下载未能启动。')
      if (active.current) {
        setStatus(parseCorpusSyncStatus(body))
        setReady(body.ready === true)
      }
    } catch (cause) {
      try {
        const current = await read()
        if (current.state !== 'running') throw cause
      } catch {
        if (active.current)
          setError(cause instanceof Error ? cause.message : '图片下载未能启动，请重试。')
      }
    } finally {
      operation.current = false
      if (active.current) setBusy(false)
    }
  }
  const running = status?.state === 'running'
  const percent =
    status && status.totalFiles > 0
      ? Math.round((status.completedFiles / status.totalFiles) * 100)
      : undefined
  return (
    <section className="panel settings-section asset-settings">
      <SectionTitle title="图片资源" english="ILLUSTRATION ASSETS" />
      <p className="settings-copy">
        阿米娅立绘和语料配图保存在服务器资源目录。首次部署为空，点击下载后启用。
      </p>
      <p role="status">
        {running
          ? `正在下载并校验图片 · ${status.completedFiles} / ${status.totalFiles}`
          : status?.state === 'failed'
            ? status.error
            : ready
              ? '图片资源已就绪'
              : '尚未下载图片资源'}
      </p>
      {running && (
        <progress
          aria-label="图片资源下载进度"
          max={100}
          value={percent}
          style={{ width: '100%' }}
        />
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button button-ghost"
        disabled={busy || running || !status}
        onClick={() => void start()}
      >
        {ready ? <RefreshCw size={15} /> : <Download size={15} />}
        {running ? '图片下载进行中' : ready ? '检查并更新图片' : '首次下载图片'}
      </button>
    </section>
  )
}
