import manifest from '../data/corpus-images.json' with { type: 'json' }

export type CorpusImageVariant = {
  src: string
  alt: string
  width: number
  height: number
  label: string
}

export type CorpusImage = {
  resource: string
  kind: 'image' | 'icon'
  src: string
  alt: string
  width: number
  height: number
  variants?: CorpusImageVariant[]
}

const referencePrefix = '#corpus-image/'
const resources = new Map<string, CorpusImage>()
const urls = new Map<string, CorpusImage>()

for (const image of manifest.images as CorpusImage[]) {
  resources.set(image.resource, image)
  urls.set(image.src, { ...image, variants: undefined })
  for (const variant of image.variants || [])
    urls.set(variant.src, { ...image, ...variant, variants: undefined })
}

export function corpusImageForResource(resource: string): CorpusImage | undefined {
  return resources.get(resource.trim())
}

export function corpusImageReference(resource: string): string {
  const image = corpusImageForResource(resource)
  return image
    ? `${referencePrefix}${encodeURIComponent(image.resource)}`
    : '#corpus-image-unavailable'
}

/** Neither corpus text nor model output can turn arbitrary URLs into image requests. */
export function corpusImageForUrl(url?: string): CorpusImage | undefined {
  if (!url) return undefined
  if (!url.startsWith(referencePrefix)) return urls.get(url)
  try {
    return resources.get(decodeURIComponent(url.slice(referencePrefix.length)))
  } catch {
    return undefined
  }
}
