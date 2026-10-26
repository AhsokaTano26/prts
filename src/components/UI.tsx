import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X, ArrowUpRight } from 'lucide-react'
import { useAppearance } from '../lib/appearance'

export function Logo({ small = false }: { small?: boolean }) {
  const { theme } = useAppearance()
  return (
    <img
      className={`brand-symbol${small ? ' small' : ''}${theme === 'rhine' ? ' rhine-logo' : ''}`}
      src={theme === 'rhine' ? '/branding/rhine-lab.png' : '/branding/rhodes-island.png'}
      alt=""
      aria-hidden="true"
      style={{ objectFit: 'contain' }}
    />
  )
}
export function SectionTitle({
  title,
  english,
  action,
  onAction,
}: {
  title: string
  english: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="section-title">
      <h2>
        {title}
        <span>/ {english}</span>
      </h2>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}
          <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  )
}
export function Modal({
  title,
  children,
  onClose,
  className = '',
}: {
  title: string
  children: ReactNode
  onClose: () => void
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => {
      dialog?.close()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${className}`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect()
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose()
        }
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭弹窗">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
