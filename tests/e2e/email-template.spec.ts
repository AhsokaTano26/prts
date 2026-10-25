import { test, expect } from './fixture'
import { renderReminderEmail } from '../../server/notification-email.mjs'
import { portraits } from '../../src/lib/portraits'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

for (const theme of ['rhodes', 'rhine']) {
  for (const width of [800, 390]) {
    test(`${theme} HTML reminder remains readable at ${width}px`, async ({ page }) => {
      const title = '准备项目汇报 <设计稿> & 附件：' + '需要仔细核对的任务内容'.repeat(6)
      const now = Date.parse('2026-10-26T02:00:00Z')
      const { html } = renderReminderEmail(
        { title, dueAt: now + 86400_000, offsetMinutes: 1440 },
        { now, timeZone: 'Asia/Shanghai', theme },
      )
      await page.setViewportSize({ width, height: 950 })
      await page.setContent(html)
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
      await expect(
        page.getByText('2026/10/27 10:00 (Asia/Shanghai)', { exact: true }),
      ).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      await expect(page.locator('img, script, iframe')).toHaveCount(0)
      await page.screenshot({ path: `/tmp/prts-email-${theme}-${width}.png`, fullPage: true })
    })
  }
}

for (const [theme, id] of [
  ['rhodes', 'amiya'],
  ['rhine', 'priestess'],
  ['rhine', 'kaltsit'],
] as const) {
  for (const width of [800, 390]) {
    test(`${theme} reminder uses ${id} as a watermark at ${width}px`, async ({ page }) => {
      const metadata = portraits[id]
      const content = process.env.PRTS_VISUAL_ASSETS
        ? await readFile(path.join(process.env.PRTS_VISUAL_ASSETS, `${id}.png`))
        : Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
            'base64',
          )
      const now = Date.parse('2026-10-26T02:00:00Z')
      const title =
        width > 500
          ? '完成本周项目复盘'
          : '核对项目复盘与附件：' + '需要仔细核对的任务内容'.repeat(4)
      const mail = renderReminderEmail(
        { title, dueAt: now + 86400_000, offsetMinutes: 1440 },
        {
          now,
          timeZone: 'Asia/Shanghai',
          theme,
          portrait: {
            id,
            name: metadata.name,
            english: metadata.english,
            content,
            cid: `portrait-${id}@prts.local`,
          },
        },
      )
      // Browsers display the same MIME image bytes via a data URL for visual QA.
      let html = mail.html
      for (const attachment of mail.attachments)
        html = html.replaceAll(
          `cid:${attachment.cid}`,
          `data:${attachment.contentType};base64,${attachment.content.toString('base64')}`,
        )
      await page.setViewportSize({ width, height: 1000 })
      await page.setContent(html)
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
      await expect(page.locator('img')).toHaveCount(0)
      const background = await page
        .locator('.mail-watermark')
        .evaluate((element) => getComputedStyle(element).backgroundImage)
      expect(background).toContain('data:image/png;base64,')
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      await expect(
        page.getByText('2026/10/27 10:00 (Asia/Shanghai)', { exact: true }),
      ).toBeVisible()
      await page.screenshot({
        path: `/tmp/prts-email-portrait-${theme}-${id}-${width}.png`,
        fullPage: true,
      })
    })
  }
}
