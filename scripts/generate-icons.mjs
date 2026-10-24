// Resize the complete original emblem without redrawing or cropping the wordmark.
import { chromium } from '@playwright/test'
import { writeFile, readFile } from 'node:fs/promises'

const original = await readFile(new URL('../static/branding/rhodes-island.png', import.meta.url))
const imageUrl = `data:image/png;base64,${original.toString('base64')}`
function brandSvg(size, { maskable = false, rounded = false } = {}) {
  // Keep the maskable foreground inside the central 80% safe circle.
  const width = maskable ? 56 : 94
  const inset = (100 - width) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><rect width="100" height="100"${rounded ? ' rx="21"' : ''} fill="#111315"/><image href="${imageUrl}" x="${inset}" y="${inset}" width="${width}" height="${width}"/></svg>`
}

const browser = await chromium.launch({ channel: 'msedge', headless: false })
try {
  const page = await browser.newPage({ viewport: { width: 620, height: 620 } })
  await page.setContent(
    '<title>PRTS Icon Studio</title><body style="margin:0;background:#111719;display:grid;place-items:center;height:100vh"><canvas></canvas></body>',
  )
  const assets = [
    ['rhodes-island-192.png', 192, false],
    ['rhodes-island-512.png', 512, false],
    ['rhodes-island-maskable-512.png', 512, true],
    ['rhodes-island-apple-180.png', 180, false],
  ]
  for (const [file, size, maskable] of assets) {
    const svg = brandSvg(size, { maskable })
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
  await writeFile(
    new URL('../static/rhodes-island.svg', import.meta.url),
    brandSvg(64, { rounded: true }) + '\n',
  )
  console.log('Generated app icons from the complete original Rhodes Island emblem.')
} finally {
  await browser.close()
}
