import type { LabelPrintConfig, LabelRow } from '@/types'
import LabelCard from '@/components/LabelCard'

interface LabelThermalProps {
  labels: LabelRow[]
  config: LabelPrintConfig
}

/**
 * Thermal mode: one label per page.
 *
 * The `@page` size is set by the caller to exactly the label dimensions
 * (e.g. `50mm 30mm`), so the browser's print engine feeds one sticker per
 * page. The page break is explicit rather than relying on page-fitting.
 */
export default function LabelThermal({ labels, config }: LabelThermalProps) {
  return (
    <div>
      {labels.map((label, index) => (
        <div
          key={label.unit_id}
          style={{
            breakAfter: index === labels.length - 1 ? 'auto' : 'page',
            pageBreakAfter: index === labels.length - 1 ? 'auto' : 'always',
          }}
        >
          <LabelCard label={label} config={config} />
        </div>
      ))}
    </div>
  )
}
