import { apiFetch } from './api'

export const PASSKEYS_CHANGED = 'prts:passkeys-changed'
export type PasskeyRecord = {
  id: string
  name: string
  rpID: string
  deviceType: string
  backedUp: boolean
  createdAt: number
  lastUsedAt: number | null
}
export type PasskeySettings = {
  supported: boolean
  origin: string
  rpID: string
  reason: string
  credentials: PasskeyRecord[]
}
let browserLibrary: Promise<typeof import('@simplewebauthn/browser')> | undefined
const library = () => (browserLibrary ??= import('@simplewebauthn/browser'))
export function supportsPasskeys() {
  return (
    window.isSecureContext && typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials
  )
}
export function warmPasskeys() {
  if (supportsPasskeys())
    void library().catch(() => {
      browserLibrary = undefined
    })
}
export async function cancelPasskeyCeremony() {
  if (browserLibrary) (await browserLibrary).WebAuthnAbortService.cancelCeremony()
}
export async function passkeyRequest(
  path: string,
  payload?: unknown,
  {
    method = payload === undefined ? 'GET' : 'POST',
    signal,
  }: { method?: string; signal?: AbortSignal } = {},
) {
  const fetcher = path.includes('/authentication/') ? fetch : apiFetch
  const response = await fetcher(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Passkey 请求失败，请稍后重试。')
  return result
}
export async function authenticatePasskey(
  options: import('@simplewebauthn/browser').PublicKeyCredentialRequestOptionsJSON,
  signal: AbortSignal,
) {
  const module = await library()
  signal.throwIfAborted()
  const abort = () => module.WebAuthnAbortService.cancelCeremony()
  signal.addEventListener('abort', abort, { once: true })
  try {
    return await module.startAuthentication({ optionsJSON: options })
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
export async function registerPasskey(
  options: import('@simplewebauthn/browser').PublicKeyCredentialCreationOptionsJSON,
  signal: AbortSignal,
) {
  const module = await library()
  signal.throwIfAborted()
  const abort = () => module.WebAuthnAbortService.cancelCeremony()
  signal.addEventListener('abort', abort, { once: true })
  try {
    return await module.startRegistration({ optionsJSON: options })
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
export function passkeyError(cause: unknown) {
  const name = cause instanceof Error ? cause.name : ''
  if (name === 'AbortError' || name === 'NotAllowedError')
    return 'Passkey 验证已取消或未完成，可以重试或使用密码。'
  if (name === 'InvalidStateError') return '此设备已存在相同 Passkey，请使用已有凭据或换一个设备。'
  if (name === 'SecurityError') return '当前地址无法使用 Passkey，请使用 HTTPS 域名或 localhost。'
  if (name === 'NotSupportedError') return '当前设备不支持此 Passkey 操作，请换用其他设备或密码。'
  if (name === 'TypeError') return '无法连接 Passkey 验证服务，请检查网络。'
  return cause instanceof Error ? cause.message : 'Passkey 验证失败，请重试或使用密码。'
}
