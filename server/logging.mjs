import { randomUUID } from 'node:crypto'

const routes = new Set([
  '/api',
  '/api/health',
  '/api/chat',
  '/api/state',
  '/api/state/import',
  '/api/messages',
  '/api/files',
  '/api/focus/complete',
  '/api/auth/session',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/password',
  '/api/auth/passkeys',
  '/api/auth/passkeys/authentication/options',
  '/api/auth/passkeys/authentication/verify',
  '/api/auth/passkeys/registration/options',
  '/api/auth/passkeys/registration/verify',
  '/api/settings/ai',
  '/api/settings/notifications',
  '/api/calendar/subscription',
  '/api/calendar/feed.ics',
  '/api/notifications',
  '/api/notifications/test',
  '/api/notifications/retry',
  '/api/notifications/deliveries',
  '/api/assets/sync',
  '/api/knowledge/sync',
  '/api/knowledge',
  '/api/knowledge/search',
])
const publicFiles = new Set([
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/sw.js',
  '/offline.html',
  '/favicon.svg',
  '/rhodes-island.svg',
])
const codes = new Set([
  'EACCES',
  'EPERM',
  'ENOENT',
  'ENOSPC',
  'EROFS',
  'EMFILE',
  'EIO',
  'EADDRINUSE',
  'EADDRNOTAVAIL',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAUTH',
  'ECONNECTION',
  'ESOCKET',
  'EENVELOPE',
  'EMESSAGE',
  'EDNS',
  'ERR_SQLITE_ERROR',
  'ERR_INVALID_STATE',
  'SQLITE_BUSY',
  'SQLITE_FULL',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
])

export function errorDetails(error) {
  return {
    errorType:
      error instanceof TypeError
        ? 'TypeError'
        : error instanceof RangeError
          ? 'RangeError'
          : error instanceof SyntaxError
            ? 'SyntaxError'
            : 'Error',
    ...(codes.has(error?.code) ? { errorCode: error.code } : {}),
  }
}

// Never log raw URLs, dynamic identifiers, request/response bodies or error messages:
// queries, filenames and upstream exceptions can contain passwords or API credentials.
function requestPath(url) {
  let pathname
  try {
    pathname = new URL(url, 'http://localhost').pathname
  } catch {
    return '/invalid'
  }
  if (routes.has(pathname) || publicFiles.has(pathname)) return pathname
  if (/^\/api\/files\/[^/]+\/content$/.test(pathname)) return '/api/files/:id/content'
  if (/^\/api\/files\/[^/]+$/.test(pathname)) return '/api/files/:id'
  if (/^\/api\/state\/[^/]+$/.test(pathname)) return '/api/state/:document'
  if (/^\/api\/auth\/passkeys\/[^/]+$/.test(pathname)) return '/api/auth/passkeys/:id'
  if (/^\/api\/assistant\/actions\/[^/]+$/.test(pathname)) return '/api/assistant/actions/:id'
  if (/^\/api\/notifications\/[^/]+\/read$/.test(pathname)) return '/api/notifications/:id/read'
  if (pathname.startsWith('/api/')) return '/api/*'
  for (const prefix of ['/assets/', '/icons/', '/branding/'])
    if (pathname.startsWith(prefix)) return `${prefix}*`
  return '/page'
}

export function createLogger({
  now = Date.now,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  return (level, event, fields = {}) => {
    try {
      const line =
        JSON.stringify({ ...fields, time: new Date(now()).toISOString(), level, event }) + '\n'
      ;(level === 'info' ? stdout : stderr).write(line)
    } catch {
      // A broken log sink must not break authentication or the notification queue.
    }
  }
}

export function observeRequest(request, response, log) {
  const requestId = randomUUID()
  const fields = { requestId, method: request.method, path: requestPath(request.url) }
  const started = performance.now()
  let emitted = false
  response.setHeader('X-Request-ID', requestId)
  const complete = () => {
    if (emitted) return
    emitted = true
    const status = response.writableFinished ? response.statusCode : 499
    log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'http.request', {
      ...fields,
      status,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    })
  }
  response.once('finish', complete)
  response.once('close', complete)
  return fields
}
