/** Original procedural topography. No map data, external service or stored preferences. */
const TAU = Math.PI * 2
const INTERVAL = 0.016

function hash(x, y, seed) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return (value ^ (value >>> 16)) >>> 0
}

function random(seed) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function gradient(code, x, y) {
  switch (code & 7) {
    case 0:
      return x
    case 1:
      return -x
    case 2:
      return y
    case 3:
      return -y
    case 4:
      return (x + y) * Math.SQRT1_2
    case 5:
      return (x - y) * Math.SQRT1_2
    case 6:
      return (-x + y) * Math.SQRT1_2
    default:
      return (-x - y) * Math.SQRT1_2
  }
}

const fade = (value) => value * value * value * (value * (value * 6 - 15) + 10)
const mix = (a, b, t) => a + (b - a) * t
function noise(x, y, seed) {
  const column = Math.floor(x),
    row = Math.floor(y)
  const dx = x - column,
    dy = y - row,
    u = fade(dx),
    v = fade(dy)
  return mix(
    mix(
      gradient(hash(column, row, seed), dx, dy),
      gradient(hash(column + 1, row, seed), dx - 1, dy),
      u,
    ),
    mix(
      gradient(hash(column, row + 1, seed), dx, dy - 1),
      gradient(hash(column + 1, row + 1, seed), dx - 1, dy - 1),
      u,
    ),
    v,
  )
}

function terrain(seed) {
  const next = random(seed)
  const angle = next() * TAU,
    cosine = Math.cos(angle),
    sine = Math.sin(angle)
  const scaleX = 230 + next() * 100,
    scaleY = 240 + next() * 130
  const offsetX = next() * 700,
    offsetY = next() * 700
  return (px, py) => {
    const x = (px * cosine - py * sine) / scaleX + offsetX
    const y = (px * sine + py * cosine) / scaleY + offsetY
    const warpedX = x + noise(x * 0.72 + 13, y * 0.72 - 7, seed ^ 0xa341316c) * 0.85
    const warpedY = y + noise(x * 0.72 - 31, y * 0.72 + 19, seed ^ 0xc8013ea4) * 0.85
    let height = 0,
      amplitude = 1,
      total = 0,
      frequency = 1
    for (let octave = 0; octave < 4; octave++) {
      height += noise(warpedX * frequency, warpedY * frequency, seed + octave * 1013) * amplitude
      total += amplitude
      amplitude *= 0.46
      frequency *= 1.97
    }
    return height / total
  }
}

function simplify(points) {
  if (points.length < 4) return points
  const kept = new Uint8Array(points.length)
  kept[0] = kept[points.length - 1] = 1
  const pending = [[0, points.length - 1]]
  while (pending.length) {
    const [from, to] = pending.pop(),
      a = points[from],
      b = points[to]
    const dx = b.x - a.x,
      dy = b.y - a.y,
      squared = dx * dx + dy * dy
    let maximum = 0.3,
      furthest = -1
    for (let index = from + 1; index < to; index++) {
      const p = points[index]
      const t = squared
        ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared))
        : 0
      const distance = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2
      if (distance > maximum) {
        maximum = distance
        furthest = index
      }
    }
    if (furthest !== -1) {
      kept[furthest] = 1
      pending.push([from, furthest], [furthest, to])
    }
  }
  return points.filter((_, index) => kept[index])
}

const coordinate = (point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
function pathFor(raw, closed) {
  const points = simplify(raw)
  if (closed) points.pop()
  if (points.length < 3) return ''
  const output = []
  if (closed) {
    output.push('M' + coordinate(midpoint(points.at(-1), points[0])))
    for (let index = 0; index < points.length; index++)
      output.push(
        'Q' +
          coordinate(points[index]) +
          ' ' +
          coordinate(midpoint(points[index], points[(index + 1) % points.length])),
      )
    output.push('Z')
  } else {
    output.push('M' + coordinate(points[0]), 'L' + coordinate(midpoint(points[0], points[1])))
    for (let index = 1; index < points.length - 1; index++)
      output.push(
        'Q' +
          coordinate(points[index]) +
          ' ' +
          coordinate(midpoint(points[index], points[index + 1])),
      )
    output.push('L' + coordinate(points.at(-1)))
  }
  return output.join(' ')
}

function dimension(value, fallback, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.round(value)))
    : fallback
}

