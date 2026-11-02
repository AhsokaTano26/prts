/** The original silent frames retain the reference's slice motion and registration marks. */
export default function EndfieldBootVisual() {
  return (
    <div className="endfield-boot-visual" aria-hidden="true">
      <div className="endfield-boot-backdrop">
        <div className="endfield-boot-grid" />
        <svg
          className="endfield-boot-contours"
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
          fill="none"
        >
          <g>
            {[0, 26, 52, 78, 104, 130].map((offset) => (
              <path
                key={offset}
                transform={`translate(${-offset} ${offset * 0.7})`}
                d="M-160 560 80 320 250 320 385 185 585 185 675 95 940 95 1060-25"
              />
            ))}
            {[0, 26, 52, 78, 104].map((offset) => (
              <path
                key={offset}
                transform={`translate(${offset} ${-offset * 0.7})`}
                d="M550 940 740 750 995 750 1120 625 1310 625 1510 425"
              />
            ))}
          </g>
          <g className="endfield-boot-survey">
            <path d="M164 220h16m-8-8v16M1252 240h16m-8-8v16M246 690h16m-8-8v16M1158 720h16m-8-8v16" />
            <path d="M48 164V48h116M1276 48h116v116M48 736v116h116M1276 852h116V736" />
          </g>
        </svg>
        <div className="endfield-boot-scan" />
        <div className="endfield-boot-margin endfield-boot-margin--top mono">
          <span>
            <i />
            ENDFIELD INDUSTRIES
          </span>
          <span>FIELD TERMINAL / 01</span>
        </div>
        <div className="endfield-boot-margin endfield-boot-margin--bottom mono">
          <span>
            TALOS-II <b>／</b> PRTS
          </span>
          <span className="endfield-boot-bars" />
        </div>
      </div>
      <video
        className="endfield-boot-film"
        src="/branding/endfield-opening.mp4"
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
      />
    </div>
  )
}
