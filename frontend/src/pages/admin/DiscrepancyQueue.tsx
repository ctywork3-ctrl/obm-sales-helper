import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { warehouseApi } from '@/api/warehouse'
import LoadingSpinner from '@/components/LoadingSpinner'
import { cn, formatDateShort } from '@/lib/utils'
import { AlertTriangle, Check, MessageSquare, PackageX, Truck } from 'lucide-react'
import type { ReceivingDiscrepancy } from '@/types'

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-800',
  ACKNOWLEDGED: 'bg-blue-100 text-blue-700',
  CHASED: 'bg-violet-100 text-violet-700',
  RESOLVED: 'bg-emerald-100 text-emerald-700',
  IGNORED: 'bg-gray-100 text-gray-600',
}

/**
 * Count differences the warehouse reported, grouped by supplier.
 *
 * This is where the short-ship conversation with the supplier happens. The
 * store keeper never had to adjudicate anything — they counted what was on
 * the pallet and the difference landed here.
 */
export default function DiscrepancyQueue() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('OPEN')
  const [supplier, setSupplier] = useState('')
  const [noteFor, setNoteFor] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['discrepancies', statusFilter, supplier],
    queryFn: () =>
      warehouseApi
        .listDiscrepancies({
          status: statusFilter && statusFilter !== 'ALL' ? statusFilter : undefined,
          supplier: supplier || undefined,
        })
        .then((res) => res.data),
  })

  const update = useMutation({
    mutationFn: ({ id, status, resolution_note }: { id: number; status?: string; resolution_note?: string }) =>
      warehouseApi.updateDiscrepancy(id, { status, resolution_note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discrepancies'] })
      setNoteFor(null)
      setNote('')
    },
  })

  const items: ReceivingDiscrepancy[] = data?.items || []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <PackageX className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Receiving discrepancies</h1>
            <p className="text-sm text-muted-foreground">
              Counted quantity did not match the purchase order. Stock was posted at the counted figure —
              these are the differences to take up with the supplier.
            </p>
          </div>
        </div>
        <div className="rounded-lg border bg-white px-4 py-2 shadow-sm">
          <p className="text-xs text-muted-foreground">Open</p>
          <p className="text-xl font-bold">{data?.open_count ?? '—'}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4 shadow-sm">
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="h-9 rounded-md border px-3 text-sm"
        >
          <option value="OPEN">Open</option>
          <option value="ALL">All statuses</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="CHASED">Chased</option>
          <option value="RESOLVED">Resolved</option>
          <option value="IGNORED">Ignored</option>
        </select>
        <input
          value={supplier}
          onChange={(event) => setSupplier(event.target.value)}
          placeholder="Filter by supplier..."
          className="h-9 w-full rounded-md border px-3 text-sm sm:w-64"
        />
      </div>

      {/* Supplier rollup */}
      {data?.by_supplier && data.by_supplier.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.by_supplier.slice(0, 6).map((row) => (
            <div key={row.supplier_name} className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <p className="truncate font-medium">{row.supplier_name}</p>
              </div>
              <div className="mt-2 flex gap-4 text-sm">
                <span className="text-muted-foreground">
                  open <strong className="text-gray-900">{row.open}</strong>
                </span>
                {row.short > 0 && (
                  <span className="text-red-600">short {row.short}</span>
                )}
                {row.over > 0 && (
                  <span className="text-amber-600">over {row.over}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rows */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        item.direction === 'SHORT'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-800',
                      )}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {item.direction === 'SHORT' ? 'Short shipped' : 'Over shipped'} by {item.difference}
                    </span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[item.status])}>
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-1.5 font-medium">{item.product_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{item.product_code}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Expected {item.quantity_expected}, counted {item.quantity_scanned}
                    {item.supplier_name ? ` · ${item.supplier_name}` : ''}
                    {item.task_number ? ` · ${item.task_number}` : ''}
                    {item.created_at ? ` · ${formatDateShort(item.created_at)}` : ''}
                  </p>
                  {item.resolution_note && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      <MessageSquare className="mr-1 inline h-3 w-3" />
                      {item.resolution_note}
                    </p>
                  )}
                </div>

                <div className="flex flex-shrink-0 flex-wrap gap-2">
                  {item.status === 'OPEN' && (
                    <button
                      onClick={() => update.mutate({ id: item.id, status: 'ACKNOWLEDGED' })}
                      className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
                    >
                      Acknowledge
                    </button>
                  )}
                  {(item.status === 'OPEN' || item.status === 'ACKNOWLEDGED') && (
                    <button
                      onClick={() => update.mutate({ id: item.id, status: 'CHASED' })}
                      className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 hover:bg-violet-100"
                    >
                      Chase supplier
                    </button>
                  )}
                  {item.status !== 'RESOLVED' && item.status !== 'IGNORED' && (
                    <>
                      <button
                        onClick={() => {
                          setNoteFor(item.id)
                          setNote(item.resolution_note || '')
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Resolve
                      </button>
                      <button
                        onClick={() => update.mutate({ id: item.id, status: 'IGNORED' })}
                        className="rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-gray-50"
                      >
                        Ignore
                      </button>
                    </>
                  )}
                  {item.purchase_order_id && (
                    <Link
                      to={`/app/purchase-orders/${item.purchase_order_id}`}
                      className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
                    >
                      View PO
                    </Link>
                  )}
                </div>
              </div>

              {noteFor === item.id && (
                <div className="mt-3 rounded-md border border-blue-100 bg-blue-50/50 p-3">
                  <label className="block text-sm font-medium">
                    What happened? (e.g. supplier credited us, replacement sent)
                  </label>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => update.mutate({ id: item.id, status: 'RESOLVED', resolution_note: note })}
                      disabled={update.isPending}
                      className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {update.isPending ? 'Saving...' : 'Mark resolved'}
                    </button>
                    <button
                      onClick={() => setNoteFor(null)}
                      className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {items.length === 0 && (
            <div className="rounded-lg border bg-white py-12 text-center">
              <Check className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
              <p className="font-medium">No discrepancies</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Every recent delivery counted exactly as expected.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
