import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDatabase } from '../server/database.mjs'
import { createNotificationSettings } from '../server/notification-settings.mjs'

test('notification configuration keeps credentials private, persists and rejects stale edits', (t) => {
  const db = createDatabase()
  t.after(() => db.close())
  const settings = createNotificationSettings(db)
  const initial = settings.read()
  assert.equal(initial.enabled, false)
  const saved = settings.update({
    ...initial,
    enabled: true,
    leadDays: [7, 3, 1],
    webhook: { enabled: true, url: 'https://qq.example/webhook/general?token=private-url' },
    smtp: {
      enabled: true,
      host: 'smtp.example.com',
      port: 465,
      security: 'tls',
      user: 'doctor',
      password: 'private-smtp-password',
      from: 'prts@example.com',
      to: 'one@example.com,two@example.com',
    },
  })
  assert.equal(saved.revision, 2)
  assert.equal(saved.smtp.hasPassword, true)
  assert.equal(saved.webhook.hasUrl, true)
  assert.doesNotMatch(JSON.stringify(saved), /private-url|private-smtp-password/)
  assert.equal(settings.configuration().smtp.password, 'private-smtp-password')
  settings.update({
    ...saved,
    webhook: { ...saved.webhook, url: '' },
    smtp: { ...saved.smtp, password: '' },
  })
  assert.equal(settings.configuration().smtp.password, 'private-smtp-password')
  assert.equal(
    createNotificationSettings(db).configuration().webhook.url,
    'https://qq.example/webhook/general?token=private-url',
  )
  assert.throws(() => settings.update(initial), { status: 409 })
})

test('invalid lead times, recipients, transport and clear options never change the saved revision', (t) => {
  const db = createDatabase()
  t.after(() => db.close())
  const settings = createNotificationSettings(db)
  const initial = settings.read()
  for (const change of [
    { leadDays: [-1] },
    { leadDays: [1.5] },
    { leadDays: [366] },
    { leadMinutes: -1 },
    { timeZone: 'not-a-zone' },
    { enabled: true, leadDays: [], leadMinutes: 0 },
    { webhook: { enabled: true, url: 'file:///etc/passwd' } },
    { webhook: { enabled: true, url: 'https://user:pass@example.com' } },
    { smtp: { ...initial.smtp, enabled: true, security: 'none' } },
    {
      smtp: {
        ...initial.smtp,
        enabled: true,
        host: 'mail.test',
        from: 'evil\r\nBcc: bad',
        to: 'doctor@test.example',
      },
    },
  ]) {
    assert.throws(() => settings.update({ ...initial, ...change }), { status: 400 })
    assert.equal(settings.read().revision, 1)
  }
})

test('SMTP credentials preserve significant spaces instead of silently changing the password', (t) => {
  const db = createDatabase()
  t.after(() => db.close())
  const settings = createNotificationSettings(db)
  const current = settings.read()
  settings.update({ ...current, smtp: { ...current.smtp, password: '  authorization-code  ' } })
  assert.equal(settings.configuration().smtp.password, '  authorization-code  ')
})
