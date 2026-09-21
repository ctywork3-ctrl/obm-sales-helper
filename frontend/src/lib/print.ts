/**
 * A4 printing helpers.
 *
 * Strategy: render the document into a portal on <body>, inject a print
 * stylesheet that hides the whole app except the document, then call
 * window.print(). This works on iOS Safari (where the whole point of this
 * app is that the sales team uses iPads), because Safari prints the current
 * page — a popup window would be blocked or lose the layout.
 */

export const PAPER_SPECS: Record<string, { width_mm: number; height_mm: number }> = {
  A4: { width_mm: 210, height_mm: 297 },
  A5: { width_mm: 148, height_mm: 210 },
  LETTER: { width_mm: 216, height_mm: 279 },
}

export const PRINT_ROOT_ID = 'obm-print-root'
const STYLE_ID = 'obm-print-style'

export interface PaperOptions {
  size?: string
  orientation?: string
  marginMm?: number
  /**
   * Verbatim `@page size` value, e.g. `"50mm 30mm"` for a thermal label.
   *
   * When set it wins over `size`/`orientation`, and the margin floor drops to
   * 0mm — a label printer has no unprintable margin to respect, so clamping to
   * 5mm (as the A4 path does) would push the label off the media.
   */
  customPageSize?: string
}

function normalise({ size = 'A4', orientation = 'portrait', marginMm = 12, customPageSize }: PaperOptions) {
  if (customPageSize) {
    const margin = Math.min(Math.max(Number(marginMm) || 0, 0), 30)
    return { key: 'A4', dir: 'portrait', margin, customPageSize }
  }
  const key = PAPER_SPECS[size?.toUpperCase()] ? size.toUpperCase() : 'A4'
  const dir = orientation?.toLowerCase() === 'landscape' ? 'landscape' : 'portrait'
  const margin = Math.min(Math.max(Number(marginMm) || 12, 5), 30)
  return { key, dir, margin, customPageSize: undefined }
}

/** Dimensions in mm, swapped for landscape. */
export function paperDimensions(options: PaperOptions) {
  if (options.customPageSize) {
    const match = options.customPageSize.match(/([\d.]+)\s*mm\s+([\d.]+)\s*mm/i)
    if (match) {
      return { widthMm: Number(match[1]), heightMm: Number(match[2]) }
    }
  }
  const { key, dir } = normalise(options)
  const spec = PAPER_SPECS[key]
  return dir === 'landscape'
    ? { widthMm: spec.height_mm, heightMm: spec.width_mm }
    : { widthMm: spec.width_mm, heightMm: spec.height_mm }
}

/**
 * Inject (or refresh) the print stylesheet.
 *
 * The rules are deliberately blunt: in print, hide every direct child of
 * <body> that is not the print root. That survives new modals and toasts
 * being added later without anyone having to remember to mark them.
 */
export function ensurePrintStyles(options: PaperOptions = {}) {
  const { key, dir, margin, customPageSize } = normalise(options)

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }

  const pageRule = customPageSize
    ? `size: ${customPageSize};`
    : `size: ${key} ${dir};`

  style.textContent = `
@page {
  ${pageRule}
  margin: ${margin}mm;
}

#print-root-host {
  display: none;
}

@media print {
  html, body {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body > *:not(#${PRINT_ROOT_ID}) {
    display: none !important;
  }

  #${PRINT_ROOT_ID} {
    display: block !important;
    position: static !important;
    inset: auto !important;
    width: auto !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    background: #fff !important;
  }

  .print-page {
    width: auto !important;
    min-height: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    box-shadow: none !important;
    border: 0 !important;
  }

  .print-hidden,
  .no-print {
    display: none !important;
  }

  .print-avoid-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  table { border-collapse: collapse; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
}
`
  return { key, dir, margin }
}

/**
 * Print the current page. The print root must already be mounted (the print
 * components portal into a container with id `obm-print-root`).
 *
 * We wait two frames so React has painted the document before the browser
 * snapshots it — without this, Safari sometimes prints a blank page.
 */
export function printDocument(options: PaperOptions = {}) {
  ensurePrintStyles(options)
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print()
        resolve()
      })
    })
  })
}

/** Open the browser's print dialog for a standalone HTML string. */
export function printHtml(html: string, options: PaperOptions = {}) {
  const { key, dir, margin, customPageSize } = normalise(options)
  const pageRule = customPageSize ? `size: ${customPageSize};` : `size: ${key} ${dir};`
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)

  const doc = frame.contentWindow?.document
  if (!doc) {
    frame.remove()
    return
  }
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { ${pageRule} margin: ${margin}mm; }
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #111; margin: 0; }
</style>
</head><body>${html}</body></html>`)
  doc.close()

  const run = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1500)
  }
  if (doc.readyState === 'complete') {
    setTimeout(run, 120)
  } else {
    frame.onload = () => setTimeout(run, 120)
  }
}
