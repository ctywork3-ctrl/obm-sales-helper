/**
 * Service worker registration.
 *
 * Registered in dev as well as production, because the normal workflow here is
 * `start.bat` (the Vite dev server) and a PWA that only works in a production
 * build is a PWA nobody tests. `sw.js` itself skips Vite's dev modules so hot
 * reload keeps working.
 *
 * The worker also needs a secure context: HTTPS or localhost. On a phone over
 * the LAN that means `start-secure-lan.bat`, which is already what the camera
 * scanning needs anyway.
 */

export type ServiceWorkerStatus = 'unsupported' | 'registered' | 'failed' | 'insecure'

export async function registerServiceWorker(): Promise<ServiceWorkerStatus> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported'
  }

  // Camera access already requires this, so the two constraints line up.
  if (!window.isSecureContext) {
    console.info('[pwa] Offline support needs HTTPS or localhost — skipped.')
    return 'insecure'
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

    // If a new worker is waiting, let it take over on the next load rather than
    // leaving the user on a stale shell indefinitely.
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      if (!installing) return
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          installing.postMessage('SKIP_WAITING')
        }
      })
    })

    return 'registered'
  } catch (error) {
    console.warn('[pwa] Service worker registration failed:', error)
    return 'failed'
  }
}

/** Whether the app is currently running as an installed window. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone
  return window.matchMedia?.('(display-mode: standalone)').matches || iosStandalone === true
}
