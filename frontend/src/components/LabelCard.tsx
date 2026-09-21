import { useEffect, useRef } from 'react'
import type { LabelPrintConfig, LabelRow } from '@/types'
import QrCode from '@/components/QrCode'

interface LabelCardProps {
  label: LabelRow
  config: LabelPrintConfig
  /** Overrides the thermal width when printing an A4 sheet cell. */
  widthMm?: number
  heightMm?: number
}

/** CODE128 fallback for printers/stock where 1D is preferred. */
function Code128({ value, heightMm }: { value: string; heightMm: number }) {
  const ref = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!ref.current || !value) return
    import('jsbarcode')
      .then(({ default: JsBarcode }) => {
        if (cancelled || !ref.current) return
        try {
          JsBarcode(ref.current, value, {
            format: 'CODE128',
            displayValue: false,
            height: 34,
            margin: 0,
            width: 1.4,
          })
        } catch {
          /* an unencodable value leaves the SVG empty rather than breaking the page */
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [value])

  return <svg ref={ref} style={{ width: '100%', height: `${heightMm}mm` }} />
}

/**
 * One physical sticker.
 *
 * Built from inline mm/pt styles rather than Tailwind: utility classes get
 * dropped or reordered by the print stylesheet, and these dimensions have to
 * match the label stock exactly.
 */
export default function LabelCard({ label, config, widthMm, heightMm }: LabelCardProps) {
  const width = widthMm ?? config.thermal.width_mm
  const height = heightMm ?? config.thermal.height_mm
  const fields = config.fields

  const compact = height < 25
  const codeSize = Math.max(12, Math.min(height - 4, width * 0.42))
  const textSize = compact ? '5.5pt' : '6.5pt'
  const titleSize = compact ? '6.5pt' : '7.5pt'

  return (
    <div
      style={{
        width: `${width}mm`,
        height: `${height}mm`,
        padding: '1mm',
        boxSizing: 'border-box',
        display: 'flex',
        gap: '1.5mm',
        alignItems: 'center',
        background: '#ffffff',
        color: '#000000',
        fontFamily: 'Helvetica, Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div style={{ flexShrink: 0 }}>
        {config.symbology === 'QR' ? (
          <QrCode value={label.code} sizeMm={codeSize} ecc={config.qr_ecc} />
        ) : (
          <div style={{ width: `${codeSize}mm` }}>
            <Code128 value={label.barcode || label.code} heightMm={codeSize * 0.45} />
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.4mm' }}>
        {fields.product_name && label.product_name && (
          <div
            style={{
              fontSize: titleSize,
              fontWeight: 700,
              lineHeight: 1.15,
              display: '-webkit-box',
              WebkitLineClamp: compact ? 1 : 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {label.product_name}
          </div>
        )}

        {fields.item_code && label.item_code && (
          <div style={{ fontSize: textSize, color: '#374151' }}>{label.item_code}</div>
        )}

        {/* The serial is the whole point of the sticker — always shown. */}
        <div style={{ fontSize: textSize, fontFamily: 'monospace', fontWeight: 600 }}>
          {label.code}
        </div>

        {fields.manufacturer_serial && label.manufacturer_serial && (
          <div style={{ fontSize: textSize, color: '#4b5563' }}>
            MFR: {label.manufacturer_serial}
          </div>
        )}

        {fields.unit_code && label.unit_code && (
          <div style={{ fontSize: textSize, color: '#6b7280' }}>{label.unit_code}</div>
        )}

        {fields.warranty_months && label.warranty_months ? (
          <div style={{ fontSize: textSize, color: '#374151', fontWeight: 600 }}>
            Warranty {label.warranty_months} months
          </div>
        ) : null}

        {fields.location && label.location && (
          <div style={{ fontSize: textSize, color: '#6b7280' }}>{label.location}</div>
        )}
      </div>
    </div>
  )
}
