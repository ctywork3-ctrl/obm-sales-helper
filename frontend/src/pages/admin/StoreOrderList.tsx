import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { adminStoreOrdersApi, StoreOrderListItem, StoreOrderStats } from '@/api/adminStoreOrders'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Package, DollarSign, Truck, CheckCircle, Search } from 'lucide-react'
import LoadingSpinner from '@/components/LoadingSpinner'

const statusTabs = ['All', 'PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  PAID: 'bg-green-100 text-green-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  SHIPPED: 'bg-purple-100 text-purple-800',
  DELIVERED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

export default function StoreOrderList() {
  const [status, setStatus] = useState('All')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data: stats } = useQuery<StoreOrderStats>({
    queryKey: ['store-order-stats'],
    queryFn: () => adminStoreOrdersApi.getStats().then((res) => res.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['store-orders', status, search, page],
    queryFn: () =>
      adminStoreOrdersApi.list({
        status: status === 'All' ? undefined : status,
        search: search || undefined,
        page,
        page_size: 20,
      }).then((res) => res.data),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Store Orders</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard
          label="Total"
          value={stats?.total || 0}
          icon={<Package className="h-4 w-4" />}
          color="text-blue-600 bg-blue-100"
        />
        <StatCard
          label="Paid"
          value={stats?.paid || 0}
          icon={<DollarSign className="h-4 w-4" />}
          color="text-green-600 bg-green-100"
        />
        <StatCard
          label="Processing"
          value={stats?.processing || 0}
          icon={<Package className="h-4 w-4" />}
          color="text-blue-600 bg-blue-100"
        />
        <StatCard
          label="Shipped"
          value={stats?.shipped || 0}
          icon={<Truck className="h-4 w-4" />}
          color="text-purple-600 bg-purple-100"
        />
        <StatCard
          label="Revenue"
          value={formatCurrency(stats?.revenue || 0)}
          icon={<CheckCircle className="h-4 w-4" />}
          color="text-green-600 bg-green-100"
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {statusTabs.map((s) => (
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
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search order #..."
            className="w-full rounded-lg border bg-white py-2 pl-10 pr-4 text-sm"
          />
        </div>
      </div>

      {/* Orders */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : !data?.items?.length ? (
        <div className="py-12 text-center text-gray-500">
          No orders found
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}

      {/* Pagination */}
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

function StatCard({ label, value, icon, color, className }: {
  label: string
  value: number | string
  icon: React.ReactNode
  color: string
  className?: string
}) {
  return (
    <div className={`rounded-lg border bg-white p-3 shadow-sm ${className || ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
        <div className={`rounded-full p-1.5 ${color}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function OrderCard({ order }: { order: StoreOrderListItem }) {
  return (
    <Link
      to={`/app/admin/store-orders/${order.id}`}
      className="block rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">{order.order_number}</p>
          <p className="text-sm text-gray-500">
            {order.customer?.full_name || 'Unknown'} - {order.customer?.email || ''}
          </p>
          <p className="text-xs text-gray-400">
            {formatDate(order.created_at || '')} | {order.items.length} item(s)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-semibold text-primary">
            {formatCurrency(order.total_amount)}
          </span>
          <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[order.status] || 'bg-gray-100 text-gray-800'}`}>
            {order.status}
          </span>
        </div>
      </div>
    </Link>
  )
}
