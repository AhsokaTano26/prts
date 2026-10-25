import { useId } from 'react'

/** Decorative research instrument: original geometry, not a game asset. */
export default function RhineInstrument({ compact = false }: { compact?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <div
      className={`rhine-instrument${compact ? ' rhine-instrument--compact' : ''}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 440 340" fill="none">
        <defs>
          <linearGradient
            id={`${id}-metal`}
            x1="80"
            y1="30"
            x2="350"
            y2="280"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#fff" />
            <stop offset=".45" stopColor="#c9d2c9" />
            <stop offset=".7" stopColor="#f6f8f4" />
            <stop offset="1" stopColor="#a9b8ad" />
          </linearGradient>
        </defs>
        <g className="rhine-instrument-grid" stroke="currentColor" opacity=".2">
          <path
            d="M25 40h390M25 170h390M25 300h390M90 20v300M220 20v300M350 20v300"
            strokeDasharray="2 6"
          />
          <path d="M25 65V40h25m340 0h25v25m0 210v25h-25m-340 0H25v-25" />
        </g>
        <g className="rhine-instrument-rings">
          <circle cx="220" cy="170" r="125" stroke={`url(#${id}-metal)`} strokeWidth="18" />
          <circle cx="220" cy="170" r="135" stroke="currentColor" strokeOpacity=".3" />
          <circle cx="220" cy="170" r="113" stroke="currentColor" strokeOpacity=".35" />
          <circle
            className="rhine-instrument-orbit"
            cx="220"
            cy="170"
            r="124"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeDasharray="105 674"
            transform="rotate(-90 220 170)"
          />
          <circle
            cx="220"
            cy="170"
            r="91"
            stroke="currentColor"
            strokeOpacity=".35"
            strokeDasharray="1 7"
          />
          <circle
            className="rhine-instrument-counter"
            cx="220"
            cy="170"
            r="78"
            stroke="currentColor"
            strokeWidth="10"
            strokeOpacity=".12"
            strokeDasharray="105 18 68 18 105 176"
          />
          <circle
            cx="220"
            cy="170"
            r="52"
            fill="var(--surface)"
            stroke="currentColor"
            strokeOpacity=".25"
          />
          <path d="M204 170h32m-16-16v32" stroke="var(--accent)" strokeWidth="2" />
          <path d="M220 24v18m0 256v18M74 170h18m256 0h18" stroke="currentColor" strokeWidth="2" />
          <circle cx="220" cy="45" r="5" fill="var(--accent)" />
        </g>
        <g className="rhine-instrument-probe" stroke="var(--accent)">
          <path d="M83 170h274" strokeOpacity=".5" />
          <path d="M83 164v12m274-12v12" />
        </g>
        <g fill="currentColor" fontFamily="monospace" fontSize="8" letterSpacing="1">
          <text x="25" y="27">
            RL / OPTICAL ARRAY
          </text>
          <text x="310" y="322">
            RESEARCH MODULE
          </text>
          <text x="29" y="184">
            X
          </text>
          <text x="224" y="24">
            Y
          </text>
        </g>
      </svg>
    </div>
  )
}
