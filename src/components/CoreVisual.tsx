import { useAppearance } from '../lib/appearance'
import RhineInstrument from './RhineInstrument'

export default function CoreVisual() {
  const { theme } = useAppearance()
  if (theme === 'rhine') return <RhineInstrument />
  const top = [200, 30],
    bottom = [200, 290]
  const ring = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6
    return [200 + Math.cos(a) * 112, 160 + Math.sin(a) * 37]
  })
  return (
    <div className="core-visual" aria-hidden="true">
      <svg viewBox="0 0 400 320">
        <defs>
          <radialGradient id="coreGlow">
            <stop offset="0" stopColor="#cbd2d9" stopOpacity=".1" />
            <stop offset="1" stopColor="#cbd2d9" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="200" cy="160" r="150" fill="url(#coreGlow)" />
        <g className="core-orbit" fill="none" stroke="currentColor">
          <circle cx="200" cy="160" r="138" strokeOpacity=".22" strokeWidth=".7" />
          <circle cx="200" cy="160" r="119" strokeOpacity=".13" strokeDasharray="2 7" />
          <path
            d="M35 160h330M200 8v304M85 45l230 230M85 275 315 45"
            strokeOpacity=".16"
            strokeWidth=".7"
          />
          <path d="M62 153v14m276-14v14M193 22h14m-14 276h14" strokeOpacity=".8" />
        </g>
        <g className="core-crystal" stroke="currentColor" fill="none" strokeWidth=".7">
          {ring.map((p, i) => (
            <g key={i}>
              <path d={`M${top}L${p}L${bottom}`} opacity={i % 2 ? '.42' : '.75'} />
              <line
                x1={p[0]}
                y1={p[1]}
                x2={ring[(i + 5) % 12][0]}
                y2={ring[(i + 5) % 12][1]}
                opacity=".35"
              />
              <line x1={p[0]} y1={p[1]} x2="200" y2="160" opacity=".4" />
            </g>
          ))}
          <polygon points={ring.map((p) => p.join(',')).join(' ')} opacity=".7" />
          <path d="M200 30v260M88 160l112-78 112 78-112 78Z" opacity=".5" />
          <path d="m200 62 78 98-78 98-78-98Z" opacity=".22" />
        </g>
        <circle cx="200" cy="160" r="3" fill="var(--accent)" />
        <g fill="currentColor">
          {[
            [62, 22],
            [338, 22],
            [62, 298],
            [338, 298],
            [35, 160],
            [365, 160],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="1.5" />
          ))}
        </g>
        <text x="354" y="151" fill="currentColor" opacity=".4" fontSize="6" fontFamily="monospace">
          X.01
        </text>
      </svg>
      <span className="core-coordinate mono">NEURAL LINK — STABLE</span>
    </div>
  )
}
