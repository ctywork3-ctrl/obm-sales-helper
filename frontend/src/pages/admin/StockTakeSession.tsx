import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { stockTakesApi } from '@/api/stockTakes'
import LoadingSpinner from '@/components/LoadingSpinner'
import BarcodeCamera from '@/components/BarcodeCamera'
import ConfirmDialog from '@/components/ConfirmDialog'
import { ScanRejected, enqueue, flushQueue, queueLength } from '@/lib/offlineQueue'
import { cn, formatDate } from '@/lib/utils'
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ClipboardList,
  CloudOff,
  MoreVertical,
  RefreshCw,
  Save,
  ScanLine,
} from 'lucide-react'
import type { StockTakeCountLine } from '@/types'

/**
 * Counting the shelf.
 *
 * Same one-screen shape as receiving: one active line, one input, one action.
 * The difference is what the numbers mean — here the *expected* figure is frozen
 * from when the count started, so a sale happening mid-count cannot quietly move
 * the baseline and make the variance disappear.
 *
 * Offline scans queue locally exactly like receiving does.
 */
export default function StockTakeSession() {
  const { id } = useParams<{ id: string }>()
  const sessionId = Number(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [activeLineId, setActiveLineId] = useState<number | null>(null)
  const [scanValue, setScanValue] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [bulkValues, setBulkValues] = useState<Record<number, string>>({})
  const [showPost, setShowPost] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [pendingCount, setPendingCount] = useState(0)
  const [flushing, setFlushing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: session, isLoading } = useQuery({
    queryKey: ['stock-take', sessionId],
    queryFn: () => stockTakesApi.get(sessionId).then((res) => res.data),
    enabled: !!sessionId,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['stock-take', sessionId] })
    queryClient.invalidateQueries({ queryKey: ['stock-takes'] })
  }

  const scan = useMutation({
    mutationFn: (code: string) => stockTakesApi.scan(sessionId, code),
    onSuccess: (response) => {
      const result = response.data
      setScanValue('')
      setMessage({
        tone: result.result === 'OK' ? 'ok' : 'warn',
        text: result.message,
      })
      invalidate()
      inputRef.current?.focus()
    },
    onError: (err: any, code) => {
      if (!err?.response) {
        const queued = enqueue({ taskId: sessionId, taskLineId: 0, code })
        setPendingCount(queueLength(sessionId))
        setScanValue('')
        setMessage({
          tone: 'warn',
          text: queued
            ? `No connection — "${code}" saved on this device and will upload automatically.`
            : `No connection — "${code}" is already waiting to upload.`,
        })
        return
      }
      setMessage({ tone: 'warn', text: err.response.data?.detail || 'Scan failed' })
    },
  })

  const setQuantity = useMutation({
    mutationFn: ({ lineId, quantity }: { lineId: number; quantity: number }) =>
      stockTakesApi.setQuantity(sessionId, lineId, quantity),
    onSuccess: () => {
      invalidate()
      setMessage({ tone: 'ok', text: 'Quantity saved.' })
    },
    onError: (err: any) => setError(err?.response?.data?.detail || 'Could not save the quantity'),
  })

  const post = useMutation({
    mutationFn: () => stockTakesApi.complete(sessionId, reason),
    onSuccess: (response) => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['stock-overview'] })
      setShowPost(false)
      navigate('/app/warehouse/stock-takes', { state: { posted: response.data.message } })
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setError(detail && typeof detail === 'object' ? detail.message : detail || 'Could not post the stock take')
      setShowPost(false)
    },
  })

  const cancel = useMutation({
    mutationFn: () => stockTakesApi.cancel(sessionId),
    onSuccess: () => {
      invalidate()
      navigate('/app/warehouse/stock-takes')
    },
    onError: (err: any) => setError(err?.response?.data?.detail || 'Could not cancel the count'),
  })

  /**
   * Replay offline scans. A stock-take scan needs only the code — the server
   * resolves which line it belongs to — so `taskLineId` is unused here.
   */
  const flushPending = useCallback(async () => {
    if (queueLength(sessionId) === 0) {
      setPendingCount(0)
      return
    }
    setFlushing(true)
    try {
      const result = await flushQueue(async (entry) => {
        try {
          const response = await stockTakesApi.scan(entry.taskId, entry.code)
          return { message: response.data?.message }
        } catch (err: any) {
          if (err?.response) {
            throw new ScanRejected(err.response.data?.detail || `"${entry.code}" was rejected`)
          }
          throw err
        }
      }, sessionId)

      if (result.sent > 0) invalidate()
      const last = result.messages[result.messages.length - 1]
      if (last) setMessage({ tone: 'warn', text: last })
      else if (result.sent > 0) {
        setMessage({ tone: 'ok', text: `Uploaded ${result.sent} scan${result.sent === 1 ? '' : 's'}.` })
      }
    } finally {
      setFlushing(false)
      setPendingCount(queueLength(sessionId))
    }
  }, [sessionId])

  useEffect(() => {
    setPendingCount(queueLength(sessionId))
    if (typeof navigator !== 'undefined' && navigator.onLine) void flushPending()

    const handleOnline = () => {
      setOnline(true)
      void flushPending()
    }
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [sessionId, flushPending])

  const editable = session && session.status === 'IN_PROGRESS'
  const lines: StockTakeCountLine[] = session?.counts || []

  const uncounted = useMemo(() => lines.filter((line) => line.counted_qty === null), [lines])
  const variances = useMemo(
    () => lines.filter((line) => line.variance !== null && line.variance !== 0),
    [lines],
  )

  useEffect(() => {
    if (!editable) return
    const active = lines.find((line) => line.id === activeLineId)
    if (!active || active.counted_qty !== null) {
      const next = uncounted[0]
      if (next) setActiveLineId(next.id)
    }
  }, [lines, editable, activeLineId, uncounted])

  useEffect(() => {
    if (activeLineId) inputRef.current?.focus()
  }, [activeLineId])

  const activeLine = useMemo(
    () => lines.find((line) => line.id === activeLineId) || null,
    [lines, activeLineId],
  )

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!session) {
    return <div className="py-12 text-center text-muted-foreground">Stock take not found</div>
  }

  const handleScan = (rawCode: string) => {
    const code = rawCode.trim()
    if (!code) return
    if (!online) {
      const queued = enqueue({ taskId: sessionId, taskLineId: 0, code })
      setPendingCount(queueLength(sessionId))
      setScanValue('')
      setMessage({
        tone: 'warn',
        text: queued
          ? `No connection — "${code}" saved on this device and will upload automatically.`
          : `No connection — "${code}" is already waiting to upload.`,
      })
      inputRef.current?.focus()
      return
    }
    scan.mutate(code)
  }

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/app/warehouse/stock-takes')}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All stock takes
        </button>

        <div className="relative">
          <button
            onClick={() => setShowMenu((open) => !open)}
            className="rounded-md border p-2 text-muted-foreground hover:bg-gray-50"
            title="More"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border bg-white py-1 shadow-lg">
                {editable && (
                  <button
                    onClick={() => {
                      setShowMenu(false)
                      setShowCancel(true)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-red-50"
                  >
                    <Ban className="h-4 w-4" />
                    Cancel this count
                  </button>
                )}
                {!editable && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    This count is {session.status.toLowerCase()}.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {(!online || pendingCount > 0) && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm',
            online ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-amber-200 bg-amber-50 text-amber-900',
          )}
        >
          <CloudOff className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">
            {!online ? 'No connection. ' : ''}
            {pendingCount > 0
              ? `${pendingCount} scan${pendingCount === 1 ? '' : 's'} saved on this device, waiting to upload.`
              : 'Scans are being saved on this device until the connection returns.'}
          </span>
          {online && pendingCount > 0 && (
            <button
              onClick={() => void flushPending()}
              disabled={flushing}
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-white px-3 py-1.5 font-medium text-blue-900 hover:bg-blue-50 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', flushing && 'animate-spin')} />
              {flushing ? 'Uploading...' : 'Upload now'}
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold">{session.session_number}</h1>
            <p className="truncate text-sm text-muted-foreground">
              {session.scope === 'LOCATION'
                ? session.location_name || 'Location'
                : session.scope === 'ALL'
                  ? 'Whole warehouse'
                  : 'Single product'}
              {session.started_at ? ` · started ${formatDate(session.started_at)}` : ''}
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="text-3xl font-bold leading-none">
              {session.counted_lines}
              <span className="text-lg font-normal text-muted-foreground">/{session.total_lines}</span>
            </p>
            {/* Says "lines" explicitly: the rows below count units, and the two
                numbers look contradictory without it. */}
            <p className="mt-1 text-xs text-muted-foreground">
              {uncounted.length > 0 ? `${uncounted.length} line${uncounted.length === 1 ? '' : 's'} left` : 'all lines counted'}
            </p>
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              session.progress_percent >= 100 ? 'bg-emerald-500' : 'bg-primary',
            )}
            style={{ width: `${Math.min(session.progress_percent, 100)}%` }}
          />
        </div>

        {variances.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              {variances.length} line{variances.length === 1 ? '' : 's'} differ from the system
              {' '}({variances
                .slice(0, 3)
                .map((line) => `${line.product_name}: ${line.variance! > 0 ? '+' : ''}${line.variance}`)
                .join(', ')}
              {variances.length > 3 ? ', …' : ''}). You will need to give a reason before posting.
            </span>
          </div>
        )}

        {session.instructions && (
          <div className="mt-3 rounded-md bg-blue-50 p-3 text-sm text-blue-900">
            <p className="font-medium">Instructions</p>
            <p className="whitespace-pre-line">{session.instructions}</p>
          </div>
        )}
      </div>

      {/* Active line */}
      {editable && activeLine && (
        <div className="rounded-lg border-2 border-primary/40 bg-white p-4 shadow-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <ScanLine className="h-5 w-5 flex-shrink-0 text-primary" />
              <p className="truncate font-semibold">{activeLine.product_name}</p>
            </div>
            <span className="flex-shrink-0 text-sm font-semibold">
              {activeLine.counted_qty ?? 0}
              <span className="text-muted-foreground">/{activeLine.expected_qty}</span>
            </span>
          </div>
          <p className="mb-3 font-mono text-xs text-muted-foreground">{activeLine.product_code}</p>

          {activeLine.tracking_mode === 'SERIALIZED' ? (
            <>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleScan(scanValue)
                    }
                  }}
                  placeholder="Scan or type the serial, then Enter"
                  className="h-14 flex-1 rounded-md border-2 px-3 font-mono text-base"
                  autoComplete="off"
                />
                <button
                  onClick={() => handleScan(scanValue)}
                  disabled={!scanValue.trim() || scan.isPending}
                  className="inline-flex h-14 w-20 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                >
                  <CheckCircle2 className="h-6 w-6" />
                </button>
              </div>
              <div className="mt-3">
                <BarcodeCamera onScan={handleScan} />
              </div>
            </>
          ) : (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-sm font-medium">Counted quantity</label>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={bulkValues[activeLine.id] ?? String(activeLine.counted_qty ?? '')}
                  onChange={(event) =>
                    setBulkValues({ ...bulkValues, [activeLine.id]: event.target.value })
                  }
                  className="mt-1 h-14 w-full rounded-md border-2 px-3 text-xl"
                />
              </div>
              <button
                onClick={() =>
                  setQuantity.mutate({
                    lineId: activeLine.id,
                    quantity: Number(bulkValues[activeLine.id] ?? activeLine.counted_qty ?? 0),
                  })
                }
                disabled={setQuantity.isPending}
                className="inline-flex h-14 items-center gap-2 rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
              >
                <Save className="h-5 w-5" />
                Save
              </button>
            </div>
          )}

          {message && (
            <div
              className={cn(
                'mt-3 flex items-start gap-2 rounded-md p-3 text-sm',
                message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800',
              )}
            >
              <span>{message.text}</span>
            </div>
          )}

          {uncounted.length > 1 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Next: {uncounted.find((line) => line.id !== activeLine.id)?.product_name}
            </p>
          )}
        </div>
      )}

      {/* Lines */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Lines ({lines.length})</h2>
        </div>
        <div className="divide-y">
          {lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              active={line.id === activeLineId}
              editable={!!editable}
              onSelect={() => {
                setActiveLineId(line.id)
                setMessage(null)
              }}
            />
          ))}
        </div>
      </div>

      {session.status === 'COMPLETED' && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-1 font-semibold">Posted</h2>
          <p className="text-sm text-muted-foreground">
            Net {session.net_variance > 0 ? '+' : ''}
            {session.net_variance} units.
            {session.completion_notes ? ` Reason: ${session.completion_notes}` : ''}
          </p>
        </div>
      )}

      {/* One action */}
      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white p-3 shadow-lg md:left-16 lg:left-64">
          <div className="mx-auto flex max-w-3xl">
            <button
              onClick={() => setShowPost(true)}
              disabled={post.isPending || session.counted_lines === 0 || pendingCount > 0}
              title={
                pendingCount > 0 ? 'Upload the scans saved on this device first' : undefined
              }
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <ClipboardList className="h-5 w-5" />
              {post.isPending
                ? 'Posting...'
                : pendingCount > 0
                  ? `Upload ${pendingCount} scan${pendingCount === 1 ? '' : 's'} first`
                  : `Post stock take${variances.length > 0 ? ` (${variances.length} differ)` : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* Post dialog — a reason is mandatory when anything differs */}
      {showPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Post this stock take?</h2>

            {variances.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Everything matched the system. Nothing will be adjusted.
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  These differences will be posted as stock adjustments, each with a document number
                  you can find in the adjustment history.
                </p>
                <div className="mt-3 max-h-52 overflow-y-auto rounded-md border">
                  {variances.map((line) => (
                    <div
                      key={line.id}
                      className="flex items-center justify-between border-b px-3 py-2 text-sm last:border-0"
                    >
                      <span className="min-w-0 truncate">{line.product_name}</span>
                      <span
                        className={cn(
                          'ml-3 flex-shrink-0 font-semibold',
                          (line.variance ?? 0) > 0 ? 'text-emerald-600' : 'text-red-600',
                        )}
                      >
                        {(line.variance ?? 0) > 0 ? '+' : ''}
                        {line.variance} (expected {line.expected_qty}, counted {line.counted_qty})
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <label className="block text-sm font-medium">
                    Why do these differ? <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={2}
                    placeholder="e.g. Two rods damaged in the flood, written off. One rod found on the display rack."
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    This is written into the stock ledger. Without it, the loss cannot be explained
                    later.
                  </p>
                </div>
              </>
            )}

            {uncounted.length > 0 && (
              <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                {uncounted.length} line{uncounted.length === 1 ? '' : 's'} were never counted. They
                will be left alone — no adjustment for an uncounted line.
              </p>
            )}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setShowPost(false)}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Keep counting
              </button>
              <button
                onClick={() => post.mutate()}
                disabled={post.isPending || (variances.length > 0 && !reason.trim())}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {post.isPending ? 'Posting...' : 'Post stock take'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showCancel}
        onOpenChange={setShowCancel}
        title="Cancel this stock take?"
        description="Nothing will be posted and no stock will move. The count is kept for the record."
        confirmText="Cancel count"
        variant="destructive"
        onConfirm={() => cancel.mutate()}
        isLoading={cancel.isPending}
      />
    </div>
  )
}

function LineRow({
  line,
  active,
  editable,
  onSelect,
}: {
  line: StockTakeCountLine
  active: boolean
  editable: boolean
  onSelect: () => void
}) {
  const counted = line.counted_qty !== null
  const variance = line.variance ?? 0
  const matches = counted && variance === 0

  return (
    <button
      onClick={editable ? onSelect : undefined}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
        editable && 'hover:bg-gray-50',
        active && 'bg-primary/5',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{line.product_name}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {line.product_code}
          {line.tracking_mode === 'SERIALIZED' ? ' · serial' : ' · bulk'}
        </p>
      </div>

      <div className="flex-shrink-0 text-right">
        <p
          className={cn(
            'font-bold',
            !counted ? 'text-gray-400' : matches ? 'text-emerald-600' : 'text-red-600',
          )}
        >
          {counted ? line.counted_qty : '—'}
          <span className="text-sm font-normal text-muted-foreground">/{line.expected_qty}</span>
        </p>
        {!counted ? (
          <span className="text-xs text-muted-foreground">not counted</span>
        ) : matches ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> matches
          </span>
        ) : (
          <span className="text-xs font-medium text-red-600">
            {variance > 0 ? `+${variance} found` : `${variance} missing`}
          </span>
        )}
      </div>
    </button>
  )
}
