import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X, ArrowUpRight } from 'lucide-react'

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? 'brand-symbol small' : 'brand-symbol'}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <path d="M50 8 95 87H5Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M50 13 88 83H12Z" fill="none" stroke="currentColor" strokeWidth=".5" />
      <path
        d="m43 28 3-1 4-13 4 13 3 1-1 13 7 7-2 19 12 15H27l12-15-2-19 7-7Z"
        fill="currentColor"
      />
      <path d="M46 34h8v3h-8M44 47h12v2H44" stroke="var(--bg)" strokeWidth="2" />
      <path d="M21 87h58M14 91h72" stroke="currentColor" />
    </svg>
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
      onCancel={onClose}
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
