import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Info,
  RefreshCw,
  Upload,
  XCircle,
} from 'lucide-react'
import {
  purchaseOrdersApi,
  type ImportResult,
  type ObmImportResult,
} from '@/api/purchaseOrders'
import { getApiErrorMessage } from '@/lib/apiError'
import WorkflowHeader from '@/components/WorkflowHeader'
import { cn } from '@/lib/utils'

/**
 * Bring purchase orders in, either straight from OBM or from a CSV export.
 *
 * **OBM first.** The business already raises POs there and OBM is the source of
 * truth, so reading its database directly removes the export step entirely. CSV
 * stays as the fallback for when OBM is on another machine, or when a file is
 * all someone can get.
 *
 * Either way the shape is the same: **read first, show what would happen, then
 * commit.** Pulling forty purchase orders sight-unseen is how a bad link quietly
 * creates forty wrong drafts, and only the user can tell a sensible PO from a
 * broken one.
 *
 * Reading OBM is read-only against OBM. Nothing here ever writes to the
 * accounting package.
 */

type Source = 'OBM' | 'CSV'

/** One shape to render, whichever source produced it. */
interface ViewModel {
  source: Source
  filename?: string | null
  rowsRead?: number
  ordersFound: number
  errors: { row: number; reason: string }[]
  warnings: { row: number; reason: string }[]
  unmatchedSuppliers: string[]
  preview?: {
    external_reference: string
    supplier_name: string
    expected_date?: string | null
    line_count: number
  }[]
  committed: boolean
  created?: number
  updated?: number
  skipped: { row: number; reason: string }[]
  unmatchedLines: number
  message?: string
}

function fromCsv(result: ImportResult): ViewModel {
  return {
    source: 'CSV',
    filename: result.filename,
    rowsRead: result.rows_read,
    ordersFound: result.orders_found,
    errors: result.errors,
    warnings: result.warnings,
    unmatchedSuppliers: result.unmatched_suppliers,
    preview: result.preview,
    committed: result.committed,
    created: result.created,
    updated: result.updated,
    skipped: (result.skipped ?? []).map((entry) => ({
      row: 0,
      reason: `${entry.reference ?? 'unknown'}: ${entry.reason}`,
    })),
    unmatchedLines: 0,
    message: result.message,
  }
}

function fromObm(result: ObmImportResult): ViewModel {
  return {
    source: 'OBM',
    rowsRead: result.counts?.headers,
    ordersFound: result.orders_found,
    errors: [],
    warnings: [],
    unmatchedSuppliers: [],
    preview: result.preview,
    committed: result.committed,
    created: result.created,
    updated: result.updated,
    // OBM skips whole orders rather than spreadsheet rows.
    skipped: (result.skipped ?? []).map((entry) => ({
      row: 0,
      reason: `${entry.reference}: ${entry.reason} (${entry.line_count} line(s) read)`,
    })),
    unmatchedLines: result.unmatched_lines?.length ?? 0,
    message: result.message,
  }
}

