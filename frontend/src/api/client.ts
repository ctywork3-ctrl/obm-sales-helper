import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || '/api'

function getCSRFToken(): string {
  const match = document.cookie.match(/csrf_token=([^;]+)/)
  return match ? match[1] : ''
}

const client = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

client.interceptors.request.use((config) => {
  if (!['get', 'head', 'options', 'trace'].includes(config.method || '')) {
    config.headers['X-CSRF-Token'] = getCSRFToken()
  }

  /*
   * Uploads must NOT carry a hand-written multipart Content-Type.
   *
   * The header is `multipart/form-data; boundary=----xyz`, and only the HTTP
   * client knows the boundary it generated. Setting the bare type strips it,
   * and FastAPI rejects the request with "Missing boundary in multipart."
   *
   * So for FormData we delete the header and let axios set the whole thing.
   * We cannot rely on a per-call `headers: {'Content-Type': ...}` because the
   * instance default above wins unless it is explicitly removed.
   */
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    delete config.headers['Content-Type']
  }

  return config
})

/*
 * Redirect to a login screen when a request comes back 401 - but ONLY for the
 * staff area.
 *
 * This used to be an allow-list of public paths with "everything else" sent to
 * /login. That inverts badly: any NEW public page silently gets hijacked, because
 * a page that needs no login still fires an /auth/me probe, gets a 401, and is
 * bounced to a login form the visitor has no account for. That is exactly what
 * happened to the public warranty page, which ended up at /catalog.
 *
 * So the rule is now narrow: inside /app, a 401 means the staff session expired,
 * so go to the staff login. Everywhere else - /warranty, /catalog, and any future
 * public page - the 401 is the page's own business.
 */
const STAFF_PREFIX = '/app'
const STAFF_LOGIN = '/app/login'

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const path = window.location.pathname
      if (path.startsWith(STAFF_PREFIX) && path !== STAFF_LOGIN) {
        window.location.href = STAFF_LOGIN
      }
    }
    return Promise.reject(error)
  }
)

export function getUploadUrl(path: string): string {
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '')
  return `${base}/uploads/${path}`
}

export default client
