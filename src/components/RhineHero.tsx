import { ArrowUpRight, ScanLine } from 'lucide-react'
import type { PortraitId } from '../lib/appearance'
import CharacterPortrait from './CharacterPortrait'

export default function RhineHero({
  portrait,
  onResources,
  onAppearance,
}: {
  portrait: PortraitId
  onResources: () => void
  onAppearance: () => void
}) {
  return (
    <section className="rhine-hero" aria-label="莱茵生命科研终端">
      <div className="rhine-hero-top mono">
        <span>
          <i /> RHINE LAB
        </span>
        <span>PERSONAL RESEARCH / 001</span>
      </div>
      <div className="rhine-hero-copy">
        <p className="mono">
          SYNTHESIZE INFORMATION
          <br />
          ANALYSIS OS
        </p>
        <h2>
          EXPLORE
          <br />
          <span>BEYOND.</span>
        </h2>
        <div className="rhine-hero-caption">
          <span>探索不止，思考不息。</span>
          <p>从一个想法开始，抵达新的可能。</p>
        </div>
        <button className="rhine-hero-customize" onClick={onAppearance}>
          自定义工作台 <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="rhine-hero-science" aria-hidden="true">
        <div className="rhine-hero-orbit" />
        <div className="rhine-hero-orbit rhine-hero-orbit--inner" />
        <span className="rhine-hero-axis" />
        <span className="rhine-hero-measure mono">OBSERVATION FIELD / R.L.</span>
      </div>
      <CharacterPortrait portrait={portrait} onResources={onResources} />
      <div className="rhine-hero-bottom">
        <span className="mono">RESEARCH IS A JOURNEY.</span>
        <span>
          <ScanLine size={14} /> 个人终端已连接
        </span>
      </div>
    </section>
  )
}
