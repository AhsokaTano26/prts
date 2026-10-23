import { useRef, useState, type FormEvent } from 'react'
import { Save, Download, Upload, RefreshCw, ShieldCheck, ExternalLink, Check } from 'lucide-react'
import type { Workspace, Settings } from '../lib/workspace'
import { validateWorkspace } from '../lib/workspace'
import { Modal, SectionTitle } from './UI'
import type { ApiHealth } from './AssistantView'
import CorpusSettings from './CorpusSettings'
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
    [pendingImport, setPendingImport] = useState<Workspace | null>(null),
    [refreshing, setRefreshing] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
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
    if (!file) return
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('备份文件不能超过 10 MB。')
      setPendingImport(validateWorkspace(JSON.parse(await file.text())))
    } catch (e) {
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
          <p>让终端适应你的工作方式。</p>
        </div>
        <span className="version-tag mono">PRTS BUILD 1.0</span>
      </div>
      <div className="settings-grid">
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
              <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
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
        <section className="panel settings-section">
          <SectionTitle title="AI 服务连接" english="AI CONNECTION" />
          <div className={`api-state ${health.configured ? 'connected' : ''}`}>
            <span className="status-led" />
            <div>
              <strong>
                {health.configured
                  ? 'AI 服务已配置'
                  : health.reachable
                    ? '等待配置 AI 服务'
                    : 'AI 服务未启动'}
              </strong>
              <p>
                {health.configured
                  ? `${health.provider} · ${health.model}`
                  : '本地指令模式随时可用'}
              </p>
            </div>
            <button
              className="icon-button"
              disabled={refreshing}
              aria-label="刷新 AI 连接状态"
              onClick={async () => {
                setRefreshing(true)
                await onRefresh()
                setRefreshing(false)
              }}
            >
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
            </button>
          </div>
          <p className="settings-copy">
            在项目根目录创建 <code>.env</code>，填入你的服务密钥并重启服务，即可开始 AI 对话。
          </p>
          <div className="config-example mono">
            <div>
              OPENAI_API_KEY=<span>你的服务密钥</span>
            </div>
            <div>
              OPENAI_MODEL=<span>gpt-4.1-mini</span>
            </div>
            <div>
              OPENAI_BASE_URL=<span>https://api.openai.com/v1</span>
            </div>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={18} />
            <p>
              密钥仅存于服务端。AI 接收当前对话、所选性格与相关语料，任务、笔记和文件不会自动上传。
            </p>
          </div>
          <a
            className="text-button"
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noreferrer"
          >
            管理 OpenAI API 密钥
            <ExternalLink size={13} />
          </a>
        </section>
        <CorpusSettings />
        <section className="panel settings-section data-section">
          <SectionTitle title="数据与备份" english="DATA MANAGEMENT" />
          <div className="data-backup-content">
            <div>
              <h3>你的工作，留在你手中。</h3>
              <p>任务、笔记和设置保存在当前浏览器。导出一份备份，换一台设备也能继续。</p>
              <span className="data-count mono">
                {workspace.tasks.length} TASKS · {workspace.notes.length} NOTES · LOCAL STORAGE
              </span>
            </div>
            <div className="backup-actions">
              <button className="button button-ghost" onClick={backup}>
                <Download size={16} />
                导出备份
              </button>
              <button className="button button-ghost" onClick={() => fileInput.current?.click()}>
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
            <Check size={13} />
            备份包含任务、笔记、偏好与活动记录。文件库中的文件请单独下载。
          </p>
        </section>
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
          <p className="field-hint">文件库和当前会话中的对话记录不受影响。</p>
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
