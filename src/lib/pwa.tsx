import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
type PwaState = {
  installed: boolean
  standalone: boolean
  canInstall: boolean
  supported: boolean
  online: boolean
  ios: boolean
  updateReady: boolean
  checking: boolean
  error: string
  notice: string
  install: () => Promise<void>
  checkUpdate: () => Promise<void>
  applyUpdate: () => void
}
const Context = createContext<PwaState | null>(null)

export function usePwa() {
  const value = useContext(Context)
  if (!value) throw new Error('PWA provider is not mounted')
  return value
}

export default function PwaProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  )
  const [online, setOnline] = useState(navigator.onLine)
  const [standalone, setStandalone] = useState(installed)
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const reloadAfterUpdate = useRef(false)
  const supported = window.isSecureContext && 'serviceWorker' in navigator
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)')
    const onDisplay = () => {
      const active =
        display.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
      setStandalone(active)
      if (active) setInstalled(true)
    }
    const onInstallPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPrompt)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPrompt(null)
      setNotice('PRTS 已添加到应用列表。')
    }
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    display.addEventListener('change', onDisplay)
    window.addEventListener('beforeinstallprompt', onInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      display.removeEventListener('change', onDisplay)
      window.removeEventListener('beforeinstallprompt', onInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])
  useEffect(() => {
    document.documentElement.dataset.standalone = String(standalone)
  }, [standalone])

  useEffect(() => {
    if (!supported || !import.meta.env.PROD) return
    let disposed = false
    let activeRegistration: ServiceWorkerRegistration | null = null
    let lastCheck = 0
    const cleanup: Array<() => void> = []
    function observe(worker: ServiceWorker) {
      const onState = () => {
        if (worker.state === 'installed') {
          if (!disposed && navigator.serviceWorker.controller) setUpdateReady(true)
          worker.removeEventListener('statechange', onState)
        }
      }
      worker.addEventListener('statechange', onState)
      cleanup.push(() => worker.removeEventListener('statechange', onState))
      onState()
    }
    const register = async () => {
      try {
        const result = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        })
        if (disposed) return
        activeRegistration = result
        setRegistration(result)
        setUpdateReady(!!result.waiting && !!navigator.serviceWorker.controller)
        const onUpdate = () => {
          if (result.installing) observe(result.installing)
        }
        result.addEventListener('updatefound', onUpdate)
        cleanup.push(() => result.removeEventListener('updatefound', onUpdate))
        if (result.installing) observe(result.installing)
      } catch {
        if (!disposed) setError('离线页面尚未就绪；联网后可重新检查。')
      }
    }
    const onController = () => {
      if (reloadAfterUpdate.current) window.location.reload()
    }
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        Date.now() - lastCheck > 60_000
      ) {
        lastCheck = Date.now()
        void activeRegistration?.update().catch(() => {})
      }
    }
    if (document.readyState === 'complete') void register()
    else window.addEventListener('load', register, { once: true })
    navigator.serviceWorker.addEventListener('controllerchange', onController)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      window.removeEventListener('load', register)
      navigator.serviceWorker.removeEventListener('controllerchange', onController)
      document.removeEventListener('visibilitychange', onVisible)
      cleanup.forEach((remove) => remove())
    }
  }, [supported])

  async function install() {
    if (!prompt) return
    setError('')
    setNotice('')
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      setNotice(
        choice.outcome === 'accepted'
          ? '已提交安装，请按浏览器提示完成。'
          : '已取消安装，稍后仍可通过浏览器菜单添加。',
      )
    } catch {
      setError('无法唤起安装窗口，请使用浏览器菜单添加。')
    } finally {
      setPrompt(null)
    }
  }
  async function checkUpdate() {
    setError('')
    setNotice('')
    if (!registration) {
      setNotice('离线支持将在正式构建、联网访问后启用。')
      return
    }
    setChecking(true)
    try {
      await registration.update()
      if (registration.waiting) setUpdateReady(true)
      setNotice('已检查更新；新版本就绪后会显示提示。')
    } catch {
      setError('暂时无法检查更新，请联网后重试。')
    } finally {
      setChecking(false)
    }
  }
  function applyUpdate() {
    if (!registration?.waiting) return
    reloadAfterUpdate.current = true
    registration.waiting.postMessage({ type: 'PRTS_ACTIVATE_UPDATE' })
  }
  return (
    <Context.Provider
      value={{
        installed,
        standalone,
        canInstall: !!prompt,
        supported,
        online,
        ios,
        updateReady,
        checking,
        error,
        notice,
        install,
        checkUpdate,
        applyUpdate,
      }}
    >
      {children}
    </Context.Provider>
  )
}
