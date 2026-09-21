import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminStoreOrdersApi, StoreOrderListItem } from '@/api/adminStoreOrders'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmDialog from '@/components/ConfirmDialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { getUploadUrl } from '@/api/client'
import { ArrowLeft, Package, Truck, CheckCircle, XCircle, CreditCard, User, MapPin } from 'lucide-react'

const statusActions: Record<string, { label: string; status: string; icon: React.ReactNode; color: string }[]> = {
  PAID: [
    { label: 'Mark Processing', status: 'PROCESSING', icon: <Package className="h-4 w-4" />, color: 'bg-blue-600 text-white hover:bg-blue-700' },
    { label: 'Cancel Order', status: 'CANCELLED', icon: <XCircle className="h-4 w-4" />, color: 'border border-destructive text-destructive hover:bg-red-50' },
  ],
  PROCESSING: [
    { label: 'Mark Shipped', status: 'SHIPPED', icon: <Truck className="h-4 w-4" />, color: 'bg-purple-600 text-white hover:bg-purple-700' },
    { label: 'Cancel Order', status: 'CANCELLED', icon: <XCircle className="h-4 w-4" />, color: 'border border-destructive text-destructive hover:bg-red-50' },
  ],
  SHIPPED: [
    { label: 'Mark Delivered', status: 'DELIVERED', icon: <CheckCircle className="h-4 w-4" />, color: 'bg-green-600 text-white hover:bg-green-700' },
  ],
}

