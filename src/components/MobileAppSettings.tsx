import { useState } from 'react'
import { Smartphone, Download, RefreshCw, Share2 } from 'lucide-react'
import { usePwa } from '../lib/pwa'
import { useAppearance } from '../lib/appearance'
import { SectionTitle } from './UI'
import AppVersion from './AppVersion'

export default function MobileAppSettings() {
  const pwa = usePwa()
  const { theme } = useAppearance()
  const [showGuide, setShowGuide] = useState(false)
  return (
    <section className="panel settings-section mobile-app-settings" aria-label="手机桌面应用">
      <SectionTitle title="手机桌面应用" english="MOBILE APP" />
      <div className="pwa-app-identity">
        <img
          src={theme === 'rhine' ? '/icons/rhine-lab-192.png' : '/icons/rhodes-island-192.png'}
          alt="PRTS 应用图标"
        />
        <div>
          <strong>{theme === 'rhine' ? 'PRTS · 莱茵生命' : 'PRTS'}</strong>
          <p>
            {pwa.standalone
              ? '已在独立应用窗口中运行'
              : pwa.installed
                ? '已添加到设备，可从桌面图标打开'
                : '把你的终端，放到手机桌面。'}
          </p>
        </div>
        <Smartphone size={22} />
      </div>
      <p className="pwa-app-version">
        当前版本 <AppVersion />
      </p>
      <p className="settings-copy">
        从桌面图标打开，使用独立窗口访问同一份工作台。登录、任务与文件仍由你的服务器保存和验证。
      </p>
      {!pwa.supported && (
        <p className="pwa-feedback">
          手机安装需要通过 HTTPS 访问。当前页面仍可正常使用；部署后请打开你的 HTTPS 域名。
        </p>
      )}
      {pwa.installed ? (
        <p className="pwa-installed">桌面应用已就绪</p>
      ) : (
        <div className="pwa-actions">
          {pwa.canInstall && (
            <button className="button button-primary" onClick={() => void pwa.install()}>
              <Download size={15} />
              安装 PRTS
            </button>
          )}
          <button
            className="button button-ghost"
            aria-expanded={showGuide}
            onClick={() => setShowGuide((value) => !value)}
          >
            <Share2 size={15} />
            查看添加方法
          </button>
        </div>
      )}
      {showGuide && (
        <div className="pwa-install-guide">
          {pwa.ios ? (
            <>
              <strong>iPhone / iPad</strong>
              <ol>
                <li>用 Safari 打开此工作台。</li>
                <li>点按“分享”，选择“添加到主屏幕”。</li>
                <li>确认名称为 PRTS，再点“添加”。</li>
              </ol>
            </>
          ) : (
            <>
              <strong>添加到手机桌面</strong>
              <p>Android：打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。</p>
              <p>iPhone / iPad：用 Safari 打开，点按“分享” → “添加到主屏幕” → “添加”。</p>
            </>
          )}
          <p>浏览器若未提供安装选项，请确认正在使用 HTTPS 地址，并先正常访问一次。</p>
        </div>
      )}
      <div className="pwa-update-row">
        <div>
          <strong>{pwa.updateReady ? '新版本已就绪' : '应用更新'}</strong>
          <p>
            {pwa.updateReady
              ? '更新会刷新页面，请先确认编辑已保存。'
              : '联网打开时会检查新版本，更新前会提示。'}
          </p>
        </div>
        <button
          className="button button-ghost"
          disabled={pwa.checking || !pwa.online}
          onClick={() => (pwa.updateReady ? pwa.applyUpdate() : void pwa.checkUpdate())}
        >
          <RefreshCw size={15} />
          {pwa.updateReady ? '更新应用' : pwa.checking ? '正在检查…' : '检查更新'}
        </button>
      </div>
      {pwa.error && (
        <p role="alert" className="pwa-feedback error">
          {pwa.error}
        </p>
      )}
      {pwa.notice && (
        <p role="status" className="pwa-feedback">
          {pwa.notice}
        </p>
      )}
    </section>
  )
}

export function PwaNotices() {
  const pwa = usePwa()
  const [dismissed, setDismissed] = useState(false)
  if (!pwa.online)
    return (
      <div className="pwa-notice" role="status">
        网络已断开，连接恢复后可继续使用。
      </div>
    )
  if (!pwa.updateReady || dismissed) return null
  return (
    <div className="pwa-notice" role="status">
      <div>
        <strong>PRTS 有新版本</strong>
        <p>更新将刷新页面，请先确认改动已保存。</p>
      </div>
      <button className="button button-primary" onClick={pwa.applyUpdate}>
        更新应用
      </button>
      <button className="button button-ghost" onClick={() => setDismissed(true)}>
        稍后
      </button>
    </div>
  )
}
