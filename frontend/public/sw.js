/* Service worker for the OBM Sales Helper app.
 *
 * Two goals, in priority order:
 *
 *  1. **Never serve stale stock data.** Anything under /api/ or /uploads/ is
 *     passed straight through and never cached. A store keeper counting against
 *     a cached quantity would post the wrong stock, which is far worse than an
 *     error message.
 *
 *  2. **Open offline.** The app shell is cached, so a worker in a warehouse
 *     corner with no signal can still open the app, see the task they already
 *     loaded, and queue scans (see src/lib/offlineQueue.ts). The queue is what
 *     actually survives a dead zone — this file only makes sure the screen
 *     loads at all.
 */

const CACHE_VERSION = 'obm-shell-v1'
const SHELL_URLS = [
  '/',
  '/app',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.svg',
]

// Vite's dev server serves transformed modules from these paths. Caching them
// breaks hot reload and can pin a stale build, so they always go to the network.
const DEV_PATHS = ['/@vite/', '/@react-refresh', '/src/', '/node_modules/', '/@fs/']

function isApiRequest(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')
}

function isDevAsset(url) {
  return DEV_PATHS.some((prefix) => url.pathname.startsWith(prefix)) || url.searchParams.has('t')
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION)
      // Individually, so one failure does not abort the whole install.
      await Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // 1. Live data is never cached.
  if (isApiRequest(url)) return

  // 2. Dev-server modules always hit the network.
  if (isDevAsset(url)) return

  // 3. Navigations: network first, fall back to the cached shell so the app
  //    still opens with no signal.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          const cache = await caches.open(CACHE_VERSION)
          cache.put('/app', response.clone()).catch(() => undefined)
          return response
        } catch (error) {
          const cache = await caches.open(CACHE_VERSION)
          const cached = (await cache.match(request)) || (await cache.match('/app')) || (await cache.match('/'))
          if (cached) return cached
          return new Response(
            '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<body style="font-family:system-ui;padding:2rem;text-align:center;color:#111">' +
              '<h1 style="font-size:1.1rem">No connection</h1>' +
              '<p style="color:#6b7280">This page has not been opened on this device yet, so it cannot load offline.</p>' +
              '</body>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          )
        }
      })(),
    )
    return
  }

  // 4. Static assets: cache first, then revalidate in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION)
      const cached = await cache.match(request)
      if (cached) {
        fetch(request)
          .then((fresh) => {
            if (fresh && fresh.status === 200) cache.put(request, fresh.clone())
          })
          .catch(() => undefined)
        return cached
      }
      try {
        const response = await fetch(request)
        if (response && response.status === 200 && response.type === 'basic') {
          cache.put(request, response.clone()).catch(() => undefined)
        }
        return response
      } catch (error) {
        return new Response('', { status: 504, statusText: 'Offline' })
      }
    })(),
  )
})
