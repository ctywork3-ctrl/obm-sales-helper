import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { transfersApi } from '@/api/transfers'
import { warehouseApi } from '@/api/warehouse'
import LoadingSpinner from '@/components/LoadingSpinner'
import { cn, formatDate } from '@/lib/utils'
import { ArrowRightLeft, Plus, Trash2, Truck, X } from 'lucide-react'
import type { StockTransfer, TransferableProduct } from '@/types'

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-blue-100 text-blue-700',
  IN_TRANSIT: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
}

/**
 * Moving stock between locations.
 *
 * A transfer never changes a quantity — it only changes where a unit is. So a
 * transfer can never be confused with a stock loss, which is exactly why it is
 * its own document rather than an adjustment.
 */
export default function Transfers() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState('')

  const [fromLocationId, setFromLocationId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ product_id: number; quantity: number }[]>([])

  const { data: transfers, isLoading } = useQuery({
    queryKey: ['transfers'],
    queryFn: () => transfersApi.list().then((res) => res.data),
  })

  const { data: locations } = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => warehouseApi.listLocations().then((res) => res.data),
    enabled: showCreate,
  })

  // Only what is actually available at the source can be sent.
  const { data: transferable } = useQuery({
    queryKey: ['transferable', fromLocationId],
    queryFn: () => transfersApi.transferable(Number(fromLocationId)).then((res) => res.data),
    enabled: showCreate && !!fromLocationId,
  })

  const create = useMutation({
    mutationFn: () =>
      transfersApi.create({
        from_location_id: Number(fromLocationId),
        to_location_id: Number(toLocationId),
        notes: notes || undefined,
        lines,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] })
      setShowCreate(false)
      setLines([])
      navigate(`/app/warehouse/transfers/${response.data.id}`)
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Could not create the transfer')
    },
  })

  const available: TransferableProduct[] = transferable || []
  const chosenIds = new Set(lines.map((line) => line.product_id))
  const canCreate =
    fromLocationId && toLocationId && fromLocationId !== toLocationId && lines.length > 0

  const open = (transfers || []).filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
  const closed = (transfers || []).filter((t) => t.status === 'COMPLETED' || t.status === 'CANCELLED')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ArrowRightLeft className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Stock Transfers</h1>
            <p className="text-sm text-muted-foreground">
              Move rods between racks, the showroom and returns — with a scan at each end.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate((open) => !open)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {showCreate ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showCreate ? 'Cancel' : 'New transfer'}
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {showCreate && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Move stock from A to B</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">From</label>
              <select
                value={fromLocationId}
                onChange={(event) => {
                  setFromLocationId(event.target.value)
                  setLines([])
                }}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="">Choose the source...</option>
                {(locations || []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} · {location.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">To</label>
              <select
                value={toLocationId}
                onChange={(event) => setToLocationId(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="">Choose the destination...</option>
                {(locations || [])
                  .filter((location) => String(location.id) !== fromLocationId)
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} · {location.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-sm font-medium">Notes</label>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="e.g. Moving the display stock back to the warehouse"
              className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
            />
          </div>

          {fromLocationId && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium">
                What to move
                <span className="ml-2 font-normal text-muted-foreground">
                  {available.length} product{available.length === 1 ? '' : 's'} available here
                </span>
              </p>

              {available.length === 0 ? (
                <div className="rounded-md bg-gray-50 p-4 text-center text-sm text-muted-foreground">
                  Nothing is recorded at this location. Bulk stock (lures, hooks) has no location,
                  so only serialized rods can be transferred.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  {available.map((product) => {
                    const chosen = lines.find((line) => line.product_id === product.product_id)
                    return (
                      <div
                        key={product.product_id}
                        className="flex items-center gap-3 border-b px-3 py-2 last:border-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{product.product_name}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {product.product_code} · {product.available_here} here
                          </p>
                        </div>
                        {chosen ? (
                          <div className="flex flex-shrink-0 items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={product.available_here}
                              value={chosen.quantity}
                              onChange={(event) =>
                                setLines(
                                  lines.map((line) =>
                                    line.product_id === product.product_id
                                      ? {
                                          ...line,
                                          quantity: Math.min(
                                            Number(event.target.value) || 1,
                                            product.available_here,
                                          ),
                                        }
                                      : line,
                                  ),
                                )
                              }
                              className="h-9 w-16 rounded-md border px-2 text-sm"
                            />
                            <button
                              onClick={() =>
                                setLines(lines.filter((line) => line.product_id !== product.product_id))
                              }
                              className="rounded-md p-1.5 text-destructive hover:bg-red-50"
                              title="Remove"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() =>
                              setLines([...lines, { product_id: product.product_id, quantity: 1 }])
                            }
                            className="flex-shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
                          >
                            Add
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {chosenIds.size > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {lines.reduce((total, line) => total + line.quantity, 0)} unit(s) to move
                </p>
              )}
            </div>
          )}

          <button
            onClick={() => create.mutate()}
            disabled={!canCreate || create.isPending}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Truck className="h-4 w-4" />
            {create.isPending ? 'Creating...' : 'Create transfer'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">
                In progress
              </h2>
              <div className="space-y-3">
                {open.map((transfer) => (
                  <TransferCard key={transfer.id} transfer={transfer} />
                ))}
              </div>
            </div>
          )}

          <div>
            {open.length > 0 && (
              <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">
                Past transfers
              </h2>
            )}
            <div className="space-y-3">
              {closed.map((transfer) => (
                <TransferCard key={transfer.id} transfer={transfer} />
              ))}
              {closed.length === 0 && open.length === 0 && (
                <div className="rounded-lg border bg-white py-12 text-center">
                  <ArrowRightLeft className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">No transfers yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Use a transfer whenever stock physically moves between locations.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TransferCard({ transfer }: { transfer: StockTransfer }) {
  const inFlight = transfer.dispatched_units - transfer.received_units

  return (
    <Link
      to={`/app/warehouse/transfers/${transfer.id}`}
      className="block rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{transfer.transfer_number}</span>
            <span
              className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[transfer.status])}
            >
              {transfer.status.replace(/_/g, ' ')}
            </span>
            {inFlight > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {inFlight} in flight
              </span>
            )}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="truncate">{transfer.from_location_name}</span>
            <Truck className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{transfer.to_location_name}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {transfer.created_by_name}
            {transfer.created_at ? ` · ${formatDate(transfer.created_at)}` : ''}
          </p>
        </div>

        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-semibold">
            {transfer.received_units}/{transfer.total_units}
          </p>
          <p className="text-xs text-muted-foreground">arrived</p>
        </div>
      </div>
    </Link>
  )
}
