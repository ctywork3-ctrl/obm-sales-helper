import type { LabelPrintConfig, LabelRow } from '@/types'
import LabelCard from '@/components/LabelCard'

interface LabelSheetProps {
  labels: LabelRow[]
  config: LabelPrintConfig
}

/**
 * A4 sheet mode: a grid of die-cut labels through the office printer.
 *
 * The grid is driven entirely by the config so it can be calibrated against
 * real stock (Avery L7159 is 3 columns x 8 rows of 63.5 x 33.9mm). Browsers
 * add their own unprintable margin, which is why `margin_top_mm` and
 * `margin_left_mm` exist as calibration offsets — expect to nudge them once
 * per printer.
 */
export default function LabelSheet({ labels, config }: LabelSheetProps) {
  const a4 = config.a4
  const perSheet = a4.cols * a4.rows
  const sheets: LabelRow[][] = []
  for (let index = 0; index < labels.length; index += perSheet) {
    sheets.push(labels.slice(index, index + perSheet))
  }

  return (
    <div>
      {sheets.map((sheet, sheetIndex) => (
        <div
          key={sheetIndex}
          style={{
            breakAfter: sheetIndex === sheets.length - 1 ? 'auto' : 'page',
            pageBreakAfter: sheetIndex === sheets.length - 1 ? 'auto' : 'always',
            paddingTop: `${a4.margin_top_mm}mm`,
            paddingLeft: `${a4.margin_left_mm}mm`,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${a4.cols}, ${a4.label_width_mm}mm)`,
              columnGap: `${a4.gap_x_mm}mm`,
              rowGap: `${a4.gap_y_mm}mm`,
            }}
          >
            {sheet.map((label) => (
              <div
                key={label.unit_id}
                style={{
                  width: `${a4.label_width_mm}mm`,
                  height: `${a4.label_height_mm}mm`,
                  outline: '0.4pt dashed #d1d5db',
                  overflow: 'hidden',
                }}
              >
                <LabelCard
                  label={label}
                  config={config}
                  widthMm={a4.label_width_mm}
                  heightMm={a4.label_height_mm}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
