import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stepNumberValue } from '../src/lib/prtsNumber.ts'

test('number stepping clamps at bounds and starts an empty duration at its minimum', () => {
  assert.equal(stepNumberValue('', 1, { min: 1, max: 180 }), '1')
  assert.equal(stepNumberValue('180', 1, { min: 1, max: 180 }), '180')
  assert.equal(stepNumberValue('1', -1, { min: 1, max: 180 }), '1')
  assert.equal(stepNumberValue('25', 1, { min: 1, max: 180 }), '26')
  assert.equal(stepNumberValue('0', -1, { min: 0, max: 1440 }), '0')
})

test('decimal stepping stays aligned with the minimum and avoids floating point artifacts', () => {
  assert.equal(stepNumberValue('0.2', 1, { step: 0.1 }), '0.3')
  assert.equal(stepNumberValue('1.2', 1, { min: 0.1, step: 0.2 }), '1.3')
  assert.equal(stepNumberValue('1.2', -1, { min: 0.1, step: 0.2 }), '1.1')
  assert.equal(stepNumberValue('104.0665', 1, { min: -180, max: 180, step: 'any' }), '104.066501')
  assert.equal(stepNumberValue('-30.000001', 1, { step: '0.000001' }), '-30')
})
