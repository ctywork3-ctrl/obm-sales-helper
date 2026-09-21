import { useEffect, useState } from 'react'

interface QrCodeProps {
  value: string
  /** Rendered size in millimetres — SVG scales losslessly so this stays crisp in print. */
  sizeMm: number
  ecc?: 'L' | 'M' | 'Q' | 'H'
  className?: string
}

/**
 * QR rendered as SVG.
 *
 * SVG rather than canvas on purpose: it prints at the printer's real
 * resolution instead of the screen's, which is the difference between a label
 * that scans first time and one that needs three attempts.
 */
export default function QrCode({ value, sizeMm, ecc = 'M', className }: QrCodeProps) {
  const [markup, setMarkup] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!value) {
      setMarkup('')
      return
    }
    import('qrcode')
      .then((QRCode) =>
        QRCode.toString(value, {
          type: 'svg',
          errorCorrectionLevel: ecc,
          margin: 0,
          width: 256,
        }),
      )
      .then((svg) => {
        if (cancelled) return
        // The library hardcodes width="256" height="256" on the root element.
        // Left alone, that overflows a millimetre-sized label box and the QR
        // spills over the text beside it. The viewBox is intact, so telling the
        // SVG to fill its container scales it correctly — and keeps it sharp in
        // print, which is the whole reason for using SVG here.
        const scaled = svg
          .replace(/width="[^"]*"/, 'width="100%"')
          .replace(/height="[^"]*"/, 'height="100%"')
        setMarkup(scaled)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) {
          setMarkup('')
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [value, ecc])

  const box: React.CSSProperties = { width: `${sizeMm}mm`, height: `${sizeMm}mm` }

  if (failed || !markup) {
    return (
      <div
        style={{ ...box, border: '0.4pt solid #9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        className={className}
      >
        <span style={{ fontSize: '5pt', color: '#6b7280', textAlign: 'center', padding: '0.5mm' }}>
          {value}
        </span>
      </div>
    )
  }

  return (
    <span
      className={className}
      style={{ ...box, display: 'block', lineHeight: 0 }}
      // Markup comes from the local `qrcode` library, which escapes its input.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
