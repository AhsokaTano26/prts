// Test-only software authenticator. Keys are ephemeral and never used by the app.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { isoCBOR } from '@simplewebauthn/server/helpers'

const hash = (value) => createHash('sha256').update(value).digest()
const encode = (value) => Buffer.from(value).toString('base64url')
export function softwarePasskey({ synced = false } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const id = randomBytes(32)
  const cose = new Map([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
    [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))],
  ])
  const clientData = (type, options, origin, crossOrigin = false) =>
    Buffer.from(JSON.stringify({ type, challenge: options.challenge, origin, crossOrigin }))
  return {
    id: encode(id),
    registration(
      options,
      {
        origin = 'http://localhost:8791',
        rpID = options.rp.id,
        uv = true,
        crossOrigin = false,
      } = {},
    ) {
      const size = Buffer.alloc(2)
      size.writeUInt16BE(id.length)
      const flags = 0x41 | (uv ? 4 : 0) | (synced ? 24 : 0)
      const authData = Buffer.concat([
        hash(rpID),
        Buffer.from([flags]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        size,
        id,
        isoCBOR.encode(cose),
      ])
      return {
        id: encode(id),
        rawId: encode(id),
        type: 'public-key',
        response: {
          clientDataJSON: encode(clientData('webauthn.create', options, origin, crossOrigin)),
          attestationObject: encode(
            isoCBOR.encode(
              new Map([
                ['fmt', 'none'],
                ['attStmt', new Map()],
                ['authData', new Uint8Array(authData)],
              ]),
            ),
          ),
          transports: ['internal'],
        },
        clientExtensionResults: { credProps: { rk: true } },
        authenticatorAttachment: 'platform',
      }
    },
    assertion(
      options,
      {
        origin = 'http://localhost:8791',
        rpID = options.rpId,
        uv = true,
        counter = synced ? 0 : 1,
        userHandle,
        crossOrigin = false,
      } = {},
    ) {
      const count = Buffer.alloc(4)
      count.writeUInt32BE(counter)
      const authData = Buffer.concat([
        hash(rpID),
        Buffer.from([1 | (uv ? 4 : 0) | (synced ? 24 : 0)]),
        count,
      ])
      const data = clientData('webauthn.get', options, origin, crossOrigin)
      return {
        id: encode(id),
        rawId: encode(id),
        type: 'public-key',
        response: {
          clientDataJSON: encode(data),
          authenticatorData: encode(authData),
          signature: encode(sign('sha256', Buffer.concat([authData, hash(data)]), privateKey)),
          userHandle: userHandle ?? null,
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      }
    },
  }
}
