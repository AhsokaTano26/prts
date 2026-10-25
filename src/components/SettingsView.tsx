import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  Save,
  Download,
  Upload,
  RefreshCw,
  Check,
  SlidersHorizontal,
  Sparkles,
  Bell,
  Library,
  ShieldCheck,
  Database,
  ChevronRight,
  Palette,
} from 'lucide-react'
import type { Workspace, Settings } from '../lib/workspace'
import { validateWorkspace } from '../lib/workspace'
import { Modal, SectionTitle } from './UI'
import type { ApiHealth } from './AssistantView'
import CorpusSettings from './CorpusSettings'
import AssetSettings from './AssetSettings'
import { AIConnectionSettings, PasswordSettings } from './RuntimeSettings'
import MobileAppSettings from './MobileAppSettings'
import NotificationSettings from './NotificationSettings'
import PasskeySettings from './PasskeySettings'
import AppearanceSettings from './AppearanceSettings'
import { transitionView } from '../lib/motion'
import '../styles/settings-navigation.css'

const categories = [
  {
    id: 'general',
    label: '常规偏好',
    english: 'GENERAL',
    detail: '代号、专注与桌面应用',
    description: '调整终端称呼、专注习惯与桌面应用。',
    icon: SlidersHorizontal,
  },
  {
    id: 'appearance',
    label: '外观主题',
    english: 'APPEARANCE',
    detail: '界面主题与首页立绘',
    description: '选择终端的视觉语言，以及与你相伴的首页角色。',
    icon: Palette,
  },
  {
    id: 'ai',
    label: 'AI 服务',
    english: 'AI CONNECTION',
    detail: '模型与服务连接',
    description: '管理模型连接，保存后对下一次对话生效。',
    icon: Sparkles,
  },
  {
    id: 'notifications',
    label: '任务通知',
    english: 'NOTIFICATIONS',
    detail: '提醒、Webhook 与邮件',
    description: '设置提醒时间，以及网页、Webhook 和邮件通知。',
    icon: Bell,
  },
  {
    id: 'resources',
    label: '资源管理',
    english: 'RESOURCES',
    detail: '游戏语料与图片',
    description: '下载和更新语料与图片，查看资源准备状态。',
    icon: Library,
  },
  {
    id: 'security',
    label: '账户安全',
    english: 'SECURITY',
    detail: '访问密码与 Passkey',
    description: '管理终端访问密码与设备通行密钥。',
    icon: ShieldCheck,
  },
  {
    id: 'data',
    label: '数据备份',
    english: 'DATA & BACKUP',
    detail: '工作台导入与导出',
    description: '导出工作台留存，或从已有备份恢复。',
    icon: Database,
  },
] as const
type Category = (typeof categories)[number]['id']
function readCategory(): Category {
  const id = location.hash.replace(/^#settings\/?/, '')
  return categories.find((category) => category.id === id)?.id || 'general'
}

export default function SettingsView({
  workspace,
  health,
  onSave,
  onImport,
  onNotify,
  onRefresh,
  motionEnabled,
  onMotionToggle,
  onReplay,
}: {
  workspace: Workspace
  health: ApiHealth
  onSave: (s: Settings) => void
  onImport: (w: Workspace) => void
  onNotify: (m: string) => void
  onRefresh: () => Promise<void>
  motionEnabled: boolean
  onMotionToggle: () => void
  onReplay: () => void
}) {
  const [name, setName] = useState(workspace.settings.name),
    [minutes, setMinutes] = useState(workspace.settings.focusMinutes),
    [sound, setSound] = useState(workspace.settings.sound),
    [pendingImport, setPendingImport] = useState<Workspace | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState(readCategory)
  const [visited, setVisited] = useState<Set<Category>>(() => new Set([readCategory()]))
  const activeCategory = useRef(category)
  const previousCategory = useRef(category)
  const importVersion = useRef(0)
  const navigation = useRef<HTMLElement>(null)
  const layout = useRef<HTMLDivElement>(null)
  const categoryHeading = useRef<HTMLHeadingElement>(null)
  const current = categories.find((item) => item.id === category)!

  useEffect(() => {
    const onHash = () => {
      if (location.hash !== '#settings' && !location.hash.startsWith('#settings/')) return
      const next = readCategory()
      if (next === activeCategory.current) return
      const direction =
        categories.findIndex((item) => item.id === next) -
        categories.findIndex((item) => item.id === activeCategory.current)
      activeCategory.current = next
      ++importVersion.current
      transitionView(
        () => {
          setPendingImport(null)
          setCategory(next)
          setVisited((previous) => new Set(previous).add(next))
        },
        { scope: 'settings', direction },
      )
    }
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      ++importVersion.current
    }
  }, [])

  useLayoutEffect(() => {
    if (previousCategory.current !== category) {
      previousCategory.current = category
      layout.current?.closest<HTMLElement>('.main-content')?.scrollTo({ top: 0 })
      if (!navigation.current?.contains(document.activeElement))
        categoryHeading.current?.focus({ preventScroll: true })
    }
    const nav = navigation.current
    const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !selected || nav.scrollWidth <= nav.clientWidth) return
    const viewport = nav.getBoundingClientRect()
    const link = selected.getBoundingClientRect()
    if (link.left < viewport.left) nav.scrollLeft -= viewport.left - link.left
    else if (link.right > viewport.right) nav.scrollLeft += link.right - viewport.right
  }, [category])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) onSave({ name: name.trim(), focusMinutes: minutes, sound })
  }
  function backup() {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a')
    a.href = url
    a.download = `prts-backup-${new Date().toLocaleDateString('en-CA')}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    onNotify('工作台备份已导出')
  }
  async function readImport(file?: File) {
    if (!file || activeCategory.current !== 'data') return
    const version = ++importVersion.current
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('备份文件不能超过 10 MB。')
      const data = JSON.parse(await file.text())
      if (version !== importVersion.current || activeCategory.current !== 'data') return
      setPendingImport(validateWorkspace(data?.workspace || data))
    } catch (e) {
      if (version === importVersion.current && activeCategory.current === 'data')
        onNotify(e instanceof Error ? e.message : '备份读取失败，请选择有效的 JSON 文件。')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }
  return (
    <div className="page-content settings-page">
      <div className="view-heading">
        <div>
          <div className="page-index mono">05 / SYSTEM PREFERENCES</div>
          <h1>
            系统设置<span className="heading-dot">.</span>
          </h1>
          <p>管理你的终端、连接与数据。</p>
        </div>
      </div>
      <div className="settings-layout" ref={layout}>
        <aside className="settings-navigation">
          <div className="settings-navigation-label">
            <span className="mono">CONFIGURATION</span>
            <span className="settings-mobile-hint">左右滑动切换</span>
          </div>
          <nav ref={navigation} className="settings-subnav" aria-label="设置分类">
            {categories.map((item, index) => {
              const Icon = item.icon
              return (
                <a
                  key={item.id}
                  href={`#settings/${item.id}`}
                  aria-label={item.label}
                  aria-current={category === item.id ? 'page' : undefined}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span className="settings-nav-copy">
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <span className="settings-nav-index mono" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <ChevronRight className="settings-nav-arrow" size={15} aria-hidden="true" />
                </a>
              )
            })}
          </nav>
          <p className="settings-navigation-note">
            选择分类，调整对应设置。
            <br />
            普通配置草稿会在切换时保留。
          </p>
        </aside>
        <div className="settings-category-content">
          <header className="settings-category-heading">
            <div>
              <p className="mono">{current.english}</p>
              <h2 tabIndex={-1} ref={categoryHeading}>
                {current.label}
              </h2>
              <span>{current.description}</span>
            </div>
            <span className="settings-category-number mono" aria-hidden="true">
              {String(categories.indexOf(current) + 1).padStart(2, '0')}{' '}
              <span>/ {String(categories.length).padStart(2, '0')}</span>
            </span>
          </header>
          <div className="settings-category-panel" hidden={category !== 'general'}>
            {visited.has('general') && (
              <>
                <section className="panel settings-section">
                  <SectionTitle title="个人偏好" english="PREFERENCES" />
                  <form onSubmit={submit}>
                    <label className="form-label" htmlFor="profile-name">
                      博士代号
                    </label>
                    <input
                      id="profile-name"
                      className="field"
                      value={name}
                      maxLength={40}
                      required
                      onChange={(e) => setName(e.target.value)}
                    />
                    <p className="field-hint">这个名字将显示在你的个人终端上。</p>
                    <label className="form-label" htmlFor="focus-minutes">
                      单轮专注时长
                    </label>
                    <div className="minutes-input">
                      <input
                        id="focus-minutes"
                        className="field"
                        type="number"
                        min="1"
                        max="180"
                        required
                        value={minutes}
                        onChange={(e) => setMinutes(Number(e.target.value))}
                      />
                      <span>分钟</span>
                    </div>
                    <p className="field-hint">可设置 1–180 分钟；新时长在当前专注结束后应用。</p>
                    <label className="switch-row">
                      <div>
                        <strong>专注结束提示音</strong>
                        <span>完成一轮专注时，播放轻柔的提示音</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={sound}
                        onChange={(e) => setSound(e.target.checked)}
                      />
                      <span className="switch" aria-hidden="true" />
                    </label>
                    <label className="switch-row">
                      <div>
                        <strong>终端动态效果</strong>
                        <span>启用页面切换、几何核心与状态动画</span>
                      </div>
                      <input type="checkbox" checked={motionEnabled} onChange={onMotionToggle} />
                      <span className="switch" aria-hidden="true" />
                    </label>
                    <div className="preference-actions">
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={onReplay}
                        disabled={!motionEnabled}
                      >
                        <RefreshCw size={15} />
                        重播启动动画
                      </button>
                      <button type="submit" className="button button-primary">
                        <Save size={15} />
                        保存偏好
                      </button>
                    </div>
                  </form>
                </section>
                <MobileAppSettings />
              </>
            )}
          </div>
          <div className="settings-category-panel" hidden={category !== 'ai'}>
            {visited.has('ai') && <AIConnectionSettings health={health} onRefresh={onRefresh} />}
          </div>
          <div className="settings-category-panel" hidden={category !== 'appearance'}>
            {visited.has('appearance') && <AppearanceSettings active={category === 'appearance'} />}
          </div>
          <div className="settings-category-panel" hidden={category !== 'notifications'}>
            {visited.has('notifications') && (
              <NotificationSettings active={category === 'notifications'} />
            )}
          </div>
          <div className="settings-category-panel" hidden={category !== 'resources'}>
            {category === 'resources' && (
              <>
                <CorpusSettings />
                <AssetSettings />
              </>
            )}
          </div>
          <div className="settings-category-panel" hidden={category !== 'security'}>
            {category === 'security' && (
              <>
                <PasswordSettings />
                <PasskeySettings />
              </>
            )}
          </div>
          <div className="settings-category-panel" hidden={category !== 'data'}>
            {category === 'data' && (
              <section className="panel settings-section data-section">
                <SectionTitle title="数据与备份" english="DATA MANAGEMENT" />
                <div className="data-backup-content">
                  <div>
                    <h3>你的工作，留在你手中。</h3>
                    <p>
                      任务、分类、笔记和设置保存在服务器
                      SQLite。登录同一终端即可在其他设备访问，也可导出工作台 JSON 备份。
                    </p>
                    <span className="data-count mono">
                      {workspace.tasks.length} TASKS · {workspace.notes.length} NOTES · SQLITE
                    </span>
                  </div>
                  <div className="backup-actions">
                    <button className="button button-ghost" onClick={backup}>
                      <Download size={16} />
                      导出备份
                    </button>
                    <button
                      className="button button-ghost"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Upload size={16} />
                      导入备份
                    </button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".json,application/json"
                      hidden
                      aria-label="导入工作台备份"
                      onChange={(e) => void readImport(e.target.files?.[0])}
                    />
                  </div>
                </div>
                <p className="backup-note">
                  <Check size={13} />此 JSON
                  包含任务、分类、笔记、工作台设置与活动记录，不含文件、聊天和助手偏好。完整数据库由服务器备份。
                </p>
              </section>
            )}
          </div>
        </div>
      </div>
      <p className="about-note mono">
        PRTS PERSONAL TERMINAL / A FAN-MADE WORKSPACE INSPIRED BY ARKNIGHTS.
        <br />
        让每一个想法，都有一个归处。
      </p>
      {pendingImport && (
        <Modal title="确认导入工作台备份" onClose={() => setPendingImport(null)}>
          <p className="modal-copy">
            备份包含 {pendingImport.tasks.length} 项任务、{pendingImport.notes.length}{' '}
            篇笔记。导入后将替换当前工作台数据。建议先导出当前备份。
          </p>
          <p className="field-hint">文件库和数据库中的对话记录不受影响。</p>
          <div className="modal-actions">
            <button className="button button-ghost" onClick={() => setPendingImport(null)}>
              取消
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                onImport(pendingImport)
                setName(pendingImport.settings.name)
                setMinutes(pendingImport.settings.focusMinutes)
                setSound(pendingImport.settings.sound)
                setPendingImport(null)
              }}
            >
              确认替换并导入
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
