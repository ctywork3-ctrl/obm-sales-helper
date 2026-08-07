import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSalesOrders } from '@/hooks/useSalesOrders'
import LoadingSpinner from '@/components/LoadingSpinner'
import SearchInput from '@/components/SearchInput'
import StatusBadge from '@/components/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'

const statuses = ['All', 'SUBMITTED', 'KEYED_TO_OBM', 'REJECTED', 'CANCELLED']

export default function AllOrders() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useSalesOrders({
    search: search || undefined,
    status: status === 'All' ? undefined : status,
    page,
    page_size: 10,
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">All Orders</h1>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search orders..."
          className="w-full sm:w-64"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(s); setPage(1) }}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              status === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : !data?.items?.length ? (
        <div className="py-12 text-center text-muted-foreground">
          No orders found
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((order) => (
            <Link
              key={order.id}
              to={`/sales/orders/${order.id}`}
              className="block rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">{order.order_number}</p>
                  <p className="text-sm text-muted-foreground">
                    {order.customer?.name || 'N/A'} | Salesman: {order.salesman?.full_name || 'N/A'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(order.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-primary">
                    {formatCurrency(order.total_amount)}
                  </span>
                  <StatusBadge status={order.status} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 text-sm">
            Page {page} of {data.pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page === data.pages}
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
