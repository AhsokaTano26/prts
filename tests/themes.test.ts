import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTheme } from '../src/lib/themes.ts'

test('Endfield and existing theme selections survive parsing while unsupported input falls back', () => {
  for (const theme of ['rhodes', 'rhine', 'endfield']) assert.equal(parseTheme(theme), theme)
  for (const value of [undefined, null, {}, [], 'unknown', '/external.css'])
    assert.equal(parseTheme(value), 'rhodes')
})
