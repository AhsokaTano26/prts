import { useState } from 'react'
import { ExternalLink, ImageOff } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { remarkCorpusImages } from '../lib/corpusMarkdown'
import { corpusImageForUrl } from '../lib/corpusImages'
import { sourceUrl } from '../lib/assistant'
import '../styles/corpus-markdown.css'

type CorpusAsset = NonNullable<ReturnType<typeof corpusImageForUrl>>
type CorpusDisplayImage = Pick<CorpusAsset, 'src' | 'alt' | 'width' | 'height'>
type ContentNode = { type: string; tagName?: string; children?: ContentNode[] }

function containsImage(node?: ContentNode): boolean {
  return Boolean(
    (node?.type === 'element' && node.tagName === 'img') || node?.children?.some(containsImage),
  )
}

function ImagePlaceholder({ failedImage, icon = false }: { failedImage?: string; icon?: boolean }) {
  return (
    <span
      className={`corpus-image-placeholder${icon ? ' corpus-image-placeholder--icon' : ''}`}
      role={failedImage ? 'status' : undefined}
    >
      <ImageOff size={15} aria-hidden="true" />
      <span>
        {failedImage ? `${icon ? '图标' : '图片'}加载失败：${failedImage}` : '原文配图未收录'}
      </span>
    </span>
  )
}

function CorpusImageContent({
  image,
  kind,
}: {
  image: CorpusDisplayImage
  kind: CorpusAsset['kind']
}) {
  const [failed, setFailed] = useState(false)
  const icon = kind === 'icon'
  if (failed) return <ImagePlaceholder failedImage={image.alt || '原文配图'} icon={icon} />

  return (
    <a
      className={`corpus-image-link${icon ? ' corpus-image-link--icon' : ''}`}
      href={image.src}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${image.alt}，在新标签页查看原图`}
      title={icon ? image.alt : undefined}
    >
      <img
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
      {!icon && (
        <span className="corpus-image-caption">
          <span>{image.alt}</span>
          <span className="corpus-image-action">
            查看原图
            <ExternalLink size={12} aria-hidden="true" />
          </span>
        </span>
      )}
    </a>
  )
}

function LocalCorpusImage({ image }: { image: CorpusAsset }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const variants = image.variants
  const current = variants?.[selectedIndex] || variants?.[0] || image

  return (
    <span className={`corpus-image${image.kind === 'icon' ? ' corpus-image--icon' : ''}`}>
      {variants && variants.length > 1 && (
        <span className="corpus-image-variants" role="group" aria-label={`${image.alt}图片版本`}>
          <span>图片版本</span>
          {variants.map((variant, index) => (
            <button
              type="button"
              key={variant.src}
              aria-pressed={current.src === variant.src}
              onClick={() => setSelectedIndex(index)}
            >
              {variant.label}
            </button>
          ))}
        </span>
      )}
      <CorpusImageContent key={current.src} image={current} kind={image.kind} />
    </span>
  )
}

const markdownComponents: Components = {
  // Only assets matched by the local manifest may create image requests.
  img: ({ src }) => {
    const image = corpusImageForUrl(typeof src === 'string' ? src : undefined)
    return image ? <LocalCorpusImage key={image.src} image={image} /> : <ImagePlaceholder />
  },
  a: ({ href, children, node }) => {
    // Local image renderers own their links, including Markdown linked images.
    if (containsImage(node)) return <span>{children}</span>
    const url = href ? sourceUrl(href) : undefined
    return url ? (
      <a href={url} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    )
  },
}

export default function CorpusMarkdown({ children }: { children: string }) {
  return (
    <div className="markdown-content corpus-markdown">
      <ReactMarkdown skipHtml remarkPlugins={[remarkCorpusImages]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
