/** Decorative assembly drawing shared by the Endfield home, login and startup. */
export default function EndfieldSchematic() {
  return (
    <svg className="endfield-schematic" viewBox="0 0 480 280" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1">
        <path d="M24 32h432v216H24zM24 64h432M24 216h432M56 32v216M424 32v216" opacity=".2" />
        <path d="M0 140h480M240 0v280" strokeDasharray="3 7" opacity=".3" />
        <path d="m140 102 100-54 100 54v88l-100 54-100-54z" />
        <path
          d="m140 102 100 54 100-54M240 156v88M140 146l100 54 100-54M190 75l100 54v88M290 75l-100 54v88"
          opacity=".5"
        />
        <path d="M72 116h40v48H72zM368 116h40v48h-40zM112 140h28M340 140h28M92 116V80h48M388 164v36h-48" />
        <path d="M18 44V26h24M438 26h24v18M462 236v18h-24M42 254H18v-18" strokeWidth="2" />
      </g>
      <path
        className="endfield-schematic-core"
        d="m240 97 54 29-54 29-54-29z"
        fill="var(--endfield-yellow)"
        stroke="currentColor"
      />
      <g fill="currentColor">
        <path d="M234 10h12v3h-12zM234 267h12v3h-12zM8 134h3v12H8zM469 134h3v12h-3z" />
        <circle cx="92" cy="140" r="4" />
        <circle cx="388" cy="140" r="4" />
      </g>
    </svg>
  )
}
