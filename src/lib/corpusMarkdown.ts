import { corpusImageForResource, corpusImageReference } from './corpusImages.ts'

type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
  url?: string
  alt?: string
}

const imageStart = /^<image\s*>$/i
const imageEnd = /^<\/image\s*>$/i
const leadingImage = /^\s*<image\s*>([^<>]*)<\/image\s*>/i
const inlineImage = /<image=(?:"([^"<>]+)"|'([^'<>]+)')(?:\s+[^<>]*)?>/gi
const picture = (resource: string): MarkdownNode => ({
  type: 'image',
  url: corpusImageReference(resource),
  alt: corpusImageForResource(resource)?.alt || '原文配图未收录',
})

/** The corpus contains game resource identifiers, not image files or usable URLs.
 * Match only the verified local asset manifest; code examples stay intact.
 */
export function remarkCorpusImages(this: { parse(value: string): MarkdownNode }) {
  const parser = this
  return function transform(tree: MarkdownNode) {
    function visit(parent: MarkdownNode) {
      if (!parent.children) return
      const children: MarkdownNode[] = []
      for (let index = 0; index < parent.children.length; index += 1) {
        const node = parent.children[index]
        const image = node.type === 'html' && leadingImage.exec(node.value || '')
        if (image) {
          const isBlock =
            parent.type === 'root' || parent.type === 'blockquote' || parent.type === 'listItem'
          const imageNode = picture(image[1])
          children.push(isBlock ? { type: 'paragraph', children: [imageNode] } : imageNode)
          // A multiline HTML block may also contain prose after its closing tag.
          // Parse that suffix again instead of letting skipHtml discard it.
          const suffix = (node.value || '').slice(image[0].length)
          if (suffix.trim()) {
            if (isBlock) {
              const remainder = parser.parse(suffix)
              visit(remainder)
              children.push(...(remainder.children || []))
            } else {
              children.push({ type: 'text', value: suffix })
            }
          }
          continue
        }
        if (node.type === 'html' && imageStart.test(node.value || '')) {
          let end = index + 1
          while (parent.children[end]?.type === 'text') end += 1
          if (
            parent.children[end]?.type === 'html' &&
            imageEnd.test(parent.children[end].value || '')
          ) {
            const resource = parent.children
              .slice(index + 1, end)
              .map((child) => child.value || '')
              .join('')
            children.push(picture(resource))
            index = end
            continue
          }
        }
        if (node.type === 'text' && node.value) {
          let offset = 0
          for (const match of node.value.matchAll(inlineImage)) {
            if (match.index > offset)
              children.push({ type: 'text', value: node.value.slice(offset, match.index) })
            children.push(picture(match[1] || match[2]))
            offset = match.index + match[0].length
          }
          if (offset) {
            if (offset < node.value.length)
              children.push({ type: 'text', value: node.value.slice(offset) })
            continue
          }
        }
        visit(node)
        children.push(node)
      }
      parent.children = children
    }
    visit(tree)
  }
}
