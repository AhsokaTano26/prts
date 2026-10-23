export const SESSION_EXPIRED_EVENT = 'prts:session-expired'
let sessionEpoch = 0

export function advanceSessionEpoch() {
  sessionEpoch += 1
}

/** Protected application requests share the server-issued HttpOnly session. */
export async function apiFetch(input: string, init?: RequestInit) {
  const requestEpoch = sessionEpoch
  const response = await fetch(input, { ...init, credentials: 'same-origin' })
  if (response.status === 401 && requestEpoch === sessionEpoch) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
  }
  return response
}
