import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { transfersApi } from '@/api/transfers'
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
  CloudOff,
  MoreVertical,
  PackageCheck,
  RefreshCw,
  ScanLine,
  Truck,
} from 'lucide-react'
import type { StockTransferLine } from '@/types'

/**
 * Moving stock between locations — one screen, two phases.
 *
 * The phase is not a toggle the user picks; it follows the transfer's status,
 * because getting it wrong would be a real mistake:
 *
 * * `DRAFT` → **dispatch**. Scanning claims a unit to the transfer. It does *not*
 *   move it yet, because it has not arrived anywhere.
 * * `IN_TRANSIT` → **receive**. This is the scan that actually relocates a unit.
 *
 * So anything sent but never received stays at the source, and shows up as "in
 * flight" rather than silently teleporting stock.
 */
export default function TransferDetail() {
  const { id } = useParams<{ id: string }>()
  const transferId = Number(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [scanValue, setScanValue] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [showDispatch, setShowDispatch] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [pendingCount, setPendingCount] = useState(0)
  const [flushing, setFlushing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: transfer, isLoading } = useQuery({
    queryKey: ['transfer', transferId],
    queryFn: () => transfersApi.get(transferId).then((res) => res.data),
    enabled: !!transferId,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['transfer', transferId] })
    queryClient.invalidateQueries({ queryKey: ['transfers'] })
  }

  // The phase follows the status. Nothing to choose.
  const phase: 'DISPATCH' | 'RECEIVE' | null = !transfer
    ? null
    : transfer.status === 'DRAFT'
      ? 'DISPATCH'
      : transfer.status === 'IN_TRANSIT'
        ? 'RECEIVE'
        : null

  const editable = phase !== null

  const scan = useMutation({
    mutationFn: ({ code, phase: scanPhase }: { code: string; phase: 'DISPATCH' | 'RECEIVE' }) =>
      transfersApi.scan(transferId, code, scanPhase),
    onSuccess: (response) => {
      setScanValue('')
      setMessage({
        tone: response.data.result === 'OK' ? 'ok' : 'warn',
        text: response.data.message,
      })
      invalidate()
      inputRef.current?.focus()
    },
    onError: (err: any, variables) => {
      if (!err?.response) {
        const queued = enqueue({
          taskId: transferId,
          taskLineId: 0,
          code: variables.code,
          phase: variables.phase,
        })
        setPendingCount(queueLength(transferId))
        setScanValue('')
        setMessage({
          tone: 'warn',
          text: queued
            ? `No connection — "${variables.code}" saved on this device and will upload automatically.`
            : `No connection — "${variables.code}" is already waiting to upload.`,
        })
        return
      }
      setMessage({ tone: 'warn', text: err.response.data?.detail || 'Scan failed' })
    },
  })

  const dispatch = useMutation({
    mutationFn: () => transfersApi.dispatch(transferId),
    onSuccess: () => {
      invalidate()
      setShowDispatch(false)
      setMessage({ tone: 'ok', text: 'On its way. Scan each unit in at the destination.' })
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Could not dispatch the transfer')
      setShowDispatch(false)
    },
  })

  const complete = useMutation({
    mutationFn: () => transfersApi.complete(transferId, reason),
    onSuccess: (response) => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['stock-overview'] })
      setShowComplete(false)
      navigate('/app/warehouse/transfers', { state: { posted: response.data.message } })
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setError(detail && typeof detail === 'object' ? detail.message : detail || 'Could not complete')
      setShowComplete(false)
    },
  })

  const cancel = useMutation({
    mutationFn: () => transfersApi.cancel(transferId),
    onSuccess: () => {
      invalidate()
      navigate('/app/warehouse/transfers')
    },
    onError: (err: any) => setError(err?.response?.data?.detail || 'Could not cancel the transfer'),
  })

  const flushPending = useCallback(async () => {
    if (queueLength(transferId) === 0) {
      setPendingCount(0)
      return
    }
    setFlushing(true)
    try {
      const result = await flushQueue(async (entry) => {
        try {
          const response = await transfersApi.scan(
            entry.taskId,
            entry.code,
            (entry.phase as 'DISPATCH' | 'RECEIVE') || 'DISPATCH',
          )
          return { message: response.data?.message }
        } catch (err: any) {
          if (err?.response) {
            throw new ScanRejected(err.response.data?.detail || `"${entry.code}" was rejected`)
          }
          throw err
        }
      }, transferId)

      if (result.sent > 0) invalidate()
      const last = result.messages[result.messages.length - 1]
      if (last) setMessage({ tone: 'warn', text: last })
      else if (result.sent > 0) {
        setMessage({ tone: 'ok', text: `Uploaded ${result.sent} scan${result.sent === 1 ? '' : 's'}.` })
      }
    } finally {
      setFlushing(false)
      setPendingCount(queueLength(transferId))
    }
  }, [transferId])

  useEffect(() => {
    setPendingCount(queueLength(transferId))
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
  }, [transferId, flushPending])

  useEffect(() => {
    if (editable) inputRef.current?.focus()
  }, [editable, phase])

  const lines: StockTransferLine[] = transfer?.lines || []
  const inFlight = (transfer?.dispatched_units || 0) - (transfer?.received_units || 0)

  const outstanding = useMemo(() => {
    if (!transfer) return 0
    return phase === 'DISPATCH'
      ? transfer.total_units - transfer.dispatched_units
      : transfer.dispatched_units - transfer.received_units
  }, [transfer, phase])

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!transfer) {
    return <div className="py-12 text-center text-muted-foreground">Transfer not found</div>
  }

  const handleScan = (rawCode: string) => {
    const code = rawCode.trim()
    if (!code || !phase) return

    if (!online) {
      const queued = enqueue({ taskId: transferId, taskLineId: 0, code, phase })
      setPendingCount(queueLength(transferId))
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

    scan.mutate({ code, phase })
  }

  const progressPercent = transfer.total_units
    ? Math.round(
        100 *
          (phase === 'RECEIVE' ? transfer.received_units : transfer.dispatched_units) /
          transfer.total_units,
      )
    : 0

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/app/warehouse/transfers')}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All transfers
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
                {transfer.status !== 'COMPLETED' && transfer.status !== 'CANCELLED' && (
                  <button
                    onClick={() => {
                      setShowMenu(false)
                      setShowCancel(true)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-red-50"
                  >
                    <Ban className="h-4 w-4" />
                    Cancel this transfer
                  </button>
                )}
                {(transfer.status === 'COMPLETED' || transfer.status === 'CANCELLED') && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    This transfer is {transfer.status.toLowerCase()}.
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold">{transfer.transfer_number}</h1>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium">
                {transfer.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <span>{transfer.from_location_name}</span>
              <Truck className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{transfer.to_location_name}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {transfer.created_by_name}
              {transfer.created_at ? ` · ${formatDate(transfer.created_at)}` : ''}
            </p>
          </div>

          <div className="flex-shrink-0 text-right">
            <p className="text-3xl font-bold leading-none">
              {phase === 'RECEIVE' ? transfer.received_units : transfer.dispatched_units}
              <span className="text-lg font-normal text-muted-foreground">/{transfer.total_units}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {phase === 'DISPATCH'
                ? 'scanned out'
                : phase === 'RECEIVE'
                  ? 'confirmed in'
                  : 'units moved'}
            </p>
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              progressPercent >= 100 ? 'bg-emerald-500' : 'bg-primary',
            )}
            style={{ width: `${Math.min(progressPercent, 100)}%` }}
          />
        </div>

        {phase && (
          <div
            className={cn(
              'mt-3 rounded-md p-3 text-sm',
              phase === 'DISPATCH' ? 'bg-blue-50 text-blue-900' : 'bg-emerald-50 text-emerald-900',
            )}
          >
            {phase === 'DISPATCH' ? (
              <>
                <p className="font-medium">Scan each rod as it leaves {transfer.from_location_name}</p>
                <p className="mt-0.5 text-xs">
                  This records what is going, but does not move anything yet — it has not arrived
                  anywhere. The receiving scan at {transfer.to_location_name} is what moves it.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">Scan each rod as it arrives at {transfer.to_location_name}</p>
                <p className="mt-0.5 text-xs">
                  This is the scan that actually relocates the unit. Anything not scanned in stays
                  recorded at {transfer.from_location_name}.
                </p>
              </>
            )}
          </div>
        )}

        {inFlight > 0 && phase === 'RECEIVE' && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              {inFlight} unit{inFlight === 1 ? '' : 's'} were sent but not yet confirmed as arrived.
            </span>
          </div>
        )}

        {transfer.instructions && (
          <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
            <p className="font-medium">Instructions</p>
            <p className="whitespace-pre-line">{transfer.instructions}</p>
          </div>
        )}
      </div>

      {/* The one input */}
      {editable && (
        <div className="rounded-lg border-2 border-primary/40 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            <p className="font-semibold">
              {phase === 'DISPATCH' ? 'Scan out' : 'Scan in'}
              <span className="ml-2 font-normal text-muted-foreground">
                {outstanding} to go
              </span>
            </p>
          </div>

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

          {message && (
            <div
              className={cn(
                'mt-3 rounded-md p-3 text-sm',
                message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800',
              )}
            >
              {message.text}
            </div>
          )}
        </div>
      )}

      {/* Lines */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Products ({lines.length})</h2>
        </div>
        <div className="divide-y">
          {lines.map((line) => {
            const done =
              phase === 'DISPATCH'
                ? line.quantity_dispatched >= line.quantity_expected
                : line.quantity_received >= line.quantity_expected
            const inFlightLine = line.quantity_dispatched - line.quantity_received
            return (
              <div key={line.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{line.product_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{line.product_code}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className={cn('font-bold', done ? 'text-emerald-600' : 'text-gray-800')}>
                    {phase === 'RECEIVE' ? line.quantity_received : line.quantity_dispatched}
                    <span className="text-sm font-normal text-muted-foreground">
                      /{line.quantity_expected}
                    </span>
                  </p>
                  {inFlightLine > 0 ? (
                    <span className="text-xs text-amber-600">{inFlightLine} in flight</span>
                  ) : done ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" /> done
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {line.quantity_expected - line.quantity_dispatched} to go
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* In flight units */}
      {transfer.in_flight && transfer.in_flight.length > 0 && (
        <div className="rounded-lg border bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">In flight ({transfer.in_flight.length})</h2>
            <p className="text-xs text-muted-foreground">
              Sent but not yet confirmed. Still recorded at {transfer.from_location_name}.
            </p>
          </div>
          <div className="divide-y">
            {transfer.in_flight.map((unit) => (
              <div key={unit.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="min-w-0 truncate">{unit.product_name}</span>
                <span className="ml-3 flex-shrink-0 font-mono text-xs text-muted-foreground">
                  {unit.serial_number}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {transfer.status === 'COMPLETED' && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-1 font-semibold">Completed</h2>
          <p className="text-sm text-muted-foreground">
            {transfer.received_units} of {transfer.total_units} unit(s) moved to{' '}
            {transfer.to_location_name}.
            {transfer.completion_notes ? ` ${transfer.completion_notes}` : ''}
          </p>
        </div>
      )}

      {/* One action */}
      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white p-3 shadow-lg md:left-16 lg:left-64">
          <div className="mx-auto flex max-w-3xl">
            {phase === 'DISPATCH' ? (
              <button
                onClick={() => setShowDispatch(true)}
                disabled={dispatch.isPending || transfer.dispatched_units === 0 || pendingCount > 0}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Truck className="h-5 w-5" />
                {dispatch.isPending
                  ? 'Sending...'
                  : pendingCount > 0
                    ? `Upload ${pendingCount} scan${pendingCount === 1 ? '' : 's'} first`
                    : `On its way (${transfer.dispatched_units}/${transfer.total_units})`}
              </button>
            ) : (
              <button
                onClick={() => setShowComplete(true)}
                disabled={complete.isPending || transfer.received_units === 0 || pendingCount > 0}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <PackageCheck className="h-5 w-5" />
                {complete.isPending
                  ? 'Completing...'
                  : pendingCount > 0
                    ? `Upload ${pendingCount} scan${pendingCount === 1 ? '' : 's'} first`
                    : `Complete transfer (${transfer.received_units}/${transfer.total_units})`}
              </button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDispatch}
        onOpenChange={setShowDispatch}
        title="Send this stock on its way?"
        description={
          outstanding > 0
            ? `${outstanding} unit(s) have not been scanned out. They will stay at ${transfer.from_location_name}.`
            : `All ${transfer.total_units} unit(s) are scanned out. Now scan them in at ${transfer.to_location_name} to actually move them.`
        }
        confirmText="On its way"
        onConfirm={() => dispatch.mutate()}
        isLoading={dispatch.isPending}
      />

      {showComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Complete this transfer?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {transfer.received_units} of {transfer.total_units} unit(s) confirmed arrived at{' '}
              {transfer.to_location_name}.
            </p>

            {inFlight > 0 ? (
              <>
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {inFlight} unit{inFlight === 1 ? '' : 's'} were sent but never confirmed. They will
                  stay recorded at {transfer.from_location_name} and can be moved again later.
                </div>
                <div className="mt-3">
                  <label className="block text-sm font-medium">
                    What happened to them? <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={2}
                    placeholder="e.g. Still on the trolley, will move tomorrow. Or: one rod found damaged in transit."
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Everything arrived. Nothing will be left in flight.
              </p>
            )}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setShowComplete(false)}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Keep scanning
              </button>
              <button
                onClick={() => complete.mutate()}
                disabled={complete.isPending || (inFlight > 0 && !reason.trim())}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {complete.isPending ? 'Completing...' : 'Complete transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showCancel}
        onOpenChange={setShowCancel}
        title="Cancel this transfer?"
        description="Nothing moved, so no stock changes. Any units scanned out are released."
        confirmText="Cancel transfer"
        variant="destructive"
        onConfirm={() => cancel.mutate()}
        isLoading={cancel.isPending}
      />
    </div>
  )
}
