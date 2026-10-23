import { useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  Eye,
  FilePenLine,
  FileText,
  Image as ImageIcon,
  PenLine,
  Pin,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { makeId, relativeTime, type Note } from '../lib/workspace'
import '../styles/workspace-views.css'

interface NotesViewProps {
  notes: Note[]
  onChange: (notes: Note[]) => void
  onNotify: (message: string) => void
  selectedNoteId: string | null
  onSelectNote: (id: string | null) => void
}

function MarkdownImage({ src, alt }: { src?: string | Blob; alt?: string }) {
  let href: string | undefined
  if (typeof src === 'string' && src.trim()) {
    try {
      const url = new URL(src, 'https://prts.invalid/')
      if (url.protocol === 'https:' || url.protocol === 'http:') href = src
    } catch {
      /* Invalid image addresses stay as text. */
    }
  }
  return (
    <span className="notes-image-placeholder">
      <ImageIcon size={17} aria-hidden="true" />
      <span>
        <strong>{alt || '笔记图片'}</strong>
        <small>图片未自动加载</small>
      </span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          aria-label={`在新标签页打开图片：${alt || '笔记图片'}`}
        >
          打开图片
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      ) : null}
    </span>
  )
}

const markdownComponents: Components = {
  a: ({ children, href, node }) => {
    // An image can already be nested inside a Markdown link. Avoid nested anchors.
    if (node?.children.some((child) => child.type === 'element' && child.tagName === 'img'))
      return <span>{children}</span>
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
  img: MarkdownImage,
}

export default function NotesView({
  notes,
  onChange,
  onNotify,
  selectedNoteId,
  onSelectNote,
}: NotesViewProps) {
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState(false)
  const [documentMotion, setDocumentMotion] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [mobileEditor, setMobileEditor] = useState(Boolean(selectedNoteId))
  const titleRef = useRef<HTMLInputElement>(null)
  const selected = notes.find((note) => note.id === selectedNoteId) ?? notes[0] ?? null
  const search = query.trim().toLocaleLowerCase()
  const visibleNotes = notes
    .filter(
      (note) =>
        !search || `${note.title} ${note.content} ${note.tag}`.toLocaleLowerCase().includes(search),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    )

  useEffect(() => {
    setConfirmDelete(false)
  }, [selected?.id])

  useEffect(() => {
    if (selectedNoteId) setMobileEditor(true)
  }, [selectedNoteId])

  function createNote(event: MouseEvent<HTMLButtonElement>) {
    const note: Note = {
      id: makeId(),
      title: '未命名笔记',
      content: '',
      tag: '灵感',
      updatedAt: new Date().toISOString(),
      pinned: false,
    }
    onChange([note, ...notes])
    onSelectNote(note.id)
    setQuery('')
    setPreview(false)
    setDocumentMotion(event.detail > 0)
    setMobileEditor(true)
    onNotify('新笔记已创建')
    requestAnimationFrame(() => titleRef.current?.select())
  }

  function updateNote(patch: Partial<Pick<Note, 'title' | 'content' | 'tag' | 'pinned'>>) {
    if (!selected) return
    onChange(
      notes.map((note) =>
        note.id === selected.id ? { ...note, ...patch, updatedAt: new Date().toISOString() } : note,
      ),
    )
  }

  function deleteNote(event: MouseEvent<HTMLButtonElement>) {
    if (!selected) return
    setDocumentMotion(event.detail > 0)
    const next = notes.filter((note) => note.id !== selected.id)
    onChange(next)
    onSelectNote(next[0]?.id ?? null)
    setConfirmDelete(false)
    if (!next.length) setMobileEditor(false)
    onNotify('笔记已删除')
  }

  return (
    <section className="workspace-notes" aria-labelledby="notes-heading">
      <div className="view-heading">
        <div>
          <p className="workspace-eyebrow">PERSONAL ARCHIVE / 02</p>
          <h1 id="notes-heading">个人档案</h1>
          <p className="muted">收集灵感，让每一个想法都有迹可循。</p>
        </div>
        <button className="button button-primary" onClick={createNote}>
          <Plus size={17} aria-hidden="true" />
          新建笔记
        </button>
      </div>

      <div className={`notes-workspace panel${mobileEditor ? ' notes-workspace--editing' : ''}`}>
        <aside className="notes-sidebar" aria-label="笔记列表">
          <div className="notes-sidebar-heading">
            <span>全部笔记</span>
            <span className="workspace-counter">{String(notes.length).padStart(2, '0')}</span>
          </div>
          <label className="workspace-search notes-search">
            <Search size={16} aria-hidden="true" />
            <span className="workspace-sr-only">搜索笔记</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、内容或标签…"
              type="search"
            />
          </label>
          <div className="notes-list">
            {visibleNotes.map((note) => (
              <button
                key={note.id}
                className={`notes-list-item${selected?.id === note.id ? ' is-selected' : ''}`}
                aria-current={selected?.id === note.id ? 'true' : undefined}
                onClick={(event) => {
                  setDocumentMotion(event.detail > 0)
                  onSelectNote(note.id)
                  setMobileEditor(true)
                }}
              >
                <span className="notes-item-title">
                  <FileText size={16} aria-hidden="true" />
                  <strong>{note.title.trim() || '未命名笔记'}</strong>
                  {note.pinned ? <Pin size={13} className="notes-pin" aria-label="已置顶" /> : null}
                </span>
                <span className="notes-item-excerpt">
                  {note.content.replace(/[#*`>\[\]]/g, '').trim() || '还没有内容，写下第一个想法。'}
                </span>
                <span className="notes-item-meta">
                  <span className="notes-tag">{note.tag.trim() || '未分类'}</span>
                  <time dateTime={note.updatedAt}>{relativeTime(note.updatedAt)}</time>
                </span>
              </button>
            ))}
            {!visibleNotes.length ? (
              <div className="notes-list-empty">
                <Search size={24} aria-hidden="true" />
                <p>{query ? '没有找到相关笔记' : '你的灵感档案从这里开始'}</p>
                {query ? (
                  <button className="button button-ghost" onClick={() => setQuery('')}>
                    清除搜索
                  </button>
                ) : (
                  <button className="button button-ghost" onClick={createNote}>
                    创建第一篇笔记
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            ) : null}
          </div>
          <div className="notes-sidebar-foot">
            <span className="workspace-status-dot" /> 本地存储{' '}
            <span className="mono">MARKDOWN</span>
          </div>
        </aside>

        <div className="notes-editor">
          {selected ? (
            <>
              <div className="notes-editor-toolbar">
                <button
                  className="icon-button notes-back"
                  onClick={() => setMobileEditor(false)}
                  aria-label="返回笔记列表"
                >
                  <ArrowLeft size={18} />
                </button>
                <span className="notes-save-status">
                  <Check size={14} aria-hidden="true" />
                  自动保存
                </span>
                <div className="notes-editor-actions">
                  <button
                    className={`button button-ghost notes-preview-button${preview ? ' is-active' : ''}`}
                    aria-pressed={preview}
                    aria-controls="note-document"
                    onClick={(event) => {
                      setDocumentMotion(event.detail > 0)
                      setPreview(!preview)
                    }}
                  >
                    {preview ? (
                      <PenLine size={15} aria-hidden="true" />
                    ) : (
                      <Eye size={15} aria-hidden="true" />
                    )}
                    {preview ? '编辑' : '预览'}
                  </button>
                  <span className="notes-toolbar-divider" />
                  <button
                    className={`icon-button${selected.pinned ? ' notes-is-pinned' : ''}`}
                    aria-label={selected.pinned ? '取消置顶笔记' : '置顶笔记'}
                    title={selected.pinned ? '取消置顶' : '置顶笔记'}
                    aria-pressed={selected.pinned}
                    onClick={() => updateNote({ pinned: !selected.pinned })}
                  >
                    <Pin size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="删除笔记"
                    title="删除笔记"
                    aria-expanded={confirmDelete}
                    aria-controls={confirmDelete ? 'note-delete-confirm' : undefined}
                    onClick={() => setConfirmDelete(!confirmDelete)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {confirmDelete ? (
                <div id="note-delete-confirm" className="workspace-inline-confirm" role="alert">
                  <span>确定删除这篇笔记？此操作无法撤销。</span>
                  <div>
                    <button className="button workspace-danger-button" onClick={deleteNote}>
                      确认删除
                    </button>
                    <button
                      className="icon-button"
                      aria-label="取消删除笔记"
                      onClick={() => setConfirmDelete(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ) : null}
              <div
                id="note-document"
                key={`${selected.id}:${preview ? 'preview' : 'edit'}`}
                className={`notes-editor-document${documentMotion ? ' notes-document-transition' : ''}`}
              >
                <label className="workspace-sr-only" htmlFor="note-title">
                  笔记标题
                </label>
                <input
                  ref={titleRef}
                  id="note-title"
                  className="notes-title-input"
                  value={selected.title}
                  placeholder="未命名笔记"
                  onChange={(event) => updateNote({ title: event.target.value })}
                  maxLength={180}
                />
                <div className="notes-document-meta">
                  <label className="notes-tag-field">
                    <Tag size={13} aria-hidden="true" />
                    <span className="workspace-sr-only">笔记标签</span>
                    <input
                      value={selected.tag}
                      placeholder="添加标签"
                      maxLength={24}
                      onChange={(event) => updateNote({ tag: event.target.value })}
                    />
                  </label>
                  <span className="notes-meta-divider">/</span>
                  <time dateTime={selected.updatedAt}>
                    更新于 {relativeTime(selected.updatedAt)}
                  </time>
                </div>
                {preview ? (
                  <article className="notes-markdown" aria-label="Markdown 预览">
                    {selected.content.trim() ? (
                      <ReactMarkdown skipHtml components={markdownComponents}>
                        {selected.content}
                      </ReactMarkdown>
                    ) : (
                      <p className="notes-empty-preview">
                        还没有内容。切换到编辑，开始记录你的想法。
                      </p>
                    )}
                  </article>
                ) : (
                  <>
                    <label className="workspace-sr-only" htmlFor="note-content">
                      笔记正文
                    </label>
                    <textarea
                      id="note-content"
                      className="notes-content-input"
                      value={selected.content}
                      onChange={(event) => updateNote({ content: event.target.value })}
                      placeholder={
                        '在这里写下你的想法…\n\n支持 Markdown，使用 # 创建标题，- 创建列表。'
                      }
                      maxLength={1_000_000}
                      spellCheck={false}
                    />
                  </>
                )}
              </div>
              <div className="notes-editor-foot">
                <span className="mono">{preview ? 'PREVIEW MODE' : 'MARKDOWN ENABLED'}</span>
                <span>{Array.from(selected.content).length.toLocaleString()} 字符</span>
              </div>
            </>
          ) : (
            <div className="notes-editor-empty empty-state">
              <div className="workspace-empty-symbol">
                <FilePenLine size={32} strokeWidth={1.3} aria-hidden="true" />
              </div>
              <p className="workspace-eyebrow">A PLACE FOR YOUR THOUGHTS</p>
              <h2>把想法，留在这里。</h2>
              <p>
                计划、灵感、阅读摘记。
                <br />
                从一篇笔记开始，建立你的个人知识档案。
              </p>
              <button className="button button-primary" onClick={createNote}>
                <Plus size={16} aria-hidden="true" />
                创建第一篇笔记
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
