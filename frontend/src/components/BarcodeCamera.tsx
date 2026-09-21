import { useEffect, useRef, useState } from 'react'
import type { Html5Qrcode } from 'html5-qrcode'
import { Camera, CameraOff } from 'lucide-react'

const READER_ID = 'barcode-camera-reader'

interface BarcodeCameraProps {
  onScan: (decodedText: string) => void
}

export default function BarcodeCamera({ onScan }: BarcodeCameraProps) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastScanRef = useRef<{ text: string; at: number }>({ text: '', at: 0 })
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!active) return

    setError('')
    setStatus('Requesting camera permission...')

    let stopped = false
    let scanner: Html5Qrcode | null = null

    const start = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (stopped) return
        scanner = new Html5Qrcode(READER_ID, { verbose: false })
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 140 } },
          (decodedText: string) => {
            const now = Date.now()
            const { text, at } = lastScanRef.current
            if (text === decodedText && now - at < 2000) return
            lastScanRef.current = { text: decodedText, at: now }
            setStatus('Barcode detected. Looking it up...')
            onScanRef.current(decodedText)
          },
          () => {
            // per-frame decode failures are normal and ignored
          },
        )
        if (!stopped) setStatus('Camera ready. Point it at a barcode.')
      } catch (err: unknown) {
        if (stopped) return
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('secure context') || message.includes('NotAllowedError')) {
          setError('Camera unavailable. On phones, camera access requires HTTPS (or localhost). Use manual input instead.')
        } else if (message.includes('NotFoundError') || message.includes('no camera')) {
          setError('No camera found on this device. Use manual input instead.')
        } else {
          setError(`Camera could not start: ${message || 'Unknown browser error'}`)
        }
        setStatus('')
        setActive(false)
      }
    }
    start()

    return () => {
      stopped = true
      const instance = scannerRef.current
      scannerRef.current = null
      if (instance) {
        instance
          .stop()
          .then(() => instance.clear())
          .catch(() => {})
      }
    }
  }, [active])

  const startCamera = () => {
    const hostname = window.location.hostname
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
    if (!window.isSecureContext && !isLocalhost) {
      setError(
        `Camera permission is blocked on ${window.location.origin}. Open the secure HTTPS LAN address instead, or use manual barcode input.`,
      )
      setStatus('')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not provide camera access. Update the browser or use manual barcode input.')
      setStatus('')
      return
    }
    setError('')
    setActive(true)
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => (active ? setActive(false) : startCamera())}
        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
          active ? 'border-red-200 text-red-600 hover:bg-red-50' : 'hover:bg-gray-50'
        }`}
      >
        {active ? (
          <>
            <CameraOff className="h-4 w-4" /> Stop camera
          </>
        ) : (
          <>
            <Camera className="h-4 w-4" /> Scan with camera
          </>
        )}
      </button>

      {active && (
        <div className="mt-3 overflow-hidden rounded-lg border">
          <div id={READER_ID} className="w-full" />
        </div>
      )}

      {status && <p className="mt-2 text-sm text-muted-foreground">{status}</p>}

      {error && (
        <div className="mt-2 rounded-md bg-yellow-50 p-3 text-sm text-yellow-700">
          <p>{error}</p>
          {error.includes('HTTPS') && (
            <p className="mt-1 text-xs">
              Camera permissions are available on `localhost` or HTTPS only. Allow the browser prompt when it appears.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
