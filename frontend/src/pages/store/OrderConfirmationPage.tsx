import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { storeCheckoutApi, StoreOrder } from '@/api/store'
import LoadingSpinner from '@/components/LoadingSpinner'
import { formatCurrency, formatDate } from '@/lib/utils'
import { getUploadUrl } from '@/api/client'
import { CheckCircle, Package, ExternalLink } from 'lucide-react'

export default function OrderConfirmationPage() {
  const { id } = useParams<{ id: string }>()

  const { data: order, isLoading } = useQuery({
    queryKey: ['store-order', id],
    queryFn: () => storeCheckoutApi.getOrder(Number(id)).then((res) => res.data),
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="py-16 text-center text-gray-500">
        Order not found
        <div className="mt-4">
          <Link to="/shop" className="text-blue-600 hover:underline">Back to Shop</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-8">
      <div className="text-center">
        {order.status === 'PAID' ? (
          <CheckCircle className="mx-auto h-16 w-16 text-green-500 mb-4" />
        ) : (
          <Package className="mx-auto h-16 w-16 text-blue-500 mb-4" />
        )}
        <h1 className="text-2xl font-bold mb-2">
          {order.status === 'PAID' ? 'Payment Received!' : 'Order Placed'}
        </h1>
        <p className="text-gray-500">
          {order.status === 'PAID'
            ? 'Thank you for your purchase!'
            : 'Complete payment to confirm your order'}
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-gray-500">Order Number</p>
            <p className="font-semibold">{order.order_number}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
            order.status === 'PAID' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
          }`}>
            {order.status}
          </span>
        </div>

        <div className="space-y-2 text-sm border-t pt-4">
          <div className="flex justify-between">
            <span className="text-gray-500">Date</span>
            <span>{formatDate(order.created_at || '')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Subtotal</span>
            <span>{formatCurrency(order.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Shipping</span>
            <span>{order.shipping_cost === 0 ? 'Free' : formatCurrency(order.shipping_cost)}</span>
          </div>
          <div className="flex justify-between font-semibold text-base border-t pt-2">
            <span>Total</span>
            <span className="text-blue-600">{formatCurrency(order.total_amount)}</span>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold mb-4">Items</h2>
        <div className="space-y-3">
          {order.items.map((item) => (
            <div key={item.id} className="flex gap-3">
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                {item.product_image_snapshot ? (
                  <img
                    src={getUploadUrl(item.product_image_snapshot)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.product_name_snapshot}</p>
                <p className="text-xs text-gray-500">Qty: {item.quantity} @ {formatCurrency(item.unit_price)}</p>
              </div>
              <span className="text-sm font-medium">{formatCurrency(item.line_total)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pending payment */}
      {order.status === 'PENDING' && (
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-6 text-center">
          <p className="text-sm text-yellow-800 mb-3">
            Your order is awaiting payment. Please complete payment to confirm.
          </p>
          <Link
            to={`/shop`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Continue Shopping
          </Link>
        </div>
      )}

      <div className="text-center">
        <Link
          to="/shop"
          className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
        >
          <ExternalLink className="h-4 w-4" />
          Continue Shopping
        </Link>
      </div>
    </div>
  )
}
