import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { stockTakesApi } from '@/api/stockTakes'
import { warehouseApi } from '@/api/warehouse'
import { useProducts } from '@/hooks/useProducts'
import LoadingSpinner from '@/components/LoadingSpinner'
import { cn, formatDate } from '@/lib/utils'
import { ClipboardList, Play, Plus, X } from 'lucide-react'
import type { StockTakeSession } from '@/types'

const STATUS_STYLES: Record<string, string> = {
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
  DRAFT: 'bg-blue-100 text-blue-700',
}

/**
 * Stock take sessions.
 *
 * The point is to *find* the mess rather than argue about it: freeze what the
 * system believes, count the shelf, and turn every difference into a documented
 * adjustment.
 */
export default function StockTakes() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showStart, setShowStart] = useState(false)
  const [error, setError] = useState('')

  const [scope, setScope] = useState<'LOCATION' | 'PRODUCT' | 'ALL'>('LOCATION')
  const [locationId, setLocationId] = useState('')
  const [productId, setProductId] = useState('')
  const [notes, setNotes] = useState('')
  const [instructions, setInstructions] = useState('')

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['stock-takes'],
    queryFn: () => stockTakesApi.list().then((res) => res.data),
  })

  const { data: locations } = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => warehouseApi.listLocations().then((res) => res.data),
    enabled: showStart,
  })

  const { data: products } = useProducts({ page_size: 100, search: undefined })

  const start = useMutation({
    mutationFn: () =>
      stockTakesApi.start({
        scope,
        location_id: scope === 'LOCATION' && locationId ? Number(locationId) : undefined,
        product_id: scope === 'PRODUCT' && productId ? Number(productId) : undefined,
        notes: notes || undefined,
        instructions: instructions || undefined,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['stock-takes'] })
      setShowStart(false)
      navigate(`/app/warehouse/stock-takes/${response.data.id}`)
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Could not start the stock take')
    },
  })

  const canStart =
    (scope === 'LOCATION' && !!locationId) ||
    (scope === 'PRODUCT' && !!productId) ||
    scope === 'ALL'

  const open = (sessions || []).filter((s) => s.status === 'IN_PROGRESS')
  const closed = (sessions || []).filter((s) => s.status !== 'IN_PROGRESS')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Stock Takes</h1>
            <p className="text-sm text-muted-foreground">
              Count what is actually on the shelf, and turn every difference into a documented
              adjustment.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowStart((open) => !open)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {showStart ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showStart ? 'Cancel' : 'Start a count'}
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {showStart && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">What are you counting?</h2>

          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                { value: 'LOCATION', title: 'One location', hint: 'Rack, showroom or returns bin' },
                { value: 'ALL', title: 'Whole warehouse', hint: 'Every active product' },
                { value: 'PRODUCT', title: 'One product', hint: 'Chase a single line' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                onClick={() => setScope(option.value)}
                className={cn(
                  'rounded-md border p-3 text-left transition-colors',
                  scope === option.value ? 'border-primary bg-primary/5' : 'hover:bg-gray-50',
                )}
              >
                <p className="text-sm font-medium">{option.title}</p>
                <p className="text-xs text-muted-foreground">{option.hint}</p>
              </button>
            ))}
          </div>

          {scope === 'LOCATION' && (
            <div className="mt-3">
              <label className="block text-sm font-medium">Location</label>
              <select
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="">Choose a location...</option>
                {(locations || []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} · {location.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                A location count covers serialized goods only. Bulk stock (lures, hooks) is not
                tracked per location in this system, so its expected figure would be a whole-company
                number in disguise.
              </p>
            </div>
          )}

          {scope === 'PRODUCT' && (
            <div className="mt-3">
              <label className="block text-sm font-medium">Product</label>
              <select
                value={productId}
                onChange={(event) => setProductId(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              >
                <option value="">Choose a product...</option>
                {(products?.items || []).map((product: any) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {product.obm_item_code || product.item_code}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Notes</label>
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="e.g. Year-end count"
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Instructions for the counter</label>
              <input
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="e.g. Include the rods on the display rack"
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
          </div>

          <button
            onClick={() => start.mutate()}
            disabled={!canStart || start.isPending}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {start.isPending ? 'Starting...' : 'Start counting'}
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
                {open.map((session) => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </div>
            </div>
          )}

          <div>
            {open.length > 0 && (
              <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">
                Past counts
              </h2>
            )}
            <div className="space-y-3">
              {closed.map((session) => (
                <SessionCard key={session.id} session={session} />
              ))}
              {closed.length === 0 && open.length === 0 && (
                <div className="rounded-lg border bg-white py-12 text-center">
                  <ClipboardList className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">No stock takes yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Start one when you want to check the shelf against the system.
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

function SessionCard({ session }: { session: StockTakeSession }) {
  return (
    <Link
      to={`/app/warehouse/stock-takes/${session.id}`}
      className="block rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{session.session_number}</span>
            <span
              className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[session.status])}
            >
              {session.status.replace(/_/g, ' ')}
            </span>
            {session.variance_lines > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                {session.variance_lines} difference{session.variance_lines === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {session.scope === 'LOCATION'
              ? session.location_name || 'Location'
              : session.scope === 'ALL'
                ? 'Whole warehouse'
                : 'Single product'}
            {session.started_by_name ? ` · ${session.started_by_name}` : ''}
            {session.started_at ? ` · ${formatDate(session.started_at)}` : ''}
          </p>
          {session.status === 'COMPLETED' && (
            <p className="mt-1 text-xs text-muted-foreground">
              Net {session.net_variance > 0 ? '+' : ''}
              {session.net_variance} units
              {session.completion_notes ? ` · ${session.completion_notes}` : ''}
            </p>
          )}
        </div>

        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-semibold">
            {session.counted_lines}/{session.total_lines}
          </p>
          <p className="text-xs text-muted-foreground">counted</p>
        </div>
      </div>

      {session.status === 'IN_PROGRESS' && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(session.progress_percent, 100)}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  )
}