/** A seed can be retained by callers to reproduce the same decorative terrain. */
export function generateTopographicSvg(seed, options = {}) {
  const width = dimension(options.width, 1440, 320, 2560)
  const height = dimension(options.height, 1000, 480, 1600)
  const normalizedSeed = typeof seed === 'number' && Number.isFinite(seed) ? seed >>> 0 : 1
  const step = Math.max(7, Math.sqrt((width * height) / 26000))
  const columns = Math.ceil(width / step),
    rows = Math.ceil(height / step)
  const stride = columns + 1,
    dx = width / columns,
    dy = height / rows
  const sample = terrain(normalizedSeed)
  const values = new Float64Array(stride * (rows + 1))
  for (let y = 0; y <= rows; y++)
    for (let x = 0; x <= columns; x++) values[y * stride + x] = sample(x * dx, y * dy)
  const levels = new Map(),
    verticalStart = columns * (rows + 1)
  // Only inspect the levels intersecting each cell, rather than rescanning every level.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const z = [
        values[y * stride + x],
        values[y * stride + x + 1],
        values[(y + 1) * stride + x + 1],
        values[(y + 1) * stride + x],
      ]
      const corners = [
        { x: x * dx, y: y * dy },
        { x: (x + 1) * dx, y: y * dy },
        { x: (x + 1) * dx, y: (y + 1) * dy },
        { x: x * dx, y: (y + 1) * dy },
      ]
      const ids = [
        y * columns + x,
        verticalStart + y * stride + x + 1,
        (y + 1) * columns + x,
        verticalStart + y * stride + x,
      ]
      const first = Math.ceil(Math.min(...z) / INTERVAL),
        last = Math.floor(Math.max(...z) / INTERVAL)
      for (let index = first; index <= last; index++) {
        const level = index * INTERVAL,
          hits = []
        let nodes = levels.get(index)
        if (!nodes) levels.set(index, (nodes = new Map()))
        for (let edge = 0; edge < 4; edge++) {
          const other = (edge + 1) % 4
          if (z[edge] >= level === z[other] >= level) continue
          const t = (level - z[edge]) / (z[other] - z[edge]),
            a = corners[edge],
            b = corners[other]
          if (!nodes.has(ids[edge]))
            nodes.set(ids[edge], { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), links: [] })
          hits.push(edge)
        }
        const pairs =
          hits.length === 2
            ? [hits]
            : hits.length === 4
              ? z[0] >= level === (z[0] + z[1] + z[2] + z[3]) / 4 >= level
                ? [
                    [0, 1],
                    [2, 3],
                  ]
                : [
                    [0, 3],
                    [1, 2],
                  ]
              : []
        for (const [a, b] of pairs) {
          nodes.get(ids[a]).links.push(ids[b])
          nodes.get(ids[b]).links.push(ids[a])
        }
      }
    }
  }
  const groups = [[], []]
  let contourCount = 0
  for (const [index, nodes] of levels) {
    const visited = new Set()
    const starts = [...nodes]
      .filter(([, point]) => point.links.length === 1)
      .map(([id]) => id)
      .concat([...nodes.keys()])
    for (const start of starts) {
      if (visited.has(start)) continue
      const points = []
      let current = start,
        previous = -1,
        closed = false
      while (current !== undefined && !visited.has(current)) {
        visited.add(current)
        const point = nodes.get(current)
        points.push(point)
        const next = point.links.find((id) => id !== previous)
        previous = current
        current = next
        if (current === start) {
          closed = true
          points.push(nodes.get(start))
          break
        }
      }
      const path = pathFor(points, closed)
      if (path) {
        groups[index % 5 === 0 ? 1 : 0].push(path)
        contourCount++
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none"><g stroke="#5d6255" stroke-width=".65" stroke-opacity=".18" stroke-linecap="round" stroke-linejoin="round">${groups[0].map((path) => `<path d="${path}"/>`).join('')}</g><g stroke="#5d6255" stroke-width=".95" stroke-opacity=".28" stroke-linecap="round" stroke-linejoin="round">${groups[1].map((path) => `<path d="${path}"/>`).join('')}</g></svg>`
  return { svg, width, height, seed: normalizedSeed, contourCount }
}

/** Rebuild only on page entry, theme entry or a debounced viewport change. */
export function installEndfieldTopography(window, document) {
  const root = document.documentElement
  let activeUrl = '',
    pendingUrl = '',
    frame = 0,
    routeFrame = 0,
    timer = 0,
    revision = 0,
    lastSeed = -1
  let route = window.location.hash.split('?')[0]
  let viewportWidth = window.innerWidth
  let disposed = false
  function clear() {
    revision++
    window.cancelAnimationFrame(frame)
    window.clearTimeout(timer)
    if (pendingUrl) window.URL.revokeObjectURL(pendingUrl)
    if (activeUrl) window.URL.revokeObjectURL(activeUrl)
    activeUrl = pendingUrl = ''
    root.style.removeProperty('--endfield-topography')
    delete root.dataset.topographySeed
    delete root.dataset.topographyContours
  }
  function refresh() {
    window.cancelAnimationFrame(frame)
    if (disposed || root.dataset.theme !== 'endfield') return
    frame = window.requestAnimationFrame(() => {
      const currentRevision = ++revision
      let seed = window.crypto?.getRandomValues
        ? window.crypto.getRandomValues(new Uint32Array(1))[0]
        : (Math.random() * 4294967296) >>> 0
      if (seed === lastSeed) seed = (seed + 0x9e3779b9) >>> 0
      lastSeed = seed
      const generated = generateTopographicSvg(seed, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      if (pendingUrl) window.URL.revokeObjectURL(pendingUrl)
      const url = window.URL.createObjectURL(new Blob([generated.svg], { type: 'image/svg+xml' }))
      pendingUrl = url
      const image = new window.Image()
      image.onload = () => {
        if (disposed || currentRevision !== revision || root.dataset.theme !== 'endfield') {
          window.URL.revokeObjectURL(url)
          return
        }
        const previous = activeUrl
        activeUrl = url
        pendingUrl = ''
        root.style.setProperty('--endfield-topography', `url("${url}")`)
        root.dataset.topographySeed = String(seed)
        root.dataset.topographyContours = String(generated.contourCount)
        if (previous) window.URL.revokeObjectURL(previous)
      }
      image.onerror = () => {
        if (pendingUrl === url) pendingUrl = ''
        window.URL.revokeObjectURL(url)
      }
      image.src = url
    })
  }
  const observer = new window.MutationObserver(() =>
    root.dataset.theme === 'endfield' ? refresh() : clear(),
  )
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  const onHash = () => {
    window.cancelAnimationFrame(routeFrame)
    // Navigation guards may restore the previous hash later in this event.
    routeFrame = window.requestAnimationFrame(() => {
      const next = window.location.hash.split('?')[0]
      if (next !== route) {
        route = next
        refresh()
      }
    })
  }
  const onResize = () => {
    if (window.innerWidth === viewportWidth) return
    viewportWidth = window.innerWidth
    window.clearTimeout(timer)
    timer = window.setTimeout(refresh, 160)
  }
  const onShow = (event) => {
    if (event.persisted) refresh()
  }
  window.addEventListener('hashchange', onHash)
  window.addEventListener('resize', onResize)
  window.addEventListener('pageshow', onShow)
  refresh()
  return () => {
    disposed = true
    observer.disconnect()
    window.cancelAnimationFrame(routeFrame)
    clear()
    window.removeEventListener('hashchange', onHash)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('pageshow', onShow)
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined')
  installEndfieldTopography(window, document)
