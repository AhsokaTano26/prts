import { Play, Pause, RotateCcw, Settings2 } from 'lucide-react'
import { SectionTitle } from './UI'
import type { FocusTimer } from '../lib/useFocusTimer'
export default function FocusPanel({
  timer,
  onSettings,
}: {
  timer: FocusTimer
  onSettings: () => void
}) {
  return (
    <section className={`panel focus-panel ${timer.running ? 'is-running' : ''}`}>
      <SectionTitle title="专注协议" english="FOCUS PROTOCOL" />
      <button className="icon-button focus-settings" aria-label="设置专注时长" onClick={onSettings}>
        <Settings2 size={15} />
      </button>
      <div className="timer-display">
        <svg viewBox="0 0 210 122" aria-hidden="true">
          <path d="M16 112a89 89 0 1 1 178 0" pathLength="100" className="timer-track" />
          <path
            d="M16 112a89 89 0 1 1 178 0"
            pathLength="100"
            className="timer-progress"
            strokeDasharray={`${timer.progress * 100} 100`}
          />
        </svg>
        <div className="timer-digits mono">
          {String(Math.floor(timer.remaining / 60)).padStart(2, '0')}
          <span>:</span>
          {String(timer.remaining % 60).padStart(2, '0')}
        </div>
        <p>
          {timer.running
            ? '专注进行中 · 每一刻都有意义'
            : timer.remaining === 0
              ? '本轮专注完成，辛苦了。'
              : '屏蔽杂音，让思绪归位。'}
        </p>
      </div>
      <div className="focus-actions">
        <button className="button focus-start" onClick={timer.toggle}>
          {timer.running ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
          {timer.running ? '暂停专注' : timer.remaining === 0 ? '再来一轮' : '开始专注'}
        </button>
        <button className="icon-button focus-reset" onClick={timer.reset} aria-label="重置专注计时">
          <RotateCcw size={16} />
        </button>
      </div>
    </section>
  )
}
