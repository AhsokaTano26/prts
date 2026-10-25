import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import {
  AlertCircle,
  Check,
  Download,
  File as FileIcon,
  FileArchive,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { listFiles, removeFile, storeFiles, readFileBlob, type WorkspaceFile } from '../lib/files'
import { formatBytes, relativeTime } from '../lib/workspace'
import { motionAllowed, stopInterfaceMotion, transitionView } from '../lib/motion'
import '../styles/workspace-views.css'

interface FilesViewProps {
  onNotify: (message: string) => void
  onActivity: (text: string) => void
  onCountChange: (count: number) => void
}

type FileCategory = 'all' | 'document' | 'image' | 'other'
const FILE_LIMIT = 20 * 1024 * 1024
const TOTAL_LIMIT = 100 * 1024 * 1024
// Keep these durations aligned with the corresponding CSS exit animations.
const ROW_EXIT_MS = 140
const PREVIEW_EXIT_MS = 160
const FILTERS: { value: FileCategory; label: string }[] = [
  { value: 'all', label: '全部文件' },
  { value: 'document', label: '文档' },
  { value: 'image', label: '图片' },
  { value: 'other', label: '其他' },
]

function categoryOf(file: WorkspaceFile): Exclude<FileCategory, 'all'> {
  if (
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic)$/i.test(file.name)
  )
    return 'image'
  if (
    file.type.startsWith('text/') ||
    /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json|rtf|odt|epub)$/i.test(file.name)
  )
    return 'document'
  return 'other'
}

function canPreview(file: WorkspaceFile) {
  return /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(file.type)
}

function FileSymbol({ file }: { file: WorkspaceFile }) {
  if (categoryOf(file) === 'image')
    return <ImageIcon size={21} strokeWidth={1.5} aria-hidden="true" />
  if (categoryOf(file) === 'document')
    return <FileText size={21} strokeWidth={1.5} aria-hidden="true" />
  if (/\.(zip|rar|7z|tar|gz)$/i.test(file.name))
    return <FileArchive size={21} strokeWidth={1.5} aria-hidden="true" />
  return <FileIcon size={21} strokeWidth={1.5} aria-hidden="true" />
}

