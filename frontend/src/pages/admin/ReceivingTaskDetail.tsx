import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { warehouseApi } from '@/api/warehouse'
import LoadingSpinner from '@/components/LoadingSpinner'
import BarcodeCamera from '@/components/BarcodeCamera'
import ConfirmDialog from '@/components/ConfirmDialog'
import {
  ScanRejected,
  enqueue,
  flushQueue,
  queueLength,
} from '@/lib/offlineQueue'
import { cn, formatDate, formatDateShort } from '@/lib/utils'
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Camera,
  Check,
  CheckCircle2,
  CloudOff,
  Keyboard,
  MoreVertical,
  PackageCheck,
  Printer,
  RefreshCw,
  ScanLine,
  Upload,
} from 'lucide-react'
import type { ReceivingTaskLine } from '@/types'

/**
 * The store keeper's screen — deliberately one page.
 *
 * Everything the worker needs is here: which line they are counting, one input,
 * a running count, and one button. There is no "start" step (scanning starts
 * the task), no separate panels to hunt through, and no decision to make about
 * a supplier short-ship — they count what is on the pallet and tap complete.
 */
export default function ReceivingTaskDetail() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [activeLineId, setActiveLineId] = useState<number | null>(null)
  const [scanValue, setScanValue] = useState('')
  const [scanMessage, setScanMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [bulkValues, setBulkValues] = useState<Record<number, string>>({})
  const [showComplete, setShowComplete] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [mismatch, setMismatch] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [cameraOn, setCameraOn] = useState(true)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [pendingCount, setPendingCount] = useState(0)
  const [flushing, setFlushing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: task, isLoading } = useQuery({
    queryKey: ['receiving-task', taskId],
    queryFn: () => warehouseApi.getTask(taskId).then((res) => res.data),
    enabled: !!taskId,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['receiving-task', taskId] })
    queryClient.invalidateQueries({ queryKey: ['receiving-tasks'] })
  }

  const scan = useMutation({
    mutationFn: (payload: { task_line_id: number; code: string }) => warehouseApi.scan(taskId, payload),
    onSuccess: (response) => {
      const result = response.data
      setScanValue('')
      setScanMessage({
        tone: result.result === 'OK' ? 'ok' : 'warn',
        text: result.message,
      })
      invalidate()
      inputRef.current?.focus()
    },
    onError: (err: any, variables) => {
      // No `response` means the request never reached the server — keep the
      // scan instead of losing it, and let the queue replay it later.
      if (!err?.response) {
        const queued = enqueue({ taskId, taskLineId: variables.task_line_id, code: variables.code })
        setPendingCount(queueLength(taskId))
        setScanValue('')
        setScanMessage({
          tone: 'warn',
          text: queued
            ? `No connection — "${variables.code}" saved on this device and will upload automatically.`
            : `No connection — "${variables.code}" is already waiting to upload.`,
        })
        return
      }
      setScanMessage({ tone: 'warn', text: err.response.data?.detail || 'Scan failed' })
    },
  })

  const setQuantity = useMutation({
    mutationFn: ({ lineId, quantity }: { lineId: number; quantity: number }) =>
      warehouseApi.setLineQuantity(taskId, lineId, quantity),
    onSuccess: invalidate,
    onError: (err: any) => setError(err?.response?.data?.detail || 'Could not save the quantity'),
  })

  const completeTask = useMutation({
    mutationFn: () => warehouseApi.completeTask(taskId, {}),
    onSuccess: (response) => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['stock-overview'] })
      queryClient.invalidateQueries({ queryKey: ['discrepancies'] })
      setShowComplete(false)
      const data = response.data as any
      if (data?.has_discrepancy) {
        setMismatch([
          `Posted at the counted quantity. ${data.discrepancy_summary || ''} — the purchase manager has been notified.`,
        ])
      } else {
        navigate('/app/warehouse/tasks')
      }
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Could not complete the task')
      setShowComplete(false)
    },
  })

  const cancelTask = useMutation({
    mutationFn: () => warehouseApi.cancelTask(taskId),
    onSuccess: () => {
      invalidate()
      navigate('/app/warehouse/tasks')
    },
    onError: (err: any) => setError(err?.response?.data?.detail || 'Could not cancel the task'),
  })

  /**
   * Replay scans that were captured while offline.
   *
   * A scan the server actively refuses (duplicate serial, wrong product) is
   * dropped from the queue — retrying would never succeed. Anything that failed
   * because the network was down stays queued.
   */
  const flushPending = useCallback(async () => {
    if (queueLength(taskId) === 0) {
      setPendingCount(0)
      return
    }
    setFlushing(true)
    try {
      const result = await flushQueue(async (entry) => {
        try {
          const response = await warehouseApi.scan(entry.taskId, {
            task_line_id: entry.taskLineId,
            code: entry.code,
          })
          return { message: response.data?.message }
        } catch (err: any) {
          if (err?.response) {
            throw new ScanRejected(err.response.data?.detail || `"${entry.code}" was rejected`)
          }
          throw err
        }
      }, taskId)

      if (result.sent > 0) invalidate()
      const lastMessage = result.messages[result.messages.length - 1]
      if (lastMessage) {
        setScanMessage({ tone: 'warn', text: lastMessage })
      } else if (result.sent > 0) {
        setScanMessage({
          tone: 'ok',
          text: `Uploaded ${result.sent} scan${result.sent === 1 ? '' : 's'} saved while offline.`,
        })
      }
    } finally {
      setFlushing(false)
      setPendingCount(queueLength(taskId))
    }
  }, [taskId, queryClient])

  // Track connectivity and replay the queue as soon as the signal returns.
  useEffect(() => {
    setPendingCount(queueLength(taskId))
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
  }, [taskId, flushPending])

  const editable = task && task.status !== 'COMPLETED' && task.status !== 'CANCELLED'

  const incompleteLines = useMemo(
    () =>
      (task?.lines || []).filter(
        (line) => line.quantity_expected <= 0 || line.quantity_scanned < line.quantity_expected,
      ),
    [task],
  )

  // Pick the first unfinished line, and follow along as lines complete.
  useEffect(() => {
    if (!task || !editable) return
    const active = task.lines.find((line) => line.id === activeLineId)
    const activeDone =
      active && active.quantity_expected > 0 && active.quantity_scanned >= active.quantity_expected
    if (!active || activeDone) {
      const next = incompleteLines[0]
      if (next) setActiveLineId(next.id)
    }
  }, [task, editable, activeLineId, incompleteLines])

  useEffect(() => {
    if (activeLineId) inputRef.current?.focus()
  }, [activeLineId])

  const activeLine = useMemo(
    () => task?.lines.find((line) => line.id === activeLineId) || null,
    [task, activeLineId],
  )

  const scannedUnits = useMemo(
    () => (task?.lines || []).reduce((total, line) => total + line.units.length, 0),
    [task],
  )

  const remaining = useMemo(
    () => incompleteLines.reduce(
      (total, line) => total + Math.max(0, line.quantity_expected - line.quantity_scanned),
      0,
    ),
    [incompleteLines],
  )

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!task) {
    return <div className="py-12 text-center text-muted-foreground">Task not found</div>
  }

  /**
   * One place that decides what happens to a scanned code.
   *
   * Offline it is queued locally instead of firing a request that will hang for
   * 30 seconds and then fail. Online it goes straight to the server.
   */
  const handleScan = (rawCode: string) => {
    if (!activeLine) return
    const code = rawCode.trim()
    if (!code) return

    if (!online) {
      const queued = enqueue({ taskId, taskLineId: activeLine.id, code })
      setPendingCount(queueLength(taskId))
      setScanValue('')
      setScanMessage({
        tone: 'warn',
        text: queued
          ? `No connection — "${code}" saved on this device and will upload automatically.`
          : `No connection — "${code}" is already waiting to upload.`,
      })
      inputRef.current?.focus()
      return
    }

    scan.mutate({ task_line_id: activeLine.id, code })
  }

  const submitScan = () => handleScan(scanValue)

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/app/warehouse/tasks')}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All tasks
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
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border bg-white py-1 shadow-lg">
                <Link
                  to={`/app/warehouse/labels?task=${task.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <Printer className="h-4 w-4" />
                  Print labels ({scannedUnits})
                </Link>
                {editable && (
                  <button
                    onClick={() => {
                      setShowMenu(false)
                      setShowCancel(true)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-red-50"
                  >
                    <Ban className="h-4 w-4" />
                    Cancel this task
                  </button>
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

      {/* Header — the one number that matters */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-bold">{task.task_number}</h1>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  task.status === 'COMPLETED'
                    ? 'bg-emerald-100 text-emerald-700'
                    : task.status === 'CANCELLED'
                      ? 'bg-gray-100 text-gray-600'
                      : task.status === 'IN_PROGRESS'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-blue-100 text-blue-700',
                )}
              >
                {task.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {task.supplier_name || 'Unknown supplier'}
              {task.po_number ? ` · ${task.po_number}` : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {task.assigned_to_name ? `${task.assigned_to_name}` : 'Unassigned'}
              {task.due_date ? ` · due ${formatDateShort(task.due_date)}` : ''}
              {task.location_name ? ` · ${task.location_name}` : ''}
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="text-3xl font-bold leading-none">
              {task.total_scanned}
              <span className="text-lg font-normal text-muted-foreground">/{task.total_expected}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {remaining > 0 ? `${remaining} to go` : 'all counted'}
            </p>
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              task.progress_percent >= 100 ? 'bg-emerald-500' : 'bg-primary',
            )}
            style={{ width: `${Math.min(task.progress_percent, 100)}%` }}
          />
        </div>

        {task.instructions && (
          <div className="mt-3 rounded-md bg-blue-50 p-3 text-sm text-blue-900">
            <p className="font-medium">Instructions</p>
            <p className="whitespace-pre-line">{task.instructions}</p>
          </div>
        )}
      </div>

      {/* Active line — the only thing being counted right now */}
      {editable && activeLine && (
        <div className="rounded-lg border-2 border-primary/40 bg-white p-4 shadow-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <ScanLine className="h-5 w-5 flex-shrink-0 text-primary" />
              <p className="truncate font-semibold">{activeLine.product_name}</p>
            </div>
            <span className="flex-shrink-0 text-sm font-semibold">
              {activeLine.quantity_scanned}
              <span className="text-muted-foreground">/{activeLine.quantity_expected}</span>
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
                      submitScan()
                    }
                  }}
                  placeholder="Scan or type the serial, then Enter"
                  className="h-14 flex-1 rounded-md border-2 px-3 font-mono text-base"
                  autoComplete="off"
                  inputMode="text"
                />
                <button
                  onClick={submitScan}
                  disabled={!scanValue.trim() || scan.isPending}
                  className="inline-flex h-14 w-20 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                >
                  <Check className="h-6 w-6" />
                </button>
              </div>

              <div className="mt-3">
                {cameraOn ? (
                  <BarcodeCamera onScan={handleScan} />
                ) : (
                  <button
                    onClick={() => setCameraOn(true)}
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
                  >
                    <Camera className="h-4 w-4" />
                    Turn on camera
                  </button>
                )}
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
                  value={bulkValues[activeLine.id] ?? String(activeLine.quantity_scanned || '')}
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
                    quantity: Number(bulkValues[activeLine.id] ?? activeLine.quantity_scanned ?? 0),
                  })
                }
                disabled={setQuantity.isPending}
                className="inline-flex h-14 items-center gap-2 rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
              >
                <Keyboard className="h-5 w-5" />
                Save
              </button>
            </div>
          )}

          {scanMessage && (
            <div
              className={cn(
                'mt-3 flex items-start gap-2 rounded-md p-3 text-sm',
                scanMessage.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800',
              )}
            >
              {scanMessage.tone === 'ok' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              )}
              <span>{scanMessage.text}</span>
            </div>
          )}

          {incompleteLines.length > 1 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Next up: {incompleteLines.find((line) => line.id !== activeLine.id)?.product_name}
            </p>
          )}
        </div>
      )}

      {!editable && (
        <div
          className={cn(
            'rounded-md border p-3 text-sm',
            task.status === 'COMPLETED'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-gray-200 bg-gray-50 text-gray-700',
          )}
        >
          {task.status === 'COMPLETED' ? (
            <>
              This delivery has been counted and the stock posted. Nothing more to do here.
              {task.completed_at ? ` Completed ${formatDate(task.completed_at)}.` : ''}
            </>
          ) : (
            <>
              This task was cancelled, so nothing was counted and no stock moved. Ask the purchase
              manager to issue a new task if the goods still need counting.
            </>
          )}
        </div>
      )}

      {/* The list */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Items ({task.lines.length})</h2>
        </div>
        <div className="divide-y">
          {task.lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              active={line.id === activeLineId}
              editable={!!editable}
              onSelect={() => {
                setActiveLineId(line.id)
                setScanMessage(null)
              }}
            />
          ))}
        </div>
      </div>

      {task.completion_notes && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-1 font-semibold">Completion notes</h2>
          <p className="text-sm text-muted-foreground">{task.completion_notes}</p>
          {task.completed_at && (
            <p className="mt-1 text-xs text-muted-foreground">Completed {formatDate(task.completed_at)}</p>
          )}
        </div>
      )}

      {/* One action */}
      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white p-3 shadow-lg md:left-16 lg:left-64">
          <div className="mx-auto flex max-w-3xl gap-3">
            <Link
              to={`/app/warehouse/labels?task=${task.id}`}
              className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-3 text-sm font-medium hover:bg-gray-50"
            >
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Labels</span>
              <span className="sm:hidden">{scannedUnits}</span>
            </Link>
            <button
              onClick={() => setShowComplete(true)}
              disabled={completeTask.isPending || task.total_scanned === 0 || pendingCount > 0}
              title={
                pendingCount > 0
                  ? 'Upload the scans saved on this device before completing'
                  : undefined
              }
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pendingCount > 0 ? <Upload className="h-5 w-5" /> : <PackageCheck className="h-5 w-5" />}
              {completeTask.isPending
                ? 'Posting...'
                : pendingCount > 0
                  ? `Upload ${pendingCount} scan${pendingCount === 1 ? '' : 's'} first`
                  : 'Complete & post stock'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showComplete}
        onOpenChange={setShowComplete}
        title="Complete and post stock?"
        description={
          remaining > 0
            ? `${remaining} item(s) have not been counted. Whatever is counted will be posted, and the purchase manager will be told about the difference.`
            : 'Everything is counted. Stock will be posted and the serial numbers become sellable inventory.'
        }
        confirmText="Complete & post"
        onConfirm={() => completeTask.mutate()}
        isLoading={completeTask.isPending}
      />

      <ConfirmDialog
        open={showCancel}
        onOpenChange={setShowCancel}
        title="Cancel this receiving task?"
        description="Everything scanned so far will be discarded and no stock will move."
        confirmText="Cancel task"
        variant="destructive"
        onConfirm={() => cancelTask.mutate()}
        isLoading={cancelTask.isPending}
      />

      {/* Informational: the difference is reported, not adjudicated */}
      {mismatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Stock posted</h2>
            </div>
            {mismatch.map((line) => (
              <p key={line} className="text-sm text-gray-700">{line}</p>
            ))}
            <p className="mt-3 text-sm text-muted-foreground">
              You do not need to do anything else — the purchase manager takes it up with the supplier.
            </p>
            <button
              onClick={() => navigate('/app/warehouse/tasks')}
              className="mt-4 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function LineRow({
  line,
  active,
  editable,
  onSelect,
}: {
  line: ReceivingTaskLine
  active: boolean
  editable: boolean
  onSelect: () => void
}) {
  const complete = line.quantity_expected > 0 && line.quantity_scanned === line.quantity_expected
  const over = line.quantity_scanned > line.quantity_expected

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
            complete ? 'text-emerald-600' : over ? 'text-amber-600' : 'text-gray-800',
          )}
        >
          {line.quantity_scanned}
          <span className="text-sm font-normal text-muted-foreground">/{line.quantity_expected}</span>
        </p>
        {complete ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> done
          </span>
        ) : over ? (
          <span className="text-xs text-amber-600">over</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {line.quantity_expected - line.quantity_scanned} to go
          </span>
        )}
      </div>
    </button>
  )
}
