import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportTemplatesApi } from '@/api/reportTemplates'
import A4Document, { PrintPortal } from '@/components/A4Document'
import LoadingSpinner from '@/components/LoadingSpinner'
import { ensurePrintStyles, paperDimensions, printDocument } from '@/lib/print'
import { Printer, X, ZoomIn, ZoomOut } from 'lucide-react'

interface SalesOrderPrintDialogProps {
  orderId: number
  open: boolean
  onClose: () => void
}

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1]

export default function SalesOrderPrintDialog({ orderId, open, onClose }: SalesOrderPrintDialogProps) {
  const [templateId, setTemplateId] = useState<number | undefined>(undefined)
  const [zoom, setZoom] = useState(0.65)
  const [printing, setPrinting] = useState(false)

  const { data: templates } = useQuery({
    queryKey: ['report-templates', 'SALES_ORDER'],
    queryFn: () => reportTemplatesApi.list('SALES_ORDER').then((res) => res.data),
    enabled: open,
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['sales-order-print-data', orderId, templateId],
    queryFn: () => reportTemplatesApi.salesOrderPrintData(orderId, templateId).then((res) => res.data),
    enabled: open && !!orderId,
  })

  const config = data?.template.config
  const paper = config?.paper
  const dims = useMemo(
    () => paperDimensions({ size: paper?.size, orientation: paper?.orientation, marginMm: paper?.margin_mm }),
    [paper?.size, paper?.orientation, paper?.margin_mm],
  )

  // Keep the print stylesheet in sync with the chosen paper.
  useEffect(() => {
    if (!open || !paper) return
    ensurePrintStyles({ size: paper.size, orientation: paper.orientation, marginMm: paper.margin_mm })
  }, [open, paper?.size, paper?.orientation, paper?.margin_mm])

  // Escape closes the dialog.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handlePrint = async () => {
    if (!paper) return
    setPrinting(true)
    try {
      await printDocument({
        size: paper.size,
        orientation: paper.orientation,
        marginMm: paper.margin_mm,
      })
    } finally {
      setPrinting(false)
    }
  }

  const previewWidth = dims.widthMm * 3.7795 * zoom // mm -> px at 96dpi
  const previewHeight = dims.heightMm * 3.7795 * zoom

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-2 sm:p-4">
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-gray-100 shadow-2xl">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b bg-white px-3 py-2 sm:gap-3 sm:px-4">
            <div className="mr-auto flex items-center gap-2">
              <Printer className="h-5 w-5 text-primary" />
              <span className="font-semibold">Print preview</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {paper?.size} · {paper?.orientation}
              </span>
            </div>

            <select
              value={templateId ?? ''}
              onChange={(event) => setTemplateId(event.target.value ? Number(event.target.value) : undefined)}
              className="h-9 max-w-[200px] rounded-md border px-2 text-sm"
              title="Report layout"
            >
              <option value="">Default layout</option>
              {(templates || []).map((template) => (
                <option key={template.id ?? 0} value={template.id ?? ''}>
                  {template.name}
                  {template.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 rounded-md border">
              <button
                type="button"
                onClick={() => setZoom((z) => ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(z) - 1)] ?? z)}
                className="p-2 hover:bg-gray-100"
                title="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="w-10 text-center text-xs">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((z) => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(z) + 1)] ?? z)}
                className="p-2 hover:bg-gray-100"
                title="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={handlePrint}
              disabled={!data || printing}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              {printing ? 'Opening…' : 'Print / Save PDF'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border p-2 hover:bg-gray-100"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Preview */}
          <div className="flex-1 overflow-auto p-4">
            {isLoading && (
              <div className="flex justify-center py-20">
                <LoadingSpinner size="lg" />
              </div>
            )}
            {error && (
              <div className="mx-auto max-w-md rounded-md bg-red-50 p-4 text-sm text-red-600">
                Could not load this order for printing.
              </div>
            )}
            {data && config && (
              <div
                className="mx-auto bg-white shadow-lg"
                style={{ width: `${previewWidth}px`, height: `${previewHeight}px`, overflow: 'hidden' }}
              >
                <A4Document data={data} config={config} previewScale={zoom} />
              </div>
            )}
          </div>

          <div className="border-t bg-white px-4 py-2 text-xs text-muted-foreground">
            Tip: choose "Save as PDF" in the print dialog to email a copy. Serials and warranty dates print
            automatically for tracked goods.
          </div>
        </div>
      </div>

      {/* Print-only copy — hidden on screen, revealed by the print stylesheet. */}
      {data && config && (
        <PrintPortal>
          <A4Document data={data} config={config} />
        </PrintPortal>
      )}
    </>
  )
}