export default function ImportPurchaseOrders() {
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const [source, setSource] = useState<Source>('OBM')
  const [file, setFile] = useState<File | null>(null)
  const [view, setView] = useState<ViewModel | null>(null)
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(50)
  const [since, setSince] = useState('')
  const [includeCancelled, setIncludeCancelled] = useState(false)

  const { data: obm } = useQuery({
    queryKey: ['obm-status'],
    queryFn: () => purchaseOrdersApi.obmStatus().then((res) => res.data),
  })

  const reset = () => {
    setView(null)
    setError('')
  }

  const parseCsv = useMutation({
    mutationFn: (chosen: File) =>
      purchaseOrdersApi.importCsv(chosen, false).then((res) => res.data),
    onSuccess: (data) => {
      setView(fromCsv(data))
      setError('')
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not read that file')),
  })

  const commitCsv = useMutation({
    mutationFn: (chosen: File) =>
      purchaseOrdersApi.importCsv(chosen, true).then((res) => res.data),
    onSuccess: (data) => {
      setView(fromCsv(data))
      setError('')
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
    onError: (err) =>
      setError(getApiErrorMessage(err, 'Could not import those purchase orders')),
  })

  const readObm = useMutation({
    mutationFn: (commit: boolean) =>
      purchaseOrdersApi
        .importFromObm({ commit, limit, since: since || undefined, includeCancelled })
        .then((res) => res.data),
    onSuccess: (data) => {
      setView(fromObm(data))
      setError('')
      if (data.committed) queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not read from OBM')),
  })

  const busy = parseCsv.isPending || commitCsv.isPending || readObm.isPending
  const obmReady = Boolean(obm?.direct_connected)

  const pickFile = (chosen: File | null) => {
    if (!chosen) return
    setFile(chosen)
    reset()
    parseCsv.mutate(chosen)
  }

  return (
    <div className="space-y-6">
      <WorkflowHeader
        title="Import Purchase Orders"
        subtitle="Read them straight from OBM, or upload a CSV export. Nothing is saved until you confirm."
        icon={<FileSpreadsheet className="h-5 w-5" />}
        backLabel="Purchase orders"
        onBack={() => window.history.back()}
      />

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {/* ---- 1. source ---- */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="font-semibold">1. Where should the orders come from?</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SourceCard
            active={source === 'OBM'}
            onClick={() => {
              setSource('OBM')
              reset()
            }}
            icon={<Database className="h-5 w-5" />}
            title="From OBM"
            subtitle="Reads the purchase orders already in OBM. No export needed."
            badge={obmReady ? 'Connected' : 'Not linked'}
            badgeTone={obmReady ? 'good' : 'warn'}
          />
          <SourceCard
            active={source === 'CSV'}
            onClick={() => {
              setSource('CSV')
              reset()
            }}
            icon={<Upload className="h-5 w-5" />}
            title="From a CSV export"
            subtitle="For when OBM is on another machine, or a file is all you have."
          />
        </div>
      </div>

      {/* ---- 2a. OBM ---- */}
      {source === 'OBM' && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">2. Read from OBM</h2>

          {obm && !obm.direct_connected && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">OBM is not linked</p>
              <p className="mt-1 text-sm text-amber-800">{obm.message}</p>
              <p className="mt-2 text-sm text-amber-800">
                Meanwhile you can{' '}
                <button
                  type="button"
                  onClick={() => {
                    setSource('CSV')
                    reset()
                  }}
                  className="underline"
                >
                  import a CSV export
                </button>
                .
              </p>
            </div>
          )}

          {obm?.direct_connected && (
            <p className="mt-2 text-sm text-muted-foreground">
              Connected to OBM (Firebird {obm.engine_version}); {obm.purchase_order_count}{' '}
              purchase order{obm.purchase_order_count === 1 ? '' : 's'} on file.
            </p>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="font-medium">How many recent orders</span>
              <input
                type="number"
                min={1}
                max={500}
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value) || 50)}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium">On or after (optional)</span>
              <input
                type="date"
                value={since}
                onChange={(event) => setSince(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={includeCancelled}
                onChange={(event) => setIncludeCancelled(event.target.checked)}
                className="h-4 w-4"
              />
              Include cancelled
            </label>
          </div>

          <button
            type="button"
            onClick={() => {
              reset()
              readObm.mutate(false)
            }}
            disabled={busy || !obmReady}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', readObm.isPending && 'animate-spin')} />
            {readObm.isPending ? 'Reading OBM...' : 'Read from OBM'}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Reading OBM never changes it — this only ever reads.
          </p>
        </div>
      )}

      {/* ---- 2b. CSV ---- */}
      {source === 'CSV' && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="font-semibold">2. Choose the export</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One row per order line, with the purchase order number repeated on each row —
            that is what an accounting package produces.
          </p>

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              pickFile(event.dataTransfer.files?.[0] ?? null)
            }}
            className="mt-3 flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center"
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm">
              Drop a <span className="font-medium">.csv</span> file here, or
            </p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="mt-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Browse for a file
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="mt-3 text-sm text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>

          {parseCsv.isPending && (
            <p className="mt-3 text-sm text-muted-foreground">Reading the file...</p>
          )}

          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              What columns does it expect?
            </summary>
            <div className="mt-2 space-y-2 text-muted-foreground">
              <p>
                Four are required; the rest are optional.{' '}
                <span className="font-medium text-foreground">
                  PO number, Supplier, Item code, Quantity.
                </span>
              </p>
              <p>
                Also read if present: description, unit price, due date and remarks. Header
                names do not have to match exactly — "Supplier", "Vendor" and "SUPPLIER NAME"
                are all understood.
              </p>
              <p>
                Dates are read day-first, so{' '}
                <span className="font-mono text-xs">15/10/2026</span> is 15 October. Prices
                may include <span className="font-mono text-xs">RM</span> or thousands
                separators.
              </p>
            </div>
          </details>
        </div>
      )}

      {/* ---- result ---- */}
      {view && (
        <div className="space-y-4">
          <ImportSummary view={view} />

          {view.errors.length > 0 && (
            <IssueList
              title={`${view.errors.length} row${view.errors.length === 1 ? '' : 's'} could not be used`}
              tone="error"
              issues={view.errors}
              note="These rows are skipped. Everything else in the file still imports."
            />
          )}

          {view.warnings.length > 0 && (
            <IssueList
              title={`${view.warnings.length} detail${view.warnings.length === 1 ? '' : 's'} could not be read`}
              tone="warning"
              issues={view.warnings}
              note="The order still imported; only the missing detail was left blank."
            />
          )}

          {view.skipped.length > 0 && (
            <IssueList
              title={`${view.skipped.length} purchase order${view.skipped.length === 1 ? '' : 's'} were not imported`}
              tone="warning"
              issues={view.skipped}
              note="These were found, but had nothing importable — an expense or allocation line carries no stock item."
            />
          )}

          {view.unmatchedSuppliers.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 text-amber-600" />
                <div>
                  <p className="text-sm font-medium text-amber-900">
                    {view.unmatchedSuppliers.length} vendor
                    {view.unmatchedSuppliers.length === 1 ? ' is' : 's are'} not in your
                    supplier list
                  </p>
                  <p className="mt-1 text-sm text-amber-800">
                    The orders still import and keep the vendor name from the file, but they
                    are not linked to a supplier record. That is deliberate — it is how you
                    avoid inventing a supplier for every typo.
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {view.unmatchedSuppliers.map((name) => (
                      <li
                        key={name}
                        className="rounded bg-white px-2 py-0.5 font-mono text-xs text-amber-900"
                      >
                        {name}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm text-amber-800">
                    Add them in{' '}
                    <Link to="/app/purchase-orders/suppliers" className="underline">
                      Suppliers
                    </Link>
                    , then read again — the existing orders get linked rather than duplicated.
                  </p>
                </div>
              </div>
            </div>
          )}

          {view.unmatchedLines > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                <p className="text-sm text-amber-800">
                  <span className="font-medium text-amber-900">
                    {view.unmatchedLines} line{view.unmatchedLines === 1 ? '' : 's'} could not
                    be matched to a product.
                  </span>{' '}
                  The orders imported without those lines. Set the product's OBM item code (or
                  create the product), then read again — it updates rather than duplicates.
                </p>
              </div>
            </div>
          )}

          {view.preview && view.preview.length > 0 && (
            <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
              <div className="border-b bg-gray-50 px-4 py-2 text-sm font-medium">
                Would be imported
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Reference</th>
                    <th className="px-4 py-2 font-medium">Supplier</th>
                    <th className="px-4 py-2 font-medium">Expected</th>
                    <th className="px-4 py-2 text-right font-medium">Lines</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {view.preview.map((row) => (
                    <tr key={row.external_reference}>
                      <td className="px-4 py-2 font-mono text-xs">{row.external_reference}</td>
                      <td className={cn('px-4 py-2', !row.supplier_name && 'text-amber-600')}>
                        {row.supplier_name || 'No supplier'}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {row.expected_date || '—'}
                      </td>
                      <td className="px-4 py-2 text-right">{row.line_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!view.committed && view.ordersFound > 0 && (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="font-semibold">3. Confirm the import</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {view.ordersFound} purchase order{view.ordersFound === 1 ? '' : 's'} will be
                created as drafts. Reading again later updates them instead of creating
                duplicates, so it is safe to run after fixing something.
              </p>
              <button
                type="button"
                onClick={() => {
                  if (view.source === 'OBM') readObm.mutate(true)
                  else if (file) commitCsv.mutate(file)
                }}
                disabled={busy}
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {busy
                  ? 'Importing...'
                  : `Import ${view.ordersFound} purchase order${view.ordersFound === 1 ? '' : 's'}`}
              </button>
            </div>
          )}

          {!view.committed && view.ordersFound === 0 && (
            <div className="rounded-lg border bg-white p-6 text-center">
              <XCircle className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 font-medium">Nothing to import</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {view.message || 'Nothing new was found.'}
              </p>
            </div>
          )}

          {view.committed && (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="font-semibold">Done</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {view.message} The orders are drafts, so they can still be reviewed and edited
                before they are sent.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to="/app/purchase-orders"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  View purchase orders
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null)
                    reset()
                    if (fileInput.current) fileInput.current.value = ''
                  }}
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
                >
                  Import more
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SourceCard({
  active,
  onClick,
  icon,
  title,
  subtitle,
  badge,
  badgeTone,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  subtitle: string
  badge?: string
  badgeTone?: 'good' | 'warn'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border p-4 text-left transition-colors',
        active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-gray-50'
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn(active ? 'text-primary' : 'text-muted-foreground')}>{icon}</span>
        <span className="font-medium">{title}</span>
        {badge && (
          <span
            className={cn(
              'ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium',
              badgeTone === 'good'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            )}
          >
            {badge}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </button>
  )
}

function ImportSummary({ view }: { view: ViewModel }) {
  const stats: { label: string; value: number; tone?: 'good' | 'bad' | 'muted' }[] = []

  if (view.rowsRead !== undefined) {
    stats.push({
      label: view.source === 'OBM' ? 'Read from OBM' : 'Rows read',
      value: view.rowsRead,
      tone: 'muted',
    })
  }
  stats.push({
    label: view.committed ? 'Created' : 'Would import',
    value: view.committed ? view.created ?? 0 : view.ordersFound,
    tone: 'good',
  })
  if (view.committed) {
    stats.push({ label: 'Updated', value: view.updated ?? 0 })
  }
  const notImported = view.errors.length + view.skipped.length
  stats.push({
    label: 'Not imported',
    value: notImported,
    tone: notImported > 0 ? 'bad' : 'muted',
  })

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {view.committed ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        ) : (
          <Info className="h-5 w-5 text-muted-foreground" />
        )}
        <span className="font-medium">
          {view.committed ? 'Imported' : 'Preview — nothing saved yet'}
        </span>
        <span className="text-sm text-muted-foreground">
          · {view.source === 'OBM' ? 'from OBM' : 'from CSV'}
          {view.filename ? ` · ${view.filename}` : ''}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-6">
        {stats.map((stat) => (
          <div key={stat.label}>
            <div
              className={cn(
                'text-xl font-semibold',
                stat.tone === 'good' && 'text-emerald-600',
                stat.tone === 'bad' && 'text-red-600',
                stat.tone === 'muted' && 'text-muted-foreground'
              )}
            >
              {stat.value}
            </div>
            <div className="text-xs uppercase text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>
      {!view.committed && view.message && (
        <p className="mt-3 text-sm text-muted-foreground">{view.message}</p>
      )}
    </div>
  )
}

function IssueList({
  title,
  tone,
  issues,
  note,
}: {
  title: string
  tone: 'error' | 'warning'
  issues: { row: number; reason: string }[]
  note: string
}) {
  const isError = tone === 'error'
  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        isError ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={cn('mt-0.5 h-4 w-4', isError ? 'text-red-600' : 'text-amber-600')}
        />
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-medium', isError ? 'text-red-900' : 'text-amber-900')}>
            {title}
          </p>
          <p className={cn('mt-0.5 text-sm', isError ? 'text-red-700' : 'text-amber-800')}>
            {note}
          </p>
          <ul className="mt-2 space-y-1">
            {issues.slice(0, 25).map((issue, index) => (
              <li key={index} className="flex gap-2 text-sm">
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {issue.row > 0 ? `row ${issue.row}` : 'file'}
                </span>
                <span className={isError ? 'text-red-800' : 'text-amber-800'}>
                  {issue.reason}
                </span>
              </li>
            ))}
          </ul>
          {issues.length > 25 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Showing the first 25 of {issues.length}.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
