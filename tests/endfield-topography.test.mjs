import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateTopographicSvg } from '../static/branding/endfield-topography.js'

test('topography is reproducible for a seed and different seeds change the terrain', () => {
  const first = generateTopographicSvg(12345, { width: 640, height: 640 })
  assert.deepEqual(generateTopographicSvg(12345, { width: 640, height: 640 }), first)
  assert.notEqual(generateTopographicSvg(54321, { width: 640, height: 640 }).svg, first.svg)
  assert.ok(first.contourCount > 20)
  assert.match(first.svg, /Q[\d.-]+,[\d.-]+/)
  assert.match(first.svg, /Z/)
  assert.doesNotMatch(first.svg, /NaN|Infinity|<script|href=/)
})

test('viewport inputs are bounded and invalid dimensions cannot produce invalid SVG', () => {
  const minimal = generateTopographicSvg(-1, { width: -50, height: 0 })
  assert.equal(minimal.width, 320)
  assert.equal(minimal.height, 480)
  assert.equal(minimal.seed, 4294967295)
  const invalid = generateTopographicSvg(NaN, { width: Infinity, height: '<script>' })
  assert.equal(invalid.width, 1440)
  assert.equal(invalid.height, 1000)
  assert.match(invalid.svg, /viewBox="0 0 1440 1000"/)
  assert.doesNotMatch(invalid.svg, /NaN|Infinity|<script/)
})
