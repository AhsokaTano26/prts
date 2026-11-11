import { HttpError } from './errors.mjs'
import {
  createPlace,
  validatePlace,
  normalizePlaceText,
  placeMatchesQuery,
  placeStatus,
  sortedVisits,
} from '../src/lib/places.ts'

const fieldsAllowed = [
  'name',
  'type',
  'desire',
  'country',
  'city',
  'district',
  'address',
  'tags',
  'note',
  'budget',
  'openingHours',
  'phone',
  'sourceUrl',
  'mapUrl',
  'coordinates',
]

export function createAssistantPlace(change, now) {
  const fields = change.fields ?? {}
  if (Object.keys(fields).some((key) => !fieldsAllowed.includes(key)))
    throw new HttpError(400, '包含不支持的地点字段；不能指定 ID、时间戳、到访记录或地图配置。')
  if (
    fields.coordinates &&
    typeof fields.coordinates === 'object' &&
    Object.keys(fields.coordinates).some((key) => !['lng', 'lat'].includes(key))
  )
    throw new HttpError(400, '地点坐标仅支持 lng 与 lat。')
  const stamp = new Date(now).toISOString()
  try {
    return validatePlace(
      createPlace({
        ...fields,
        id: change.id,
        createdAt: stamp,
        updatedAt: stamp,
        visits: [],
        wantAgain: false,
      }),
    )
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : '地点资料无效。')
  }
}

/** Identity is deliberately stricter than the UI's non-blocking duplicate hint. */
export function sameAssistantPlace(candidate, existing) {
  if (candidate.mapUrl && existing.mapUrl) {
    try {
      return new URL(candidate.mapUrl).href === new URL(existing.mapUrl).href
    } catch {
      /* Place validation rejects malformed links before writes. */
    }
  }
  if (
    candidate.district &&
    existing.district &&
    normalizePlaceText(candidate.district) !== normalizePlaceText(existing.district)
  )
    return false
  if (
    candidate.coordinates &&
    existing.coordinates &&
    (candidate.coordinates.lng !== existing.coordinates.lng ||
      candidate.coordinates.lat !== existing.coordinates.lat)
  )
    return false
  return ['name', 'country', 'city', 'address'].every(
    (field) =>
      normalizePlaceText(candidate[field] || '') === normalizePlaceText(existing[field] || ''),
  )
}

export function placeMetadata(place) {
  return {
    id: place.id,
    name: place.name,
    type: place.type,
    desire: place.desire,
    country: place.country,
    city: place.city,
    district: place.district,
    address: place.address,
    status: placeStatus(place),
    visitCount: place.visits.length,
    hasCoordinates: Boolean(place.coordinates),
  }
}

export function searchPlaces(places, query) {
  return places
    .filter((place) => placeMatchesQuery(place, query))
    .map((place) => ({
      kind: 'place',
      ...placeMetadata(place),
      tags: place.tags,
      ...(place.note ? { excerpt: place.note.slice(0, 600) } : {}),
    }))
}

/** Explicit reads page long notes and bound history independently. */
export function readPlace(place, offset, limit) {
  const { visits, note, ...metadata } = place
  return {
    ...metadata,
    note: note.slice(offset, offset + limit),
    totalCharacters: note.length,
    offset,
    hasMore: offset + limit < note.length,
    visitCount: visits.length,
    visits: sortedVisits(place)
      .slice(0, 5)
      .map((visit) => ({
        ...visit,
        note: visit.note.length > 200 ? `${visit.note.slice(0, 200)}…` : visit.note,
      })),
    truncatedVisits: visits.length > 5,
  }
}
