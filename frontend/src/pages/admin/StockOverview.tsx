import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { warehouseApi } from '@/api/warehouse'
import LoadingSpinner from '@/components/LoadingSpinner'
import SearchInput from '@/components/SearchInput'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  ClipboardCheck,
  Layers,
  Package,
  ShieldCheck,
  Warehouse,
} from 'lucide-react'

/**
 * The single "what do we actually have" screen.
 *
 * Before this page, stock was spread across Scanner / Goods Received /
 * Received History / Adjustments with no one place answering the basic
 * question. This consolidates it: on-hand, how it is tracked, where the
 * serialized units are, and what is running low.
 */
export default function StockOverview() {
  const [search, setSearch] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [includeInactive, setIncludeInactive] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['stock-overview', search, lowStockOnly, includeInactive],
    queryFn: () =>
      warehouseApi
        .stockOverview({
          search: search || undefined,
          low_stock_only: lowStockOnly,
          include_inactive: includeInactive,
        })
        .then((res) => res.data),
  })

  const { data: movements } = useQuery({
    queryKey: ['stock-movements', 'recent'],
    queryFn: () => warehouseApi.stockMovements({ limit: 12 }).then((res) => res.data),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Warehouse className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Stock Overview</h1>
            <p className="text-sm text-muted-foreground">
              Everything on hand, in one place — bulk quantities and tracked serials.
            </p>
          </div>
        </div>
        <Link
          to="/app/warehouse/tasks"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ClipboardCheck className="h-4 w-4" />
          Receiving tasks
        </Link>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Products tracked"
          value={String(data?.total_products ?? '—')}
          icon={<Package className="h-5 w-5" />}
          color="bg-blue-500"
        />
        <StatCard
          label="Serialized items"
          value={String(data?.serialized_count ?? '—')}
          icon={<ShieldCheck className="h-5 w-5" />}
          color="bg-emerald-500"
        />
        <StatCard
          label="Individual units"
          value={String(data?.total_units ?? '—')}
          icon={<Layers className="h-5 w-5" />}
          color="bg-violet-500"
        />
        <StatCard
          label={`Low stock (≤ ${data?.low_stock_threshold ?? 10})`}
          value={String(data?.low_stock_count ?? '—')}
          icon={<AlertTriangle className="h-5 w-5" />}
          color="bg-amber-500"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4 shadow-sm">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search product name or code..."
          className="w-full sm:w-72"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(event) => setLowStockOnly(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Low stock only
        </label>
        <label className="flex items-center gap-2 text-sm" title="Discontinued models still on the shelf">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Include discontinued
        </label>
        <div className="ml-auto flex gap-4 text-sm text-muted-foreground">
          <span>
            Showing <strong className="text-gray-800">{data?.total_products ?? 0}</strong>
            {data?.truncated ? ` of ${data.matched_products}` : ''} products
          </span>
        </div>
      </div>

      {data?.truncated && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This list is capped. Narrow it with the search box to see the rest.
        </div>
      )}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-500">
                <th className="p-3 font-medium">Product</th>
                <th className="p-3 font-medium">Tracking</th>
                <th className="p-3 text-right font-medium">On hand</th>
                <th className="p-3 font-medium">Units</th>
                <th className="p-3 font-medium">Locations</th>
                <th className="p-3 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((item) => (
                <tr key={item.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-3">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.obm_item_code || item.item_code}
                      {item.brand ? ` · ${item.brand}` : ''}
                    </p>
                  </td>
                  <td className="p-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        item.inventory_model === 'SERIALIZED'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-600',
                      )}
                    >
                      {item.inventory_model === 'SERIALIZED' ? 'Serialized' : 'Bulk'}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <span
                      className={cn(
                        'font-semibold',
                        item.is_low_stock ? 'text-red-600' : 'text-gray-800',
                      )}
                    >
                      {item.stock_qty}
                    </span>
                    {item.uom ? <span className="ml-1 text-xs text-muted-foreground">{item.uom}</span> : null}
                  </td>
                  <td className="p-3">
                    {item.inventory_model === 'SERIALIZED' ? (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(item.units_by_status).map(([status, count]) => (
                          <span
                            key={status}
                            className={cn(
                              'rounded px-1.5 py-0.5 text-xs',
                              status === 'AVAILABLE'
                                ? 'bg-green-100 text-green-700'
                                : status === 'RESERVED'
                                  ? 'bg-amber-100 text-amber-700'
                                  : status === 'SOLD'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-gray-100 text-gray-600',
                            )}
                          >
                            {status.toLowerCase()} {count}
                          </span>
                        ))}
                        {!Object.keys(item.units_by_status).length && (
                          <span className="text-xs text-muted-foreground">No units yet</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {Object.keys(item.units_by_location).length ? (
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        {Object.entries(item.units_by_location).map(([location, count]) => (
                          <div key={location}>
                            {location}: <span className="font-medium text-gray-700">{count}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right">{formatCurrency(item.selling_price)}</td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No products match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent movements */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Boxes className="h-4 w-4 text-primary" />
            Recent stock movements
          </h2>
          <Link to="/app/warehouse/receipts" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            Received history <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="space-y-2 text-sm">
          {(movements || []).map((movement: any) => (
            <div key={movement.id} className="flex items-center justify-between border-b pb-2 last:border-0">
              <div className="min-w-0">
                <p className="truncate font-medium">{movement.movement_type}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {movement.reason || movement.source_type} · {movement.created_at ? formatDate(movement.created_at) : ''}
                </p>
              </div>
              <span
                className={cn(
                  'flex-shrink-0 font-semibold',
                  movement.quantity_delta > 0 ? 'text-green-600' : 'text-red-600',
                )}
              >
                {movement.quantity_delta > 0 ? '+' : ''}
                {movement.quantity_delta}
              </span>
            </div>
          ))}
          {!movements?.length && (
            <p className="py-4 text-center text-muted-foreground">No movements recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: string
  icon: React.ReactNode
  color: string
}) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
        <div className={`rounded-full p-2 text-white ${color}`}>{icon}</div>
      </div>
    </div>
  )
}