export default function StoreOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const { data: order, isLoading } = useQuery({
    queryKey: ['store-order', id],
    queryFn: () => adminStoreOrdersApi.get(Number(id)).then((res) => res.data),
    enabled: !!id,
  })

  const updateMutation = useMutation({
    mutationFn: (status: string) =>
      adminStoreOrdersApi.updateStatus(Number(id), status, cancelReason || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-order', id] })
      queryClient.invalidateQueries({ queryKey: ['store-orders'] })
      queryClient.invalidateQueries({ queryKey: ['store-order-stats'] })
      setShowCancelDialog(false)
      setCancelReason('')
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="py-12 text-center text-gray-500">
        Order not found
      </div>
    )
  }

  const actions = statusActions[order.status] || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${
          order.status === 'PAID' ? 'bg-green-100 text-green-800' :
          order.status === 'PROCESSING' ? 'bg-blue-100 text-blue-800' :
          order.status === 'SHIPPED' ? 'bg-purple-100 text-purple-800' :
          order.status === 'DELIVERED' ? 'bg-green-100 text-green-800' :
          order.status === 'CANCELLED' ? 'bg-red-100 text-red-800' :
          'bg-yellow-100 text-yellow-800'
        }`}>
          {order.status}
        </span>
      </div>

      {updateMutation.isError && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {(updateMutation.error as any)?.response?.data?.detail || 'Failed to update status'}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {/* Order Info */}
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Order Information</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Order Number</p>
                <p className="font-medium">{order.order_number}</p>
              </div>
              <div>
                <p className="text-gray-500">Order Date</p>
                <p className="font-medium">{formatDate(order.created_at || '')}</p>
              </div>
              <div>
                <p className="text-gray-500">Shipping Method</p>
                <p className="font-medium">{order.shipping_method || '-'}</p>
              </div>
              <div>
                <p className="text-gray-500">Payment</p>
                <p className="font-medium">
                  {order.payment?.payment_method || '-'}
                  {order.payment?.status && (
                    <span className="ml-2 text-xs text-gray-500">({order.payment.status})</span>
                  )}
                </p>
              </div>
            </div>
            {order.notes && (
              <div className="mt-4">
                <p className="text-gray-500 text-sm">Notes</p>
                <p className="text-sm">{order.notes}</p>
              </div>
            )}
          </div>

          {/* Customer */}
          {order.customer && (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 mb-4 text-lg font-semibold">
                <User className="h-5 w-5" />
                Customer
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Name</p>
                  <p className="font-medium">{order.customer.full_name}</p>
                </div>
                <div>
                  <p className="text-gray-500">Email</p>
                  <p className="font-medium">{order.customer.email}</p>
                </div>
                {order.customer.phone && (
                  <div>
                    <p className="text-gray-500">Phone</p>
                    <p className="font-medium">{order.customer.phone}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Delivery Address */}
          {order.delivery_address && (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 mb-4 text-lg font-semibold">
                <MapPin className="h-5 w-5" />
                Delivery Address
              </h2>
              <div className="text-sm">
                <p>{order.delivery_address.address_line1}</p>
                {order.delivery_address.address_line2 && <p>{order.delivery_address.address_line2}</p>}
                <p>{order.delivery_address.city}, {order.delivery_address.state} {order.delivery_address.postcode}</p>
                {order.delivery_address.phone && <p className="text-gray-500 mt-1">{order.delivery_address.phone}</p>}
              </div>
            </div>
          )}

          {/* Items */}
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Order Items</h2>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2 text-left font-medium">Product</th>
                    <th className="pb-2 text-right font-medium">Qty</th>
                    <th className="pb-2 text-right font-medium">Price</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                            {item.product_image_snapshot ? (
                              <img src={getUploadUrl(item.product_image_snapshot)} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-gray-400">No img</div>
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{item.product_name_snapshot}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 text-right">{item.quantity}</td>
                      <td className="py-2 text-right">{formatCurrency(item.unit_price)}</td>
                      <td className="py-2 text-right font-medium">{formatCurrency(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t">
                    <td colSpan={3} className="py-2 text-right font-medium">Subtotal</td>
                    <td className="py-2 text-right">{formatCurrency(order.subtotal)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="py-2 text-right font-medium">Shipping</td>
                    <td className="py-2 text-right">{order.shipping_cost === 0 ? 'Free' : formatCurrency(order.shipping_cost)}</td>
                  </tr>
                  <tr className="border-t">
                    <td colSpan={3} className="py-2 text-right font-semibold">Total</td>
                    <td className="py-2 text-right text-lg font-bold text-primary">{formatCurrency(order.total_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden space-y-3">
              {order.items.map((item) => (
                <div key={item.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                        {item.product_image_snapshot ? (
                          <img src={getUploadUrl(item.product_image_snapshot)} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{item.product_name_snapshot}</p>
                        <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                      </div>
                    </div>
                    <span className="font-semibold text-sm">{formatCurrency(item.line_total)}</span>
                  </div>
                </div>
              ))}
              <div className="border-t pt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Subtotal</span>
                  <span>{formatCurrency(order.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Shipping</span>
                  <span>{order.shipping_cost === 0 ? 'Free' : formatCurrency(order.shipping_cost)}</span>
                </div>
                <div className="flex justify-between font-semibold border-t pt-2">
                  <span>Total</span>
                  <span className="text-primary">{formatCurrency(order.total_amount)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Actions</h2>
            {actions.length > 0 ? (
              <div className="space-y-3">
                {actions.map((action) => (
                  <button
                    key={action.status}
                    onClick={() => {
                      if (action.status === 'CANCELLED') {
                        setShowCancelDialog(true)
                      } else {
                        updateMutation.mutate(action.status)
                      }
                    }}
                    disabled={updateMutation.isPending}
                    className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${action.color}`}
                  >
                    {action.icon}
                    {updateMutation.isPending ? 'Processing...' : action.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No actions available for this order status.</p>
            )}
          </div>

          {/* Status History */}
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h3 className="mb-2 font-semibold">Status History</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Created</span>
                <span>{formatDate(order.created_at || '')}</span>
              </div>
              {order.paid_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Paid</span>
                  <span>{formatDate(order.paid_at)}</span>
                </div>
              )}
              {order.shipped_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Shipped</span>
                  <span>{formatDate(order.shipped_at)}</span>
                </div>
              )}
              {order.delivered_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Delivered</span>
                  <span>{formatDate(order.delivered_at)}</span>
                </div>
              )}
              {order.cancelled_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Cancelled</span>
                  <span>{formatDate(order.cancelled_at)}</span>
                </div>
              )}
              {order.cancel_reason && (
                <div className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
                  Reason: {order.cancel_reason}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        title="Cancel Order"
        description="Are you sure you want to cancel this order? Stock will be restored."
        confirmText="Cancel Order"
        variant="destructive"
        onConfirm={() => updateMutation.mutate('CANCELLED')}
        isLoading={updateMutation.isPending}
      />
    </div>
  )
}
