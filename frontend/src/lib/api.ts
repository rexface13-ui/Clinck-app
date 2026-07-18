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
