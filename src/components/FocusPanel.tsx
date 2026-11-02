import { useEffect, useState } from 'react'
import { Play, Pause, RotateCcw, Square } from 'lucide-react'
import { SectionTitle } from './UI'
import type { FocusTimer } from '../lib/useFocusTimer'
import '../styles/focus-panel.css'

export default function FocusPanel({ timer }: { timer: FocusTimer }) {
  const [minutes, setMinutes] = useState(String(timer.minutes))
  useEffect(() => setMinutes(String(timer.minutes)), [timer.minutes])
  return (
    <section
      className={`panel focus-panel ${timer.running ? 'is-running' : ''}`}
      aria-label="专注计时"
    >
      <SectionTitle title="专注协议" english="FOCUS PROTOCOL" />
      <div className="segmented focus-modes" role="group" aria-label="计时模式">
        {(['countdown', 'countup'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={timer.mode === mode}
            disabled={timer.running || timer.busy}
            onClick={() => timer.setMode(mode)}
          >
            {mode === 'countdown' ? '倒计时' : '正计时'}
          </button>
        ))}
      </div>
      {timer.mode === 'countdown' && (
        <form
          className="focus-duration"
          onSubmit={(event) => {
            event.preventDefault()
            timer.setMinutes(Number(minutes))
          }}
        >
          <label htmlFor="overview-focus-minutes">本轮时长</label>
          <input
            id="overview-focus-minutes"
            type="number"
            min="1"
            max="180"
            step="1"
            required
            value={minutes}
            disabled={timer.running || timer.busy}
            onChange={(event) => setMinutes(event.target.value)}
          />
          <span>分钟</span>
          <button
            type="submit"
            disabled={timer.running || timer.busy || Number(minutes) === timer.minutes}
          >
            应用
          </button>
        </form>
      )}
      <p className="focus-mode-help">
        {timer.running
          ? '暂停后可修改时长或切换模式。'
          : timer.mode === 'countup'
            ? '从零开始累计，结束时记录一轮专注。'
            : '设置 1–180 分钟，应用后开始新的一轮。'}
      </p>
      <div className="timer-display">
        <svg viewBox="0 0 210 122" aria-hidden="true">
          <path d="M16 112a89 89 0 1 1 178 0" pathLength="100" className="timer-track" />
          {timer.mode === 'countdown' && (
            <path
              d="M16 112a89 89 0 1 1 178 0"
              pathLength="100"
              className="timer-progress"
              strokeDasharray={`${timer.progress * 100} 100`}
            />
          )}
        </svg>
        <div
          className={`timer-digits mono${timer.display.length > 5 ? ' timer-digits-long' : ''}`}
          role="timer"
          aria-label={timer.mode === 'countup' ? '已专注时间' : '剩余专注时间'}
        >
          {timer.display}
        </div>
        <p>
          {timer.completed
            ? '本轮专注完成，辛苦了。'
            : timer.running
              ? '专注进行中 · 每一刻都有意义'
              : timer.hasSession
                ? '计时已暂停，随时继续。'
                : '屏蔽杂音，让思绪归位。'}
        </p>
      </div>
      <div className="focus-actions">
        <button className="button focus-start" disabled={timer.busy} onClick={timer.toggle}>
          {timer.running ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
          {timer.running
            ? '暂停专注'
            : timer.completed
              ? '再来一轮'
              : timer.hasSession
                ? '继续专注'
                : '开始专注'}
        </button>
        {timer.mode === 'countup' && (
          <button
            className="icon-button focus-finish"
            disabled={timer.busy || timer.completed || timer.seconds < 1 || !timer.hasSession}
            onClick={() => void timer.finish()}
            aria-label="结束并记录本轮专注"
            title="结束并记录本轮专注"
          >
            <Square size={14} />
          </button>
        )}
        <button
          className="icon-button focus-reset"
          disabled={timer.busy}
          onClick={timer.reset}
          aria-label="重置专注计时"
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </section>
  )
}
