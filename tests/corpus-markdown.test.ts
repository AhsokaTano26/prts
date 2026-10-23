import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { remarkCorpusImages } from '../src/lib/corpusMarkdown.ts'

function parse(text: string) {
  const parser = unified().use(remarkParse).use(remarkCorpusImages)
  return parser.runSync(parser.parse(text))
}

test('unknown inline and block game image references become placeholders without dropping surrounding prose', () => {
  for (const source of [
    '<image>Reading/unknown_example</image>\n第一次天使战争的记录。',
    '前文 <image>Reading/unknown_example</image> 后文',
    '<image>\nReading/unknown_example\n</image>\n\n正文',
    '> <image>Reading/unknown_example</image>',
  ]) {
    const tree = JSON.stringify(parse(source))
    assert.doesNotMatch(tree, /Reading\/unknown_example|<image>/)
    assert.match(tree, /原文配图未收录/)
    if (source.includes('第一次')) assert.match(tree, /第一次天使战争的记录/)
    if (source.includes('前文')) {
      assert.match(tree, /前文/)
      assert.match(tree, /后文/)
    }
  }
})

test('verified paired and inline image resources resolve without changing prose or code examples', () => {
  const tree = JSON.stringify(
    parse(
      [
        '<image>Reading/document_aurora_intro</image>',
        '前文 <image="WalletIcon/item_domain_tundra_coupon" scale=2> 后文',
        '`<image="WalletIcon/item_domain_tundra_coupon" scale=2>`',
      ].join('\n\n'),
    ),
  )
  assert.match(tree, /#corpus-image\/Reading%2Fdocument_aurora_intro/)
  assert.match(tree, /#corpus-image\/WalletIcon%2Fitem_domain_tundra_coupon/)
  assert.match(tree, /前文/)
  assert.match(tree, /后文/)
  assert.match(tree, /"type":"inlineCode"/)
  assert.match(tree, /<image=\\"WalletIcon\/item_domain_tundra_coupon\\" scale=2>/)
})

test('literal code examples retain image tags and resource paths', () => {
  for (const source of [
    '`<image>Reading/example</image>`',
    '```xml\n<image>Reading/example</image>\n```',
  ]) {
    const tree = JSON.stringify(parse(source))
    assert.match(tree, /<image>Reading\/example<\/image>/)
    assert.doesNotMatch(tree, /原文配图未收录/)
  }
})

test('corpus Markdown keeps heading hierarchy, lists and emphasis', () => {
  const tree = parse('## 塔卫二\n\n### 定义与位置\n\n- 塔卫二是**天然卫星**。\n- 第二条。')
  assert.deepEqual(
    tree.children.map((node) => node.type),
    ['heading', 'heading', 'list'],
  )
  assert.match(JSON.stringify(tree), /"type":"strong"/)
})

test('multiline image blocks preserve following prose and Markdown without a blank separator', () => {
  const source = '<image>\nReading/example\n</image>\n正文不能丢失。\n## 标题\n- 第一条\n- 第二条'
  const markup = renderToStaticMarkup(
    createElement(ReactMarkdown, {
      children: source,
      skipHtml: true,
      remarkPlugins: [remarkCorpusImages],
      components: { img: () => createElement('span', null, '原文配图未收录') },
    }),
  )
  assert.match(markup, /原文配图未收录/)
  assert.match(markup, /正文不能丢失。/)
  assert.match(markup, /<h2>标题<\/h2>/)
  assert.match(markup, /<li>第一条<\/li>/)
  assert.match(markup, /<li>第二条<\/li>/)
  assert.doesNotMatch(markup, /Reading\/example|<image>/)
})
