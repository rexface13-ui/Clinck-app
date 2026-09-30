import axios from 'axios'

/**
 * withCredentials carries the Sanctum session cookie on every request.
 * withXSRFToken makes axios read the XSRF-TOKEN cookie Laravel sets and
 * echo it back as X-XSRF-TOKEN — Sanctum's CSRF check for SPA auth.
 * vite.config.ts proxies /api, /sanctum, /login, /logout to the backend
 * so the browser sees everything as same-origin.
 */
const shared = {
  withCredentials: true,
  withXSRFToken: true,
  headers: { Accept: 'application/json' },
}

export const api = axios.create({ ...shared, baseURL: '/api' })

export const authApi = axios.create({ ...shared, baseURL: '' })

/**
 * Reversing already-billed work (un-checking a step, removing a tooth,
 * cancelling a session) can leave the patient in credit if they'd already
 * paid toward it — the backend refuses with a 422 naming the amount instead
 * of silently doing it. This retries once, with `force: true` merged into
 * the request, after the user confirms that exact message; any other error
 * (or a "no") just propagates like normal.
 */
export async function withPaidConfirm<T>(request: (force: boolean) => Promise<T>): Promise<T> {
  try {
    return await request(false)
  } catch (err) {
    const response = (err as { response?: { status?: number; data?: { message?: string } } })?.response
    if (response?.status === 422 && response.data?.message?.includes('متسددة فعلاً') && window.confirm(response.data.message)) {
      return await request(true)
    }
    throw err
  }
}
