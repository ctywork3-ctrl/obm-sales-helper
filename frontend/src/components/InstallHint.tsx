import { useEffect, useState } from 'react'
import { Download, Share, Smartphone, X } from 'lucide-react'
import { isStandalone } from '@/lib/pwa'

const DISMISS_KEY = 'obm.installHintDismissed'

/**
 * Nudges the user to install the app to their home screen.
 *
 * The whole point of the receiving screen is that a store keeper opens one icon
 * and starts scanning. A URL they have to find in a chat thread defeats that, so
 * this is worth the small amount of UI.
 *
 * Android/Chrome fires `beforeinstallprompt` and we can offer a real button.
 * iOS Safari does not — there it is instructions only.
 */
export default function InstallHint() {
  const [dismissed, setDismissed] = useState(true)
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop')
  const [installEvent, setInstallEvent] = useState<any>(null)

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === 'true')
    } catch {
      setDismissed(true)
    }

    const userAgent = navigator.userAgent || ''
    const isIOS =
      /iPad|iPhone|iPod/.test(userAgent) ||
      // iPadOS 13+ reports itself as a Mac; the touch points give it away.
      (userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
    if (isIOS) setPlatform('ios')
    else if (/Android/i.test(userAgent)) setPlatform('android')

    const handlePrompt = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event)
    }
    window.addEventListener('beforeinstallprompt', handlePrompt)
    return () => window.removeEventListener('beforeinstallprompt', handlePrompt)
  }, [])

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISS_KEY, 'true')
    } catch {
      /* nothing to do */
    }
  }

  // Already installed, or the user has said no before.
  if (dismissed || isStandalone()) return null

  const install = async () => {
    if (!installEvent) return
    installEvent.prompt()
    const choice = await installEvent.userChoice
    if (choice?.outcome === 'accepted') dismiss()
    setInstallEvent(null)
  }

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <Smartphone className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">Put this on your home screen</p>
        {platform === 'ios' ? (
          <p className="mt-1 text-muted-foreground">
            Tap <Share className="mx-0.5 inline h-3.5 w-3.5" /> <strong>Share</strong>, then{' '}
            <strong>Add to Home Screen</strong>. It opens like a normal app, with no address bar.
          </p>
        ) : platform === 'android' ? (
          <p className="mt-1 text-muted-foreground">
            Open the browser menu (⋮) and tap <strong>Install app</strong> /{' '}
            <strong>Add to Home screen</strong>.
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            Use the install icon in your browser's address bar. On a phone it opens full screen with
            no address bar, and the receiving screen keeps working when the signal drops.
          </p>
        )}
        {installEvent && (
          <button
            onClick={install}
            className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Download className="h-3.5 w-3.5" />
            Install now
          </button>
        )}
      </div>
      <button
        onClick={dismiss}
        className="rounded-md p-1 text-muted-foreground hover:bg-white/60"
        title="Hide this"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
