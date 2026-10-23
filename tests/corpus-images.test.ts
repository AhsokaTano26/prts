import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  corpusImageForResource,
  corpusImageForUrl,
  corpusImageReference,
} from '../src/lib/corpusImages.ts'
import manifest from '../src/data/corpus-images.json' with { type: 'json' }
import sources from '../server/image-sources.json' with { type: 'json' }
import { imageFile, verifyImage } from '../scripts/sync-corpus-images.mjs'

test('verified images use exact allowlisted resources and same-origin files', () => {
  const image = corpusImageForResource('Reading/document_aurora_intro')!
  assert.equal(image.alt, '塔卫二的极光')
  assert.equal(image.width, 1024)
  assert.equal(image.height, 576)
  assert.equal(corpusImageForUrl(corpusImageReference(image.resource)), image)
  assert.equal(corpusImageForUrl(image.src)?.src, image.src)
  for (const url of [
    'https://example.com/image.png',
    '//example.com/image.png',
    '/api/auth/status',
    '/assets/corpus-images/../../.env',
    `${image.src}?redirect=https://example.com`,
    '#corpus-image/%E0%A4%A',
  ])
    assert.equal(corpusImageForUrl(url), undefined)
  assert.equal(corpusImageForResource('Reading/nonexistent'), undefined)
})

test('gender-specific resources retain both original variants and inline icons stay identifiable', () => {
  const image = corpusImageForResource('fm//Reading/reading_sm2l3m5_madina')!
  assert.deepEqual(
    image.variants?.map((variant) => variant.label),
    ['女管理员', '男管理员'],
  )
  assert.notEqual(image.variants?.[0].src, image.variants?.[1].src)
  for (const variant of image.variants || [])
    assert.equal(corpusImageForUrl(variant.src)?.alt, variant.alt)
  assert.equal(corpusImageForResource('WalletIcon/item_domain_tundra_coupon')?.kind, 'icon')
  assert.ok(corpusImageForResource('Reading/document_SamitheFeranmut_intro'))
})

test('every published local asset matches the pinned source blob, PNG dimensions and SHA-256', async () => {
  const bySrc = new Map(
    manifest.images
      .flatMap((entry) => [entry, ...('variants' in entry ? entry.variants : [])])
      .map((image) => [image.src, image]),
  )
  for (const asset of sources.assets) {
    const file = imageFile(asset)
    const buffer = await readFile(
      new URL(`../public/assets/corpus-images/${file}`, import.meta.url),
    )
    const verified = verifyImage(buffer, asset)
    const image = bySrc.get(`/assets/corpus-images/${file}`)!
    assert.ok(image, asset.id)
    assert.equal(image.width, verified.width, asset.id)
    assert.equal(image.height, verified.height, asset.id)
    assert.equal(image.sha256, verified.sha256, asset.id)
  }
})

test('image sync refuses path traversal and corrupt or mismatched downloads', async () => {
  assert.throws(() =>
    imageFile({ path: 'assets/beyond/dynamicassets/gameplay/ui/sprites/../.env' }),
  )
  const asset = sources.assets[0]
  const buffer = await readFile(
    new URL(`../public/assets/corpus-images/${imageFile(asset)}`, import.meta.url),
  )
  assert.throws(() => verifyImage(buffer.subarray(1), asset), /Invalid PNG/)
  const corrupt = Buffer.from(buffer)
  corrupt[corrupt.length - 1] ^= 1
  assert.throws(() => verifyImage(corrupt, asset), /integrity mismatch/)
})
