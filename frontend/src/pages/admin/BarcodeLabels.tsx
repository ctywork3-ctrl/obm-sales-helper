import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { labelsApi } from '@/api/labels'
import { warehouseApi } from '@/api/warehouse'
import LoadingSpinner from '@/components/LoadingSpinner'
import LabelThermal from '@/components/LabelThermal'
import LabelSheet from '@/components/LabelSheet'
import { PrintPortal } from '@/components/A4Document'
import { ensurePrintStyles, printDocument } from '@/lib/print'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  Printer,
  QrCode as QrIcon,
  Save,
  Settings2,
  Tag,
} from 'lucide-react'
import type { LabelPrintConfig, LabelRow } from '@/types'

/**
 * Label printing.
 *
 * Reachable with `?units=1,2,3` (explicit units) or `?task=<id>` (everything
 * counted on a receiving task). The task route works *before* completion,
 * because units exist from the moment they are scanned — so a store keeper can
 * label as they unpack rather than waiting until the whole count is posted.
 */
export default function BarcodeLabels() {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()

  const unitIds = useMemo(
    () =>
      (searchParams.get('units') || '')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0),
    [searchParams],
  )
  const taskId = Number(searchParams.get('task') || 0) || null

  const [mode, setMode] = useState<'THERMAL' | 'A4' | null>(null)
  const [symbology, setSymbology] = useState<'QR' | 'CODE128' | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const { data: configResponse, isLoading: configLoading } = useQuery({
    queryKey: ['label-config'],
    queryFn: () => labelsApi.getConfig().then((res) => res.data),
  })

  const storedConfig = configResponse?.config

  // The active config is the stored one, with any per-job overrides on top.
  const config: LabelPrintConfig | null = useMemo(() => {
    if (!storedConfig) return null
    return {
      ...storedConfig,
      default_mode: mode ?? storedConfig.default_mode,
      symbology: symbology ?? storedConfig.symbology,
    }
  }, [storedConfig, mode, symbology])

  const { data: task } = useQuery({
    queryKey: ['receiving-task', taskId],
    queryFn: () => warehouseApi.getTask(taskId!).then((res) => res.data),
    enabled: !!taskId,
  })

  // Units to print: explicit ids, or every unit counted on the task.
  const resolvedUnitIds = useMemo(() => {
    if (unitIds.length) return unitIds
    if (!task) return []
    return task.lines.flatMap((line) => line.units.map((unit) => unit.id))
  }, [unitIds, task])

  const { data: renderData, isLoading: labelsLoading } = useQuery({
    queryKey: ['label-render', resolvedUnitIds.join(',')],
    queryFn: () => labelsApi.renderData(resolvedUnitIds).then((res) => res.data),
    enabled: resolvedUnitIds.length > 0,
  })

  const labels: LabelRow[] = renderData?.labels || []

  const saveConfig = useMutation({
    mutationFn: () => labelsApi.saveConfig(config!),
    onSuccess: () => {
      setMessage('Label settings saved as the default')
      setError('')
      queryClient.invalidateQueries({ queryKey: ['label-config'] })
    },
    onError: (err: any) => setError(err?.response?.data?.detail || 'Could not save the label settings'),
  })

  // Keep the print stylesheet in step with the chosen paper.
  useEffect(() => {
    if (!config) return
    if (config.default_mode === 'THERMAL') {
      ensurePrintStyles({
        customPageSize: `${config.thermal.width_mm}mm ${config.thermal.height_mm}mm`,
        marginMm: 0,
      })
    } else {
      ensurePrintStyles({ size: config.a4.sheet, marginMm: 0 })
    }
  }, [config?.default_mode, config?.thermal.width_mm, config?.thermal.height_mm, config?.a4.sheet])

  const handlePrint = async () => {
    if (!config) return
    if (config.default_mode === 'THERMAL') {
      await printDocument({
        customPageSize: `${config.thermal.width_mm}mm ${config.thermal.height_mm}mm`,
        marginMm: 0,
      })
    } else {
      await printDocument({ size: config.a4.sheet, marginMm: 0 })
    }
  }

  if (configLoading || !config) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const loading = labelsLoading && resolvedUnitIds.length > 0
  const nothingToPrint = resolvedUnitIds.length === 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 print-hidden">
        <div className="flex items-center gap-3">
          <Tag className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Label printing</h1>
            <p className="text-sm text-muted-foreground">
              One sticker per rod. The QR carries the serial, so scanning it later finds the warranty.
            </p>
          </div>
        </div>
        {taskId && (
          <Link
            to={`/app/warehouse/tasks/${taskId}`}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to task
          </Link>
        )}
      </div>

      {message && <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 print-hidden">{message}</div>}
      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 print-hidden">{error}</div>}

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4 shadow-sm print-hidden">
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Printer</label>
          <div className="mt-1 flex overflow-hidden rounded-md border">
            {(['THERMAL', 'A4'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setMode(option)}
                className={cn(
                  'px-3 py-2 text-sm font-medium',
                  config.default_mode === option ? 'bg-primary text-primary-foreground' : 'hover:bg-gray-50',
                )}
              >
                {option === 'THERMAL' ? 'Label printer' : 'A4 sheet'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground">Code</label>
          <div className="mt-1 flex overflow-hidden rounded-md border">
            {(['QR', 'CODE128'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setSymbology(option)}
                className={cn(
                  'px-3 py-2 text-sm font-medium',
                  config.symbology === option ? 'bg-primary text-primary-foreground' : 'hover:bg-gray-50',
                )}
              >
                {option === 'QR' ? 'QR' : 'Barcode'}
              </button>
            ))}
          </div>
        </div>

        <div className="text-sm text-muted-foreground">
          {config.default_mode === 'THERMAL'
            ? `${config.thermal.width_mm} × ${config.thermal.height_mm} mm · ${config.thermal.dpi} dpi`
            : `${config.a4.cols} × ${config.a4.rows} per ${config.a4.sheet} sheet`}
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={() => setShowOptions((open) => !open)}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            <Settings2 className="h-4 w-4" />
            Label options
          </button>
          <button
            onClick={handlePrint}
            disabled={nothingToPrint || loading}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            Print {labels.length > 0 ? `${labels.length} label${labels.length === 1 ? '' : 's'}` : 'labels'}
          </button>
        </div>
      </div>

      {showOptions && (
        <LabelOptions
          config={config}
          onPatch={(patch) => {
            queryClient.setQueryData(['label-config'], (current: any) =>
              current ? { ...current, config: { ...current.config, ...patch } } : current,
            )
          }}
          onSave={() => saveConfig.mutate()}
          saving={saveConfig.isPending}
        />
      )}

      {nothingToPrint && (
        <div className="rounded-lg border bg-white p-10 text-center print-hidden">
          <QrIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium">No labels to print</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a receiving task and use <em>Print labels</em>, or select units from the stock overview.
          </p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12 print-hidden">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* On-screen preview */}
      {!loading && labels.length > 0 && (
        <div className="rounded-lg border bg-gray-100 p-4 print-hidden">
          <p className="mb-3 text-xs font-medium uppercase text-muted-foreground">
            Preview ({labels.length})
          </p>
          <div className="flex flex-wrap gap-3">
            {labels.slice(0, 24).map((label) => (
              <div key={label.unit_id} className="border border-gray-300 bg-white shadow-sm">
                {config.default_mode === 'THERMAL' ? (
                  <LabelThermal labels={[label]} config={config} />
                ) : (
                  <div style={{ width: `${config.a4.label_width_mm}mm`, height: `${config.a4.label_height_mm}mm`, overflow: 'hidden' }}>
                    <LabelSheet labels={[label]} config={config} />
                  </div>
                )}
              </div>
            ))}
            {labels.length > 24 && (
              <div className="flex items-center px-3 text-sm text-muted-foreground">
                +{labels.length - 24} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* Print payload — hidden on screen, revealed by the print stylesheet */}
      <PrintPayload labels={labels} config={config} />
    </div>
  )
}

function PrintPayload({ labels, config }: { labels: LabelRow[]; config: LabelPrintConfig }) {
  if (labels.length === 0) return null
  return (
    <PrintPortal>
      {config.default_mode === 'THERMAL' ? (
        <LabelThermal labels={labels} config={config} />
      ) : (
        <LabelSheet labels={labels} config={config} />
      )}
    </PrintPortal>
  )
}

function LabelOptions({
  config,
  onPatch,
  onSave,
  saving,
}: {
  config: LabelPrintConfig
  onPatch: (patch: Partial<LabelPrintConfig>) => void
  onSave: () => void
  saving: boolean
}) {
  const numberField = (
    label: string,
    value: number,
    onChange: (value: number) => void,
    step = '0.5',
  ) => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 h-9 w-full rounded-md border px-2 text-sm"
      />
    </div>
  )

  return (
    <div className="space-y-4 rounded-lg border bg-white p-4 shadow-sm print-hidden">
      <div>
        <h2 className="mb-2 font-semibold">Label size</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {numberField('Width (mm)', config.thermal.width_mm, (value) =>
            onPatch({ thermal: { ...config.thermal, width_mm: value } }))}
          {numberField('Height (mm)', config.thermal.height_mm, (value) =>
            onPatch({ thermal: { ...config.thermal, height_mm: value } }))}
          {numberField('DPI', config.thermal.dpi, (value) =>
            onPatch({ thermal: { ...config.thermal, dpi: value } }), '1')}
          <div>
            <label className="block text-xs font-medium text-muted-foreground">QR error correction</label>
            <select
              value={config.qr_ecc}
              onChange={(event) => onPatch({ qr_ecc: event.target.value as LabelPrintConfig['qr_ecc'] })}
              className="mt-1 h-9 w-full rounded-md border px-2 text-sm"
              title="Higher survives scratches and water better, but the code is denser"
            >
              {['L', 'M', 'Q', 'H'].map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-semibold">A4 sheet layout</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {numberField('Columns', config.a4.cols, (value) =>
            onPatch({ a4: { ...config.a4, cols: value } }), '1')}
          {numberField('Rows', config.a4.rows, (value) =>
            onPatch({ a4: { ...config.a4, rows: value } }), '1')}
          {numberField('Label width', config.a4.label_width_mm, (value) =>
            onPatch({ a4: { ...config.a4, label_width_mm: value } }))}
          {numberField('Label height', config.a4.label_height_mm, (value) =>
            onPatch({ a4: { ...config.a4, label_height_mm: value } }))}
          {numberField('Top offset', config.a4.margin_top_mm, (value) =>
            onPatch({ a4: { ...config.a4, margin_top_mm: value } }))}
          {numberField('Left offset', config.a4.margin_left_mm, (value) =>
            onPatch({ a4: { ...config.a4, margin_left_mm: value } }))}
          {numberField('Column gap', config.a4.gap_x_mm, (value) =>
            onPatch({ a4: { ...config.a4, gap_x_mm: value } }))}
          {numberField('Row gap', config.a4.gap_y_mm, (value) =>
            onPatch({ a4: { ...config.a4, gap_y_mm: value } }))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          In the print dialog choose <strong>Scale 100%</strong>, <strong>Fit to page OFF</strong> and margins
          <strong> None</strong>. Nudge the offsets until the first sticker lands in its die-cut.
        </p>
      </div>

      <div>
        <h2 className="mb-2 font-semibold">What prints on the sticker</h2>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(config.fields) as (keyof LabelPrintConfig['fields'])[]).map((key) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                checked={config.fields[key]}
                onChange={(event) =>
                  onPatch({ fields: { ...config.fields, [key]: event.target.checked } })
                }
                className="h-4 w-4 rounded border-gray-300"
              />
              {key.replace(/_/g, ' ')}
            </label>
          ))}
        </div>
      </div>

      <button
        onClick={onSave}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
      >
        <Save className="h-4 w-4" />
        {saving ? 'Saving...' : 'Save as default'}
      </button>
    </div>
  )
}
