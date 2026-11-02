import { ArrowUpRight } from 'lucide-react'
import type { PortraitId } from '../lib/appearance'
import CharacterPortrait from './CharacterPortrait'
import EndfieldSchematic from './EndfieldSchematic'

export default function EndfieldHero({
  portrait,
  onResources,
  onAppearance,
}: {
  portrait: PortraitId
  onResources: () => void
  onAppearance: () => void
}) {
  return (
    <section className="endfield-hero" aria-label="终末地工业工作台">
      <div className="endfield-hero-copy">
        <p className="mono">
          ENDFIELD INDUSTRIES <span>/ 01</span>
        </p>
        <h2>
          BUILD
          <br />
          <mark>YOUR DAY.</mark>
        </h2>
        <div className="endfield-hero-caption">
          <p>开拓前路，从此刻开始。</p>
          <button onClick={onAppearance}>
            自定义外观 <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
      <EndfieldSchematic />
      <CharacterPortrait portrait={portrait} onResources={onResources} />
      <div className="endfield-hero-footer mono">
        <span>
          <i />
          个人工作台
        </span>
        <span>PLAN / BUILD / ADVANCE</span>
      </div>
    </section>
  )
}
