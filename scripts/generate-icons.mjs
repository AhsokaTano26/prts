// Resize complete original emblems without redrawing or cropping their wordmarks.
import { chromium } from '@playwright/test'
import { writeFile, readFile } from 'node:fs/promises'

const brands = {
  rhodes: {
    name: 'Rhodes Island',
    original: 'rhodes-island.png',
    background: '#111315',
    tint: null,
    favicon: 'rhodes-island.svg',
    icons: [
      ['rhodes-island-192.png', 192, false],
      ['rhodes-island-512.png', 512, false],
      ['rhodes-island-maskable-512.png', 512, true],
      ['rhodes-island-apple-180.png', 180, false],
    ],
  },
  rhine: {
    name: 'Rhine Lab',
    original: 'rhine-lab.png',
    background: '#f0f2ed',
    tint: '#173c31',
    favicon: null,
    icons: [
      ['rhine-lab-192.png', 192, false],
      ['rhine-lab-512.png', 512, false],
      ['rhine-lab-maskable-512.png', 512, true],
      ['rhine-lab-180.png', 180, false],
    ],
  },
}
const args = process.argv.slice(2)
const theme =
  args.length === 0 ? 'rhodes' : args.length === 2 && args[0] === '--theme' ? args[1] : null
if (!['rhodes', 'rhine', 'all'].includes(theme)) {
  console.error('Usage: node scripts/generate-icons.mjs [--theme rhodes|rhine|all]')
  process.exit(1)
}

function brandSvg(size, brand, imageUrl, { maskable = false, rounded = false } = {}) {
  // Keep the maskable foreground inside the central 80% safe circle.
  const width = maskable ? 56 : 94
  const inset = (100 - width) / 2
  const filter = brand.tint
    ? `<defs><filter id="emblem-tint" color-interpolation-filters="sRGB"><feFlood flood-color="${brand.tint}"/><feComposite in2="SourceAlpha" operator="in"/></filter></defs>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${filter}<rect width="100" height="100"${rounded ? ' rx="21"' : ''} fill="${brand.background}"/><image href="${imageUrl}" x="${inset}" y="${inset}" width="${width}" height="${width}"${brand.tint ? ' filter="url(#emblem-tint)"' : ''}/></svg>`
}

const browser = await chromium.launch({ channel: 'msedge', headless: false })
try {
  const page = await browser.newPage({ viewport: { width: 620, height: 620 } })
  await page.setContent(
    '<title>PRTS Icon Studio</title><body style="margin:0;background:#111719;display:grid;place-items:center;height:100vh"><canvas></canvas></body>',
  )
  for (const name of theme === 'all' ? Object.keys(brands) : [theme]) {
    const brand = brands[name]
    const original = await readFile(
      new URL(`../static/branding/${brand.original}`, import.meta.url),
    )
    const imageUrl = `data:image/png;base64,${original.toString('base64')}`
    for (const [file, size, maskable] of brand.icons) {
      const svg = brandSvg(size, brand, imageUrl, { maskable })
      const data = await page.evaluate(
        async ({ svg, size }) => {
          const image = new Image()
          image.src = `data:image/svg+xml;base64,${btoa(svg)}`
          await image.decode()
          const canvas = document.querySelector('canvas')
          canvas.width = size
          canvas.height = size
          canvas.getContext('2d').drawImage(image, 0, 0, size, size)
          return canvas.toDataURL('image/png').split(',')[1]
        },
        { svg, size },
      )
      await writeFile(
        new URL(`../static/icons/${file}`, import.meta.url),
        Buffer.from(data, 'base64'),
      )
    }
    if (brand.favicon)
      await writeFile(
        new URL(`../static/${brand.favicon}`, import.meta.url),
        brandSvg(64, brand, imageUrl, { rounded: true }) + '\n',
      )
    console.log(`Generated app icons from the complete original ${brand.name} emblem.`)
  }
} finally {
  await browser.close()
}
