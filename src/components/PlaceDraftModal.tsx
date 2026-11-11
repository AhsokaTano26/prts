import { PrtsButton } from './PrtsFormControls'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from './UI'
import { registerNavigationGuard } from '../lib/navigationGuard'
const CloseContext = createContext<(() => void) | null>(null)

export function PlaceCancelButton({ disabled }: { disabled?: boolean }) {
  const close = useContext(CloseContext)
  return (
    <PrtsButton
      type="button"
      className="button button-ghost"
      disabled={disabled}
      onClick={() => close?.()}
    >
      取消
    </PrtsButton>
  )
}

export default function PlaceDraftModal({
  title,
  dirty,
  busy,
  onClose,
  children,
}: {
  title: string
  dirty: boolean
  busy: boolean
  onClose: () => void
  children: ReactNode
}) {
  const [discard, setDiscard] = useState(false)
  const pendingHash = useRef<string | null>(null)
  const bypass = useRef(false)
  const requestClose = () => {
    if (!busy) dirty ? setDiscard(true) : onClose()
  }
  useEffect(() => {
    const original = location.hash
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const unregister = registerNavigationGuard((nextHash) => {
      if (bypass.current || (!dirty && !busy) || nextHash === original) return true
      pendingHash.current = nextHash
      history.replaceState(null, '', original || location.pathname)
      if (!busy) setDiscard(true)
      return false
    })
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      unregister()
    }
  }, [dirty, busy])
  return (
    <Modal title={title} className="place-editor" onClose={requestClose}>
      {discard && (
        <div className="place-discard" role="alert">
          <p>还有未保存的修改，是否放弃？</p>
          <div className="place-action-row">
            <PrtsButton
              type="button"
              className="button button-ghost"
              onClick={() => {
                setDiscard(false)
                pendingHash.current = null
              }}
            >
              继续编辑
            </PrtsButton>
            <PrtsButton
              type="button"
              className="button danger"
              onClick={() => {
                bypass.current = true
                onClose()
                if (pendingHash.current !== null) location.hash = pendingHash.current
              }}
            >
              放弃修改
            </PrtsButton>
          </div>
        </div>
      )}
      <CloseContext.Provider value={requestClose}>{children}</CloseContext.Provider>
    </Modal>
  )
}
