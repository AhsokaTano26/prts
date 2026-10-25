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
