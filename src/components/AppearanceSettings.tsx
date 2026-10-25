import { useEffect, useState, type FormEvent } from 'react'
import { Check, ImageOff, Save } from 'lucide-react'
import { type AppearancePreferences, type PortraitId, type ThemeId } from '../lib/appearance'
import { portraits } from '../lib/portraits'
import { useServerStore } from '../lib/serverStore'
import { SectionTitle } from './UI'
import '../styles/appearance-settings.css'

const themes: { id: ThemeId; name: string; english: string; detail: string }[] = [
  {
    id: 'rhodes',
    name: '明日方舟：罗德岛',
    english: 'RHODES ISLAND',
    detail: '黑橙终端 · 几何扫描 · 战术工作台',
  },
  {
    id: 'rhine',
    name: '明日方舟：莱茵生命',
    english: 'RHINE LAB',
    detail: '白绿科研 · 环形校准 · 分析工作台',
  },
]

function PortraitPreview({ id, active }: { id: PortraitId; active: boolean }) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    if (active) setMissing(false)
  }, [active])
  return (
    <div className="portrait-choice-image" data-portrait={id}>
      {missing ? (
        <span className="portrait-choice-empty">
          <ImageOff size={25} />
          <span>等待下载</span>
        </span>
      ) : (
        <img src={portraits[id].src} alt="" draggable={false} onError={() => setMissing(true)} />
      )}
      <span className="portrait-choice-code mono">{portraits[id].english}</span>
    </div>
  )
}

export default function AppearanceSettings({ active }: { active: boolean }) {
  const store = useServerStore()
  const preferences = store.documents.preferences.value
  const [draft, setDraft] = useState<AppearancePreferences>(preferences.appearance)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!dirty) setDraft(preferences.appearance)
  }, [preferences.appearance, dirty])
  function change(value: Partial<AppearancePreferences>) {
    setDraft((previous) => ({ ...previous, ...value }))
    setDirty(true)
    setNotice('')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setNotice('')
    try {
      const saved = await store.save('preferences', { ...preferences, appearance: draft })
      if (saved) {
        setDirty(false)
        setNotice('外观已保存，主题与首页立绘已更新。')
      } else setNotice('外观尚未保存，请按页面提示重试。')
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="panel settings-section appearance-settings" aria-label="外观设置">
      <SectionTitle title="终端外观" english="VISUAL IDENTITY" />
      <form onSubmit={(event) => void save(event)}>
        <fieldset disabled={saving} className="appearance-fieldset">
          <legend>界面主题</legend>
          <p className="field-hint">
            为整个工作台选择一种视觉语言，包括登录、首页、各页面与启动动画。
          </p>
          <div className="theme-choices">
            {themes.map((theme) => (
              <label
                className={`theme-choice ${draft.theme === theme.id ? 'is-selected' : ''}`}
                key={theme.id}
              >
                <input
                  type="radio"
                  name="appearance-theme"
                  aria-label={theme.name}
                  value={theme.id}
                  checked={draft.theme === theme.id}
                  onChange={() => change({ theme: theme.id })}
                />
                <span
                  className={`theme-choice-preview theme-choice-preview--${theme.id}`}
                  aria-hidden="true"
                >
                  <span className="theme-preview-sidebar">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="theme-preview-body">
                    <strong>{theme.english}</strong>
                    <span className="theme-preview-orbit" />
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span className="appearance-choice-copy">
                  <strong>{theme.name}</strong>
                  <small>{theme.detail}</small>
                </span>
                <Check className="appearance-choice-check" size={17} aria-hidden="true" />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={saving} className="appearance-fieldset">
          <legend>首页立绘</legend>
          <p className="field-hint">
            角色与主题独立选择，不影响 AI 对话中选择的人格。普瑞赛斯为游戏正式名称。
          </p>
          <div className="portrait-choices">
            {(Object.keys(portraits) as PortraitId[]).map((id) => (
              <label
                className={`portrait-choice ${draft.portrait === id ? 'is-selected' : ''}`}
                key={id}
              >
                <input
                  type="radio"
                  name="appearance-portrait"
                  aria-label={portraits[id].name}
                  value={id}
                  checked={draft.portrait === id}
                  onChange={() => change({ portrait: id })}
                />
                <PortraitPreview id={id} active={active} />
                <span className="appearance-choice-copy">
                  <strong>{portraits[id].name}</strong>
                  <small className="mono">{portraits[id].english}</small>
                </span>
                <Check className="appearance-choice-check" size={17} aria-hidden="true" />
              </label>
            ))}
          </div>
          <p className="field-hint">
            首次部署需在{' '}
            <a className="appearance-resource-link" href="#settings/resources">
              资源管理
            </a>{' '}
            下载图片；已有资源请检查更新，以补齐新增立绘。
          </p>
        </fieldset>
        <div className="appearance-save-row">
          <span>{dirty ? '有尚未保存的外观选择' : '外观设置保存在此工作台'}</span>
          <button className="button button-primary" type="submit" disabled={saving}>
            <Save size={16} />
            {saving ? '正在保存…' : '保存外观'}
          </button>
        </div>
        {notice && (
          <p className="appearance-save-notice" role="status">
            {notice}
          </p>
        )}
      </form>
    </section>
  )
}