export default function FilesView({ onNotify, onActivity, onCountChange }: FilesViewProps) {
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FileCategory>('all')
  const requestedFilter = useRef<FileCategory>('all')
  function changeFilter(value: FileCategory) {
    if (requestedFilter.current === value) return
    requestedFilter.current = value
    transitionView(
      () => {
        setFilter(value)
        setConfirmDelete(null)
      },
      { scope: 'collection' },
    )
  }
  const [dragging, setDragging] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [enteringIds, setEnteringIds] = useState<string[]>([])
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ file: WorkspaceFile; url: string } | null>(null)
  const [previewClosing, setPreviewClosing] = useState(false)
  const [previewMotion, setPreviewMotion] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previewTrigger = useRef<HTMLElement | null>(null)
  const closingPreview = useRef(false)
  const uploadMotion = useRef(true)
  const motionTimers = useRef(new Map<number, () => void>())
  const mounted = useRef(false)
  const operation = useRef(false)
  const dragDepth = useRef(0)
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  const search = query.trim().toLocaleLowerCase()
  const visibleFiles = files.filter(
    (file) =>
      (filter === 'all' || categoryOf(file) === filter) &&
      (!search || file.name.toLocaleLowerCase().includes(search)),
  )

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await listFiles()
      if (mounted.current) {
        setFiles(result.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)))
        setLoaded(true)
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : '无法读取服务器文件，请重试。')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void reload()
    const timers = motionTimers.current
    return () => {
      mounted.current = false
      for (const [timer, resolve] of timers) {
        window.clearTimeout(timer)
        resolve()
      }
      timers.clear()
    }
  }, [reload])

  useEffect(() => {
    if (loaded) onCountChange(files.length)
  }, [files.length, loaded, onCountChange])

  useEffect(() => {
    if (!preview) return
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => {
      dialog?.close()
      URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  useEffect(() => {
    if (!enteringIds.length) return
    const timer = window.setTimeout(() => setEnteringIds([]), 220)
    return () => window.clearTimeout(timer)
  }, [enteringIds])

  function waitForMotion(duration: number, animate = true): Promise<void> {
    if (!animate || !motionAllowed()) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        motionTimers.current.delete(timer)
        resolve()
      }, duration)
      motionTimers.current.set(timer, resolve)
    })
  }

  async function closePreview(animate = true) {
    if (closingPreview.current || !preview) return
    closingPreview.current = true
    setPreviewClosing(true)
    await waitForMotion(PREVIEW_EXIT_MS, animate && previewMotion)
    if (!mounted.current) return
    dialogRef.current?.close()
    setPreview(null)
    setPreviewClosing(false)
    closingPreview.current = false
    previewTrigger.current?.focus()
  }

  function openPicker(event: MouseEvent<HTMLButtonElement>) {
    uploadMotion.current = event.detail > 0
    inputRef.current?.click()
  }

  async function uploadFiles(picked: File[]) {
    if (!picked.length || operation.current || loading || !loaded) return
    setError('')
    const oversized = picked.find((file) => file.size > FILE_LIMIT)
    if (oversized) {
      setError(`“${oversized.name}”超过单文件 20 MB 限制，请选择更小的文件。`)
      return
    }
    const uploadBytes = picked.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes + uploadBytes > TOTAL_LIMIT) {
      setError(
        `存储空间不足：本次上传 ${formatBytes(uploadBytes)}，剩余 ${formatBytes(Math.max(0, TOTAL_LIMIT - totalBytes))}。请删除部分文件后重试。`,
      )
      return
    }
    operation.current = true
    setBusy(true)
    try {
      const added = await storeFiles(picked)
      if (!mounted.current) return
      setEnteringIds(uploadMotion.current ? added.map((file) => file.id) : [])
      setFiles((current) =>
        [...added, ...current].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      )
      setQuery('')
      stopInterfaceMotion('collection')
      requestedFilter.current = 'all'
      setFilter('all')
      onNotify(`已上传 ${added.length} 个文件`)
      onActivity(`上传了 ${added.length} 个文件`)
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : '文件上传失败，请检查网络后重试。')
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function deleteFile(file: WorkspaceFile, animate = true) {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      await removeFile(file.id)
      if (!mounted.current) return
      setRemovingId(file.id)
      await waitForMotion(ROW_EXIT_MS, animate)
      if (!mounted.current) return
      setFiles((current) => current.filter((item) => item.id !== file.id))
      setRemovingId(null)
      setConfirmDelete(null)
      onNotify('文件已删除')
      onActivity(`删除文件「${file.name}」`)
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : '文件删除失败，请重试。')
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function downloadFile(file: WorkspaceFile) {
    try {
      const url = URL.createObjectURL(await readFileBlob(file.id))
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setError('文件下载失败，请重试。')
    }
  }

  async function openFile(file: WorkspaceFile, animate = true) {
    if (canPreview(file)) {
      previewTrigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      closingPreview.current = false
      setPreviewMotion(animate)
      setPreviewClosing(false)
      try {
        const blob = await readFileBlob(file.id)
        if (mounted.current) setPreview({ file, url: URL.createObjectURL(blob) })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '无法加载图片，请重试。')
      }
    } else downloadFile(file)
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    uploadMotion.current = true
    void uploadFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <section className="workspace-files" aria-labelledby="files-heading">
      <div className="view-heading">
        <div>
          <p className="workspace-eyebrow">RESOURCE LIBRARY / 03</p>
          <h1 id="files-heading">文件资料库</h1>
          <p className="muted">将重要资料归档，随时调用你的知识储备。</p>
        </div>
        <button
          className="button button-primary"
          disabled={busy || loading || !loaded}
          onClick={openPicker}
        >
          <Upload size={17} aria-hidden="true" />
          {busy ? '处理中…' : '上传文件'}
        </button>
      </div>

      <input
        ref={inputRef}
        className="workspace-sr-only"
        type="file"
        multiple
        tabIndex={-1}
        aria-label="选择上传的文件"
        disabled={busy || loading || !loaded}
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? [])
          event.target.value = ''
          void uploadFiles(picked)
        }}
      />
      <div
        className={`files-drop-area${dragging ? ' is-dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = busy || loading || !loaded ? 'none' : 'copy'
        }}
        onDrop={handleDrop}
      >
        <button
          className="files-dropzone"
          disabled={busy || loading || !loaded}
          onClick={openPicker}
        >
          <span className="files-dropzone-symbol">
            {busy ? (
              <LoaderCircle size={26} className="workspace-spin" aria-hidden="true" />
            ) : (
              <Upload size={26} strokeWidth={1.4} aria-hidden="true" />
            )}
          </span>
          <span className="files-dropzone-copy">
            <strong>
              {dragging
                ? '松开，将文件存入资料库'
                : busy
                  ? '正在处理文件，请稍候…'
                  : '拖拽文件到此处，或点击上传'}
            </strong>
            <span>支持多文件上传 · 单文件最大 20 MB</span>
          </span>
          <span className="files-upload-label mono">
            LOCAL STORAGE <span>↗</span>
          </span>
        </button>
      </div>

      {error ? (
        <div className="files-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
          {!loaded ? (
            <button
              className="button button-ghost"
              disabled={loading}
              onClick={() => void reload()}
            >
              重新加载
            </button>
          ) : (
            <button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}>
              <X size={16} />
            </button>
          )}
        </div>
      ) : null}

      <div className="files-library panel motion-collection" aria-busy={loading || busy}>
        <div className="files-library-toolbar">
          <div className="files-filter-group" role="group" aria-label="按文件类型筛选">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                className={`files-filter${filter === item.value ? ' is-active' : ''}`}
                aria-pressed={filter === item.value}
                onClick={() => changeFilter(item.value)}
              >
                {item.label}
                {item.value === 'all' ? <span>{files.length}</span> : null}
              </button>
            ))}
          </div>
          <label className="workspace-search files-search">
            <Search size={16} aria-hidden="true" />
            <span className="workspace-sr-only">搜索文件</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setConfirmDelete(null)
              }}
              placeholder="搜索文件…"
            />
          </label>
        </div>
        {loading ? (
          <div className="files-empty" role="status">
            <LoaderCircle size={28} className="workspace-spin" aria-hidden="true" />
            <p>正在读取资料库…</p>
          </div>
        ) : !loaded ? (
          <div className="files-empty">
            <AlertCircle size={30} aria-hidden="true" />
            <h2>暂时无法打开资料库</h2>
            <p>本地存储连接失败，请重新加载。</p>
            <button className="button button-ghost" onClick={() => void reload()}>
              重试
            </button>
          </div>
        ) : !visibleFiles.length ? (
          <div className="files-empty empty-state">
            <div className="workspace-empty-symbol">
              {query || filter !== 'all' ? (
                <Search size={29} strokeWidth={1.4} aria-hidden="true" />
              ) : (
                <FolderOpen size={32} strokeWidth={1.3} aria-hidden="true" />
              )}
            </div>
            <p className="workspace-eyebrow">
              {query || filter !== 'all' ? 'NO MATCHING RESOURCES' : 'READY FOR YOUR RESOURCES'}
            </p>
            <h2>{query || filter !== 'all' ? '没有找到相关文件' : '为你的资料，留一个位置。'}</h2>
            <p>
              {query || filter !== 'all'
                ? '试试其他关键词，或查看全部文件。'
                : '上传文档、图片与项目资料，让它们井然有序。'}
            </p>
            {query || filter !== 'all' ? (
              <button
                className="button button-ghost"
                onClick={() => {
                  setQuery('')
                  changeFilter('all')
                }}
              >
                清除筛选
              </button>
            ) : (
              <button className="button button-ghost" onClick={openPicker} disabled={busy}>
                <PlusUpload />
                上传第一个文件
              </button>
            )}
          </div>
        ) : (
          <div className="files-table-wrap">
            <table className="files-table">
              <caption className="workspace-sr-only">
                资料库文件，共 {visibleFiles.length} 个搜索结果
              </caption>
              <thead>
                <tr>
                  <th scope="col">文件名称</th>
                  <th scope="col" className="files-type-column">
                    类型
                  </th>
                  <th scope="col" className="files-size-column">
                    大小
                  </th>
                  <th scope="col" className="files-date-column">
                    添加时间
                  </th>
                  <th scope="col" className="files-actions-column">
                    <span className="workspace-sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleFiles.map((file) => (
                  <tr
                    key={file.id}
                    className={`${enteringIds.includes(file.id) ? 'files-row-entering' : ''}${removingId === file.id ? ' files-row-leaving' : ''}`}
                  >
                    <td>
                      <button
                        className="files-name-button"
                        onClick={(event) => openFile(file, event.detail > 0)}
                        disabled={removingId === file.id}
                        aria-label={`${canPreview(file) ? '预览图片' : '下载文件'}：${file.name}`}
                        aria-haspopup={canPreview(file) ? 'dialog' : undefined}
                        title={`${canPreview(file) ? '预览' : '下载'} ${file.name}`}
                      >
                        <span
                          className={`files-file-symbol files-file-symbol--${categoryOf(file)}`}
                        >
                          <FileSymbol file={file} />
                        </span>
                        <span className="files-file-name">
                          <strong>{file.name}</strong>
                          <span className="files-mobile-meta">
                            {formatBytes(file.size)} · {relativeTime(file.createdAt)}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="files-type-column">
                      <span className="files-extension mono">
                        {file.name.includes('.')
                          ? file.name.split('.').pop()?.slice(0, 8).toUpperCase()
                          : 'FILE'}
                      </span>
                    </td>
                    <td className="files-size-column mono">{formatBytes(file.size)}</td>
                    <td className="files-date-column">
                      <time dateTime={file.createdAt}>{relativeTime(file.createdAt)}</time>
                    </td>
                    <td className="files-actions-column">
                      {confirmDelete === file.id ? (
                        <div className="files-row-actions files-confirm-actions">
                          <button
                            className="files-confirm-delete"
                            aria-label={`确认删除 ${file.name}`}
                            title="确认删除，此操作无法撤销"
                            disabled={busy}
                            onClick={(event) => void deleteFile(file, event.detail > 0)}
                          >
                            <Check size={13} aria-hidden="true" />
                            <span>删除</span>
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`取消删除 ${file.name}`}
                            onClick={() => setConfirmDelete(null)}
                            disabled={busy}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <div className="files-row-actions">
                          <button
                            className="icon-button"
                            aria-label={`下载 ${file.name}`}
                            title="下载文件"
                            onClick={() => downloadFile(file)}
                          >
                            <Download size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`删除 ${file.name}`}
                            title="删除文件"
                            disabled={busy}
                            onClick={() => setConfirmDelete(file.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="files-library-foot">
          <span>
            <span className="workspace-status-dot" /> 已归档 {files.length} 个文件
          </span>
          <span className="mono">PRIVATE / SERVER</span>
        </div>
      </div>
      <div className="files-storage">
        <div>
          <FolderOpen size={16} aria-hidden="true" />
          <span>服务器存储空间</span>
          <strong className="mono">
            {formatBytes(totalBytes)} <span>/ 100 MB</span>
          </strong>
        </div>
        <progress value={totalBytes} max={TOTAL_LIMIT} aria-label="服务器文件存储用量" />
        <p>文件保存在服务器，登录同一终端即可在其他设备访问。</p>
      </div>

      {preview ? (
        <dialog
          ref={dialogRef}
          className={`files-preview-dialog${previewClosing ? ' is-closing' : ''}${previewMotion ? '' : ' files-preview-instant'}`}
          onClose={() => {
            setPreview(null)
            previewTrigger.current?.focus()
          }}
          onCancel={(event) => {
            event.preventDefault()
            void closePreview(false)
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) void closePreview()
          }}
          aria-labelledby="file-preview-title"
          aria-modal="true"
        >
          <div className="files-preview-header">
            <h2 id="file-preview-title">{preview.file.name}</h2>
            <button
              className="icon-button"
              aria-label="关闭图片预览"
              onClick={(event) => void closePreview(event.detail > 0)}
              autoFocus
            >
              <X size={20} />
            </button>
          </div>
          <div className="files-preview-image">
            <img src={preview.url} alt={preview.file.name} />
          </div>
          <div className="files-preview-footer">
            <span className="mono">{formatBytes(preview.file.size)}</span>
            <button className="button button-ghost" onClick={() => downloadFile(preview.file)}>
              <Download size={16} aria-hidden="true" />
              下载原图
            </button>
          </div>
        </dialog>
      ) : null}
    </section>
  )
}

function PlusUpload() {
  return <Upload size={15} aria-hidden="true" />
}
