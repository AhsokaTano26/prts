// The source's first sliced-title frames begin at ~0.45s. At the compact display
// size, give their defocus and vertical judder a small screen-space compensation.
// Keep the original film (including its per-slice trails) and the settled title intact.
const openingStart = 0.45
const openingEnd = 1.05

export function attachEndfieldOpeningMotion(film: HTMLVideoElement): () => void {
  const motion = film.animate(
    [
      { offset: 0, translate: '0px 0px', filter: 'blur(0px)' },
      { offset: 0.07, translate: '-1.4px -3.4px', filter: 'blur(1.1px)' },
      { offset: 0.14, translate: '1.1px 2.2px', filter: 'blur(0.3px)' },
      { offset: 0.22, translate: '-0.6px -2.6px', filter: 'blur(0.9px)' },
      { offset: 0.32, translate: '0.8px 1.8px', filter: 'blur(0.25px)' },
      { offset: 0.42, translate: '-0.4px -1.6px', filter: 'blur(0.6px)' },
      { offset: 0.56, translate: '0.3px 0.8px', filter: 'blur(0.15px)' },
      { offset: 0.7, translate: '0px -0.5px', filter: 'blur(0.2px)' },
      { offset: 1, translate: '0px 0px', filter: 'blur(0px)' },
    ].map((frame) => ({ ...frame, easing: 'steps(1, end)' })),
    { duration: (openingEnd - openingStart) * 1000 },
  )
  // A wall-clock CSS animation would run ahead during a cold load or a stall.
  motion.pause()
  const sync = () => {
    const time = film.currentTime
    motion.currentTime = (time - openingStart) * 1000
    const rate = time >= openingStart && time < openingEnd ? 1 : 1.5
    if (film.playbackRate !== rate) film.playbackRate = rate
  }
  sync()

  // Read the media clock without rerendering React or moving the backdrop.
  const videoFrames = typeof film.requestVideoFrameCallback === 'function'
  let frameId: number
  const onFrame = () => {
    sync()
    frameId = videoFrames ? film.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame)
  }
  onFrame()
  film.addEventListener('seeked', sync)
  film.addEventListener('timeupdate', sync)

  return () => {
    if (videoFrames) film.cancelVideoFrameCallback(frameId)
    else cancelAnimationFrame(frameId)
    film.removeEventListener('seeked', sync)
    film.removeEventListener('timeupdate', sync)
    motion.cancel()
  }
}
