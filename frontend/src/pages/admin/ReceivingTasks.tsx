import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { warehouseApi } from '@/api/warehouse'
import { purchaseOrdersApi } from '@/api/purchaseOrders'
import { useUsers } from '@/hooks/useUsers'
import LoadingSpinner from '@/components/LoadingSpinner'
import InstallHint from '@/components/InstallHint'
import { WORKER_ROLES, cn, formatDateShort } from '@/lib/utils'
import {
  AlertTriangle,
  CalendarDays,
  ClipboardCheck,
  Plus,
  User as UserIcon,
  X,
} from 'lucide-react'
import type { ReceivingTask } from '@/types'

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  ASSIGNED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-red-100 text-red-700',
}

const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'text-gray-500',
  NORMAL: 'text-gray-700',
  HIGH: 'text-red-600',
}

/**
 * Receiving tasks: the hand-off between "the supplier says it shipped" and
 * "the goods are counted and in stock".
 *
 * The purchase manager issues a task against a PO; the storekeeper opens it
 * on their phone and scans each item. Nothing touches stock until the task is
 * completed, so a half-finished count can never corrupt inventory.
 */
export default function ReceivingTasks() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showMine, setShowMine] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState('')

  const [draft, setDraft] = useState({
    purchase_order_id: '',
    supplier_name: '',
    assigned_to: '',
    priority: 'NORMAL',
    due_date: '',
    location_id: '',
    instructions: '',
  })

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['receiving-tasks', showMine, statusFilter],
    queryFn: () =>
      warehouseApi
        .listTasks({ mine: showMine, status: statusFilter || undefined })
        .then((res) => res.data),
  })

  const { data: openPOs } = useQuery({
    queryKey: ['purchase-orders', 'open'],
    queryFn: () => purchaseOrdersApi.listOpen().then((res) => res.data),
    enabled: showCreate,
  })

  const { data: users } = useUsers()
  const { data: locations } = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => warehouseApi.listLocations().then((res) => res.data),
    enabled: showCreate,
  })

  const workers = useMemo(
    () => (Array.isArray(users) ? users.filter((u) => u.is_active && WORKER_ROLES.includes(u.role)) : []),
    [users],
  )

  const createTask = useMutation({
    mutationFn: () =>
      warehouseApi.createTask({
        purchase_order_id: draft.purchase_order_id ? Number(draft.purchase_order_id) : undefined,
        supplier_name: draft.supplier_name || undefined,
        assigned_to: draft.assigned_to ? Number(draft.assigned_to) : undefined,
        priority: draft.priority,
        due_date: draft.due_date ? new Date(draft.due_date).toISOString() : undefined,
        location_id: draft.location_id ? Number(draft.location_id) : undefined,
        instructions: draft.instructions || undefined,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['receiving-tasks'] })
      setShowCreate(false)
      setError('')
      navigate(`/app/warehouse/tasks/${response.data.id}`)
    },
    onError: (err: any) =>
      setError(err?.response?.data?.detail || 'Could not create the receiving task'),
  })

  const counts = useMemo(() => {
    const list = tasks || []
    return {
      open: list.filter((t) => t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS').length,
      completed: list.filter((t) => t.status === 'COMPLETED').length,
      total: list.length,
    }
  }, [tasks])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Receiving Tasks</h1>
            <p className="text-sm text-muted-foreground">
              Assign a delivery to a storekeeper, then track the count to completion.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate((open) => !open)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {showCreate ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showCreate ? 'Cancel' : 'New task'}
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <InstallHint />

      {/* Create panel */}
      {showCreate && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Issue a receiving task</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium">Purchase order</label>
              <select
                value={draft.purchase_order_id}
                onChange={(event) => {
                  const id = event.target.value
                  const po = (openPOs || []).find((item) => String(item.id) === id)
                  setDraft({
                    ...draft,
                    purchase_order_id: id,
                    supplier_name: po?.supplier_name || draft.supplier_name,
                  })
                }}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="">No PO — ad-hoc delivery</option>
                {(openPOs || []).map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.po_number} · {po.supplier_name} · {po.lines?.reduce((sum, l) => sum + (l.quantity_outstanding || 0), 0) ?? 0} outstanding
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Lines are copied from the PO's outstanding quantities. Without a PO you can still log an
                ad-hoc count, but stock will move without a PO reference.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium">Supplier</label>
              <input
                value={draft.supplier_name}
                onChange={(event) => setDraft({ ...draft, supplier_name: event.target.value })}
                placeholder="Auto-filled from PO"
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Assign to</label>
              <select
                value={draft.assigned_to}
                onChange={(event) => setDraft({ ...draft, assigned_to: event.target.value })}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="">Unassigned (draft)</option>
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.full_name} · {worker.role.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Priority</label>
              <select
                value={draft.priority}
                onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
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
                value={draft.due_date}
                onChange={(event) => setDraft({ ...draft, due_date: event.target.value })}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Store at</label>
              <select
                value={draft.location_id}
                onChange={(event) => setDraft({ ...draft, location_id: event.target.value })}
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
            <div className="lg:col-span-3">
              <label className="block text-sm font-medium">Instructions for the storekeeper</label>
              <textarea
                value={draft.instructions}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                rows={2}
                placeholder="e.g. Check for cracked rod tips before accepting. Reject water-damaged cartons."
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            onClick={() => createTask.mutate()}
            disabled={createTask.isPending || (!draft.purchase_order_id && !draft.supplier_name)}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <ClipboardCheck className="h-4 w-4" />
            {createTask.isPending ? 'Creating...' : 'Create & assign'}
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4 shadow-sm">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showMine}
            onChange={(event) => setShowMine(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Only my tasks
        </label>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="h-9 rounded-md border px-3 text-sm"
        >
          <option value="">All statuses</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <div className="ml-auto flex gap-4 text-sm text-muted-foreground">
          <span>Open: <strong className="text-gray-800">{counts.open}</strong></span>
          <span>Completed: <strong className="text-gray-800">{counts.completed}</strong></span>
          <span>Total: <strong className="text-gray-800">{counts.total}</strong></span>
        </div>
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="space-y-3">
          {(tasks || []).map((task: ReceivingTask) => (
            <TaskCard key={task.id} task={task} />
          ))}
          {!tasks?.length && (
            <div className="rounded-lg border bg-white py-12 text-center text-muted-foreground">
              No receiving tasks yet. Create one when a delivery is expected.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TaskCard({ task }: { task: ReceivingTask }) {
  const overdue =
    task.due_date &&
    task.status !== 'COMPLETED' &&
    task.status !== 'CANCELLED' &&
    new Date(task.due_date) < new Date()

  return (
    <Link
      to={`/app/warehouse/tasks/${task.id}`}
      className="block rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{task.task_number}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[task.status])}>
              {task.status.replace(/_/g, ' ')}
            </span>
            {task.priority !== 'NORMAL' && (
              <span className={cn('text-xs font-medium', PRIORITY_STYLES[task.priority])}>
                {task.priority}
              </span>
            )}
            {overdue && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                <AlertTriangle className="h-3 w-3" /> Overdue
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {task.supplier_name || 'Unknown supplier'}
            {task.po_number ? ` · ${task.po_number}` : ''}
            {task.location_name ? ` · ${task.location_name}` : ''}
          </p>
        </div>

        <div className="text-right text-xs text-muted-foreground">
          <p className="inline-flex items-center gap-1">
            <UserIcon className="h-3 w-3" />
            {task.assigned_to_name || 'Unassigned'}
          </p>
          {task.due_date && (
            <p className="inline-flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              due {formatDateShort(task.due_date)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {task.total_scanned} / {task.total_expected} counted
          </span>
          <span>{task.progress_percent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              task.progress_percent >= 100 ? 'bg-emerald-500' : 'bg-primary',
            )}
            style={{ width: `${Math.min(task.progress_percent, 100)}%` }}
          />
        </div>
      </div>
    </Link>
  )
}
