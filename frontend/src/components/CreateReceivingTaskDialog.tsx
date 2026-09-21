import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { purchaseOrdersApi } from '@/api/purchaseOrders'
import { warehouseApi } from '@/api/warehouse'
import { useUsers } from '@/hooks/useUsers'
import LoadingSpinner from '@/components/LoadingSpinner'
import { WORKER_ROLES, cn } from '@/lib/utils'
import { ClipboardCheck, SplitSquareHorizontal, User as UserIcon, X } from 'lucide-react'

interface CreateReceivingTaskDialogProps {
  purchaseOrderId: number
  purchaseOrderNumber: string
  open: boolean
  onClose: () => void
}

/**
 * Turn a purchase order into warehouse work.
 *
 * The whole PO usually goes to one store keeper, so that is the default. The
 * "split" toggle exists for the case where one worker is counting rods while
 * another handles reels — each gets their own task with only their lines.
 *
 * Quantities shown here already exclude what open tasks have claimed, so
 * issuing a task twice can never double-count a delivery.
 */
export default function CreateReceivingTaskDialog({
  purchaseOrderId,
  purchaseOrderNumber,
  open,
  onClose,
}: CreateReceivingTaskDialogProps) {
  const navigate = useNavigate()
  const [split, setSplit] = useState(false)
  const [assignedTo, setAssignedTo] = useState('')
  const [priority, setPriority] = useState('NORMAL')
  const [dueDate, setDueDate] = useState('')
  const [locationId, setLocationId] = useState('')
  const [instructions, setInstructions] = useState('')
  const [lineAssignees, setLineAssignees] = useState<Record<number, string>>({})
  const [error, setError] = useState('')

  const { data: preview, isLoading } = useQuery({
    queryKey: ['po-receiving-lines', purchaseOrderId],
    queryFn: () => purchaseOrdersApi.receivingLines(purchaseOrderId).then((res) => res.data),
    enabled: open,
  })

  const { data: users } = useUsers()
  const { data: locations } = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => warehouseApi.listLocations().then((res) => res.data),
    enabled: open,
  })

  const workers = useMemo(
    () =>
      Array.isArray(users)
        ? users.filter((user) => user.is_active && WORKER_ROLES.includes(user.role))
        : [],
    [users],
  )

  // Only lines with something left to receive can be assigned.
  const outstandingLines = useMemo(
    () => (preview?.lines || []).filter((line) => line.quantity_outstanding > 0),
    [preview],
  )

  useEffect(() => {
    if (!open) {
      setError('')
      setSplit(false)
      setLineAssignees({})
    }
  }, [open])

  const createTasks = useMutation({
    mutationFn: () => {
      const common = {
        priority,
        due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
        location_id: locationId ? Number(locationId) : undefined,
        instructions: instructions || undefined,
      }

      if (split) {
        return purchaseOrdersApi.createReceivingTasks(purchaseOrderId, {
          mode: 'SPLIT',
          ...common,
          assignments: outstandingLines.map((line) => ({
            assigned_to: lineAssignees[line.purchase_order_line_id]
              ? Number(lineAssignees[line.purchase_order_line_id])
              : assignedTo
                ? Number(assignedTo)
                : undefined,
            purchase_order_line_ids: [line.purchase_order_line_id],
          })),
        })
      }

      return purchaseOrdersApi.createReceivingTasks(purchaseOrderId, {
        mode: 'WHOLE',
        assigned_to: assignedTo ? Number(assignedTo) : undefined,
        ...common,
      })
    },
    onSuccess: (response) => {
      const tasks = response.data.tasks as { id: number }[]
      onClose()
      if (tasks.length === 1) {
        navigate(`/app/warehouse/tasks/${tasks[0].id}`)
      } else {
        navigate('/app/warehouse/tasks')
      }
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      if (detail && typeof detail === 'object') {
        setError(detail.message || 'Could not create the receiving task')
      } else {
        setError(typeof detail === 'string' ? detail : 'Could not create the receiving task')
      }
    },
  })

  if (!open) return null

  const openTasks = preview?.open_receiving_tasks || []

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-2xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <h2 className="text-lg font-semibold">Issue receiving task</h2>
            <p className="text-sm text-muted-foreground">
              {purchaseOrderNumber} · {preview?.supplier_name}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

          {openTasks.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {openTasks.length} task{openTasks.length === 1 ? '' : 's'} already open on this PO
              {' '}({openTasks.map((task) => task.task_number).join(', ')}). The quantities below
              already exclude what those tasks are counting.
            </div>
          )}

          {/*
            OBM's opinion, before anyone is sent to count. A line OBM considers
            delivered but this app has no receipt for is either a delivery nobody
            booked in here or a receipt from before this system — a human decides
            which. Sending someone to count goods that arrived months ago is how a
            task list stops being trusted.
          */}
          {preview?.obm_note && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <span className="font-medium">OBM disagrees — check before issuing. </span>
              {preview.obm_note}
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : outstandingLines.length === 0 ? (
            <div className="rounded-md bg-gray-50 p-6 text-center text-sm text-muted-foreground">
              Nothing left to receive on this purchase order.
            </div>
          ) : (
            <>
              {/* What will be counted */}
              <div className="rounded-md border">
                <div className="flex items-center justify-between border-b bg-gray-50 px-3 py-2">
                  <span className="text-sm font-medium">
                    To count ({outstandingLines.length} line
                    {outstandingLines.length === 1 ? '' : 's'})
                  </span>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={split}
                      onChange={(event) => setSplit(event.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <SplitSquareHorizontal className="h-4 w-4 text-muted-foreground" />
                    Split across workers
                  </label>
                </div>
                <div className="divide-y">
                  {outstandingLines.map((line) => (
                    <div key={line.purchase_order_line_id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{line.product_name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{line.product_code}</p>
                      </div>
                      <span
                        className={cn(
                          'flex-shrink-0 rounded px-1.5 py-0.5 text-xs',
                          line.inventory_model === 'SERIALIZED'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-gray-100 text-gray-600',
                        )}
                      >
                        {line.inventory_model === 'SERIALIZED' ? 'serial' : 'bulk'}
                      </span>
                      <span className="flex-shrink-0 text-sm font-semibold">
                        {line.quantity_outstanding}
                        <span className="text-xs font-normal text-muted-foreground">
                          {' '}of {line.quantity_ordered}
                        </span>
                      </span>
                      {split && (
                        <select
                          value={lineAssignees[line.purchase_order_line_id] ?? ''}
                          onChange={(event) =>
                            setLineAssignees({
                              ...lineAssignees,
                              [line.purchase_order_line_id]: event.target.value,
                            })
                          }
                          className="h-9 w-40 flex-shrink-0 rounded-md border px-2 text-sm"
                        >
                          <option value="">Use default</option>
                          {workers.map((worker) => (
                            <option key={worker.id} value={worker.id}>
                              {worker.full_name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Assignment */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium">
                    {split ? 'Default worker' : 'Assign to'}
                  </label>
                  <select
                    value={assignedTo}
                    onChange={(event) => setAssignedTo(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                  >
                    <option value="">Leave unassigned</option>
                    {workers.map((worker) => (
                      <option key={worker.id} value={worker.id}>
                        {worker.full_name} · {worker.role.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  {split && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Lines without their own worker use this one.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium">Priority</label>
                  <select
                    value={priority}
                    onChange={(event) => setPriority(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                  >
                    <option value="LOW">Low</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium">Due date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium">Store at</label>
                  <select
                    value={locationId}
                    onChange={(event) => setLocationId(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
                  >
                    <option value="">Not specified</option>
                    {(locations || []).map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.code} · {location.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium">Instructions for the store keeper</label>
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  rows={2}
                  placeholder="e.g. Check for cracked rod tips before accepting. Reject water-damaged cartons."
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t p-4 sm:flex-row sm:justify-end">
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => createTasks.mutate()}
            disabled={createTasks.isPending || outstandingLines.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {split ? <SplitSquareHorizontal className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
            {createTasks.isPending
              ? 'Creating...'
              : split
                ? `Create ${outstandingLines.length} tasks`
                : 'Create task'}
          </button>
        </div>

        <div className="border-t bg-gray-50 px-4 py-2 text-xs text-muted-foreground">
          <UserIcon className="mr-1 inline h-3 w-3" />
          The worker gets a notification and can start counting straight from their phone.
        </div>
      </div>
    </div>
  )
}
