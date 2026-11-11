import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_MAP_CONFIG,
  mapSdkUrl,
  parseMapConfig,
  validateMapConfig,
  mapCoordinates,
  parseSearchPois,
} from '../src/lib/placeMaps.ts'

test('old preferences receive independent map defaults without a browser key', () => {
  const first = parseMapConfig(undefined)
  const second = parseMapConfig(undefined)
  assert.deepEqual(first, DEFAULT_MAP_CONFIG)
  first.center.lng = 0
  assert.notEqual(second.center.lng, 0)
  assert.equal(second.apiKey, '')
})

test('map configuration round-trips a trimmed key and finite supported viewport', () => {
  const value = {
    apiKey: ` ${'a'.repeat(32)} `,
    center: { lng: 0, lat: 0 },
    zoom: 18,
    layer: 'satellite',
  }
  assert.deepEqual(validateMapConfig(value), { ...value, apiKey: 'a'.repeat(32) })
})

test('invalid map settings reject rather than sending credentials to arbitrary URLs', () => {
  for (const value of [
    null,
    [],
    { ...DEFAULT_MAP_CONFIG, apiKey: 'https://example.com/key' },
    { ...DEFAULT_MAP_CONFIG, apiKey: '<script>alert(1)</script>' },
    { ...DEFAULT_MAP_CONFIG, apiKey: 123 },
    { ...DEFAULT_MAP_CONFIG, center: { lng: 181, lat: 0 } },
    { ...DEFAULT_MAP_CONFIG, center: { lng: 0, lat: 90 } },
    { ...DEFAULT_MAP_CONFIG, center: { lng: NaN, lat: 0 } },
    { ...DEFAULT_MAP_CONFIG, zoom: 1.5 },
    { ...DEFAULT_MAP_CONFIG, zoom: 0 },
    { ...DEFAULT_MAP_CONFIG, zoom: 19 },
    { ...DEFAULT_MAP_CONFIG, layer: 'custom' },
  ])
    assert.throws(() => validateMapConfig(value), /地图/)
})

test('SDK URL is the official HTTPS service with an explicit version and key', () => {
  const url = new URL(mapSdkUrl('a'.repeat(32)))
  assert.equal(url.origin, 'https://api.tianditu.gov.cn')
  assert.equal(url.pathname, '/api')
  assert.equal(url.searchParams.get('v'), '4.0')
  assert.equal(url.searchParams.get('tk'), 'a'.repeat(32))
  assert.throws(() => mapSdkUrl(''), /密钥/)
  assert.throws(() => mapSdkUrl('x&callback=alert'), /密钥/)
})

test('map coordinates preserve zero but omit unsupported polar and malformed points', () => {
  assert.deepEqual(mapCoordinates({ lng: 0, lat: 0 }), { lng: 0, lat: 0 })
  assert.equal(mapCoordinates({ lng: 0, lat: 86 }), undefined)
  assert.equal(mapCoordinates({ lng: Infinity, lat: 20 }), undefined)
  assert.equal(mapCoordinates({ lng: '116', lat: '39' }), undefined)
  assert.equal(mapCoordinates(undefined), undefined)
})

test('official search POIs are plain bounded text and valid WGS84 coordinates', () => {
  const result = parseSearchPois([
    { name: '<b>书店</b>', address: '示例路', lonlat: '116.4,39.9' },
    { name: '零点', lonlat: '0,0' },
    { name: '坏坐标', lonlat: '200,99' },
    { name: '无位置' },
  ])
  assert.deepEqual(result, [
    { name: '<b>书店</b>', address: '示例路', coordinates: { lng: 116.4, lat: 39.9 } },
    { name: '零点', address: '', coordinates: { lng: 0, lat: 0 } },
  ])
  assert.equal(parseSearchPois(null).length, 0)
  assert.equal(
    parseSearchPois(Array.from({ length: 30 }, () => ({ name: '地点', lonlat: '0,0' }))).length,
    10,
  )
})
