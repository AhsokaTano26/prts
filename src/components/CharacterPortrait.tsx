import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import type { PortraitId } from '../lib/appearance'
import { portraits } from '../lib/portraits'

export default function CharacterPortrait({
  portrait,
  onResources,
}: {
  portrait: PortraitId
  onResources: () => void
}) {
  // A new selection gets a fresh image/error state, even after the previous image failed.
  return <Portrait key={portrait} portrait={portrait} onResources={onResources} />
}

function Portrait({ portrait, onResources }: { portrait: PortraitId; onResources: () => void }) {
  const [missing, setMissing] = useState(false)
  const character = portraits[portrait]
  return (
    <figure
      className={`amiya-visual${missing ? ' amiya-visual--empty' : ''}`}
      data-portrait={portrait}
    >
      {missing ? (
        <div className="amiya-empty">
          <ImageOff size={30} aria-hidden="true" />
          <strong>{character.name}立绘尚未就绪</strong>
          <p>可在系统设置下载或更新图片资源。</p>
          <button className="button button-ghost" onClick={onResources}>
            前往资源管理
          </button>
        </div>
      ) : (
        <img
          className="amiya-portrait"
          src={character.src}
          alt={`《明日方舟》${character.name}游戏立绘`}
          width={character.size}
          height={character.size}
          loading="eager"
          decoding="async"
          draggable={false}
          onError={() => setMissing(true)}
        />
      )}
      <figcaption className="amiya-caption">
        <strong>{character.name}</strong>
        <span className="mono">{character.english} / PERSONAL ASSISTANT</span>
      </figcaption>
    </figure>
  )
}
