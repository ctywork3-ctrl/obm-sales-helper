import { Link, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '@/contexts/StoreContext'
import { storeCheckoutApi, StoreOrder } from '@/api/store'
import LoadingSpinner from '@/components/LoadingSpinner'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Package, ArrowLeft, Eye } from 'lucide-react'

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  PAID: 'bg-green-100 text-green-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  SHIPPED: 'bg-purple-100 text-purple-800',
  DELIVERED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

export default function StoreOrdersPage() {
  const { customer } = useStore()

  const { data, isLoading } = useQuery({
    queryKey: ['store-orders'],
    queryFn: () => storeCheckoutApi.listOrders({ page: 1, page_size: 20 }).then((res) => res.data),
    enabled: !!customer,
  })

  if (!customer) {
    return <Navigate to="/login?redirect=account/orders" replace />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Orders</h1>
        <Link to="/shop" className="text-sm text-blue-600 hover:underline">Continue Shopping</Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : !data?.items?.length ? (
        <div className="py-12 text-center">
          <Package className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500">No orders yet</p>
          <Link to="/shop" className="mt-4 inline-block text-blue-600 hover:underline">
            Start Shopping
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {data.items.map((order) => (
            <div key={order.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">{order.order_number}</p>
                  <p className="text-sm text-gray-500">{formatDate(order.created_at || '')}</p>
                  <p className="text-xs text-gray-400">{order.items.length} item(s)</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-semibold text-blue-600">{formatCurrency(order.total_amount)}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColors[order.status] || 'bg-gray-100 text-gray-800'}`}>
                    {order.status}
                  </span>
                  <Link
                    to={`/order-confirmation/${order.id}`}
                    className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600"
                  >
                    <Eye className="h-4 w-4" />
                    View
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
