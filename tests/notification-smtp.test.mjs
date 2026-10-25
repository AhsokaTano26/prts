import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer as tlsServer } from 'node:tls'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'

const exec = promisify(execFile)
test('SMTP sends through a real TLS session, authenticates and keeps certificate verification enabled', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'prts-smtp-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const key = path.join(directory, 'key.pem'),
    cert = path.join(directory, 'cert.pem'),
    config = path.join(directory, 'openssl.cnf')
  await writeFile(
    config,
    '[req]\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n',
  )
  await exec(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-config',
      config,
    ],
    { maxBuffer: 100_000 },
  )
  let authenticated = false
  const messages = []
  const sockets = new Set()
  const server = tlsServer({ key: await readFile(key), cert: await readFile(cert) }, (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.write('220 localhost test SMTP\r\n')
    let buffer = '',
      data = false,
      message = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      let end
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (data) {
          if (line === '.') {
            messages.push(message)
            message = ''
            data = false
            socket.write('250 accepted\r\n')
          } else message += line + '\n'
          continue
        }
        if (/^EHLO/.test(line)) socket.write('250-localhost\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n')
        else if (/^AUTH PLAIN /.test(line)) {
          authenticated =
            Buffer.from(line.slice(11), 'base64').toString() ===
            '\0doctor\0test-smtp-authorization-only'
          socket.write(authenticated ? '235 authenticated\r\n' : '535 authentication failed\r\n')
        } else if (/^(MAIL FROM|RCPT TO)/.test(line)) socket.write('250 OK\r\n')
        else if (line === 'DATA') {
          data = true
          socket.write('354 end with dot\r\n')
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n')
        } else socket.write('250 OK\r\n')
      }
    })
  })
  server.on('tlsClientError', () => {})
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  })
  const script = `import {sendSmtp} from ${JSON.stringify(new URL('../server/notification-delivery.mjs', import.meta.url).href)};
    const result=await sendSmtp({host:'127.0.0.1',port:${server.address().port},security:'tls',user:'doctor',password:'test-smtp-authorization-only'},
      {from:'prts@example.test',to:'doctor@example.test',subject:'PRTS SMTP Test',text:'Deadline reminder test',html:'<html><body style="background-image:url(cid:portrait@prts.local)"><h1>Deadline reminder test</h1></body></html>',attachments:[{filename:'amiya.png',content:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64'),contentType:'image/png',contentDisposition:'inline',cid:'portrait@prts.local'}]});
    if(result.accepted.length!==1)process.exitCode=1;`
  await exec(process.execPath, ['--input-type=module', '-e', script], {
    env: { PATH: process.env.PATH, NODE_EXTRA_CA_CERTS: cert },
    timeout: 20_000,
    maxBuffer: 100_000,
  })
  assert.equal(authenticated, true)
  assert.equal(messages.length, 1)
  assert.match(messages[0], /Subject: PRTS SMTP Test/)
  assert.match(messages[0], /Deadline reminder test/)
  assert.match(messages[0], /Content-Type: multipart\/alternative;/i)
  assert.match(messages[0], /Content-Type: text\/plain; charset=utf-8/i)
  assert.match(messages[0], /Content-Type: text\/html; charset=utf-8/i)
  const unfolded = messages[0].replace(/=\r?\n/g, '')
  assert.match(unfolded, /<h1>Deadline reminder test<\/h1>/)
  assert.match(unfolded, /background-image:url\(cid:portrait@prts\.local\)/)
  assert.match(messages[0], /Content-Type: multipart\/related;/i)
  assert.match(messages[0], /Content-Type: image\/png;/i)
  assert.match(messages[0], /Content-ID: <portrait@prts.local>/i)
  assert.match(messages[0], /Content-Disposition: inline;/i)
  await assert.rejects(
    exec(process.execPath, ['--input-type=module', '-e', script], {
      env: { PATH: process.env.PATH },
      timeout: 20_000,
      maxBuffer: 100_000,
    }),
  )
  assert.equal(messages.length, 1, 'untrusted certificates must not deliver any mail')
})
