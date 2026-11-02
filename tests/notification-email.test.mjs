import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadEmailPortrait, renderReminderEmail } from '../server/notification-email.mjs'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
  'base64',
)
async function directory(t) {
  const value = await mkdtemp(path.join(os.tmpdir(), 'prts-email-portrait-'))
  t.after(() => rm(value, { recursive: true, force: true }))
  return value
}

test('downloaded portraits become inline CID attachments for all three selectable characters', async (t) => {
  const root = await directory(t)
  for (const [id, name] of [
    ['amiya', '阿米娅'],
    ['priestess', '普瑞赛斯'],
    ['kaltsit', '凯尔希'],
  ]) {
    await writeFile(path.join(root, `${id}.png`), png)
    const portrait = await loadEmailPortrait(root, id)
    assert.equal(portrait.name, name)
    const mail = renderReminderEmail(
      { title: '准备项目复盘', dueAt: Date.now() + 600000, offsetMinutes: 10 },
      { now: Date.now(), timeZone: 'Asia/Shanghai', portrait },
    )
    assert.equal(mail.attachments.length, 1)
    const attachment = mail.attachments[0]
    assert.equal(attachment.contentType, 'image/png')
    assert.equal(attachment.contentDisposition, 'inline')
    assert.deepEqual(attachment.content, png)
    assert.ok(mail.html.includes(`cid:${attachment.cid}`))
    assert.doesNotMatch(mail.html, /<img\b/i)
    assert.doesNotMatch(mail.html, /<img[^>]+src="https?:/i)
    assert.match(mail.text, /准备项目复盘/)
  }
})

test('unavailable or invalid portraits keep the email usable without a broken image', async (t) => {
  const root = await directory(t)
  assert.equal(await loadEmailPortrait(root, 'amiya'), null)
  await writeFile(path.join(root, 'amiya.png'), 'not an image')
  assert.equal(await loadEmailPortrait(root, 'amiya'), null)
  await writeFile(path.join(root, 'amiya.png'), Buffer.alloc(2 * 1024 * 1024 + 1))
  assert.equal(await loadEmailPortrait(root, 'amiya'), null)
  const mail = renderReminderEmail(
    { title: '任务', dueAt: Date.now() + 600000, offsetMinutes: 10 },
    { now: Date.now(), timeZone: 'Asia/Shanghai', portrait: null },
  )
  assert.deepEqual(mail.attachments, [])
  assert.doesNotMatch(mail.html, /<img\b/i)
  assert.match(mail.html, /截止时间/)
})

test('portrait lookup cannot include a file outside the image resource directory', async (t) => {
  const root = await directory(t)
  const outside = await directory(t)
  const file = path.join(outside, 'private.png')
  await writeFile(file, png)
  await symlink(file, path.join(root, 'amiya.png'))
  assert.equal(await loadEmailPortrait(root, 'amiya'), null)
  assert.equal(await loadEmailPortrait(root, '../private'), null)
})

test('Endfield reminder emails use readable dark text on engineering yellow and escape task content', () => {
  const now = Date.parse('2026-11-02T00:00:00Z')
  const mail = renderReminderEmail(
    { title: '<工程> & "任务"', dueAt: now + 600000, offsetMinutes: 10 },
    { now, timeZone: 'Asia/Shanghai', theme: 'endfield' },
  )
  assert.match(mail.html, /ENDFIELD/)
  assert.match(mail.html, /background:#ecece7/)
  assert.match(mail.html, /background:#f2d33f;color:#20221f/)
  assert.match(mail.html, /color:#786400;font-size:12px/)
  assert.match(mail.html, /&lt;工程&gt; &amp; &quot;任务&quot;/)
  assert.doesNotMatch(mail.html, /<工程>/)
  assert.match(mail.text, /<工程> & "任务"/)
  assert.deepEqual(mail.attachments, [])
})
