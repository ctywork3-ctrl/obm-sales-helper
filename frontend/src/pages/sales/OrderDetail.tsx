import { useParams, useNavigate } from 'react-router-dom'
import { useSalesOrder, useSubmitOrder, useCancelOrder } from '@/hooks/useSalesOrders'
import { useAuth } from '@/hooks/useAuth'
import LoadingSpinner from '@/components/LoadingSpinner'
import StatusBadge from '@/components/StatusBadge'
import ConfirmDialog from '@/components/ConfirmDialog'
import SalesOrderPrintDialog from '@/components/SalesOrderPrintDialog'
import { formatCurrency, formatDate, effectiveDiscountPercent } from '@/lib/utils'
import { ArrowLeft, Send, X, CheckCircle, Pencil, Printer, Tag } from 'lucide-react'
import { useState } from 'react'

function formatOrderSnapshot(value?: string | null): string {
  if (!value) return ''
  try {
    const data = JSON.parse(value)
    return [
      data.label,
      data.address_line1,
      data.address_line2,
      [data.postcode, data.city, data.state].filter(Boolean).join(' '),
      data.country,
      data.contact_name ? `Contact: ${data.contact_name}` : '',
      data.contact_phone ? `Phone: ${data.contact_phone}` : '',
      data.name ? `Contact: ${data.name}` : '',
      data.mobile ? `Mobile: ${data.mobile}` : '',
      data.email,
    ].filter(Boolean).join(', ')
  } catch {
    return value
  }
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [showPrintDialog, setShowPrintDialog] = useState(false)

  const { data: order, isLoading } = useSalesOrder(Number(id))
  const submitOrder = useSubmitOrder()
  const cancelOrder = useCancelOrder()

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Order not found
      </div>
    )
  }

  const isOwner = user?.id === order.salesman_id
  const isDrafter = order.status === 'DRAFT' && isOwner
  const canReview = (user?.role === 'INSIDE_SALES' || user?.role === 'IT_ADMIN' || user?.role === 'DEVELOPER') && order.status === 'SUBMITTED'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <StatusBadge status={order.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Order Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Order Number</p>
                <p className="font-medium">{order.order_number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Order Date</p>
                <p className="font-medium">{formatDate(order.order_date)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Customer</p>
                <p className="font-medium">{order.customer?.name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Salesman</p>
                <p className="font-medium">{order.salesman?.full_name || '-'}</p>
              </div>
            </div>
            {(order.delivery_address_snapshot || order.delivery_address) && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground">Delivery Address</p>
                <p className="font-medium">{formatOrderSnapshot(order.delivery_address_snapshot || order.delivery_address)}</p>
              </div>
            )}
            {order.contact_snapshot && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground">Customer Contact</p>
                <p className="font-medium">{formatOrderSnapshot(order.contact_snapshot)}</p>
              </div>
            )}
            {order.notes && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground">Notes</p>
                <p className="font-medium">{order.notes}</p>
              </div>
            )}
          </div>

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
                    <th className="pb-2 text-right font-medium">Discount</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items?.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2">
                        <p className="font-medium">{item.product_name_snapshot}</p>
                        <p className="text-xs text-muted-foreground">{item.product_code_snapshot}</p>
                      </td>
                      <td className="py-2 text-right">{item.quantity}</td>
                      <td className="py-2 text-right">{formatCurrency(item.unit_price)}</td>
                      <td className="py-2 text-right text-red-600">
                        {(item.discount_amount || 0) > 0
                          ? `− ${formatCurrency(item.discount_amount)}`
                          : '—'}
                      </td>
                      <td className="py-2 text-right font-medium">{formatCurrency(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t">
                    <td colSpan={4} className="py-1 text-right text-muted-foreground">Gross subtotal</td>
                    <td className="py-1 text-right">{formatCurrency(order.gross_subtotal ?? order.subtotal_amount ?? 0)}</td>
                  </tr>
                  {(order.line_discount_total || 0) > 0 && (
                    <tr>
                      <td colSpan={4} className="py-1 text-right text-muted-foreground">Line discounts</td>
                      <td className="py-1 text-right text-red-600">− {formatCurrency(order.line_discount_total || 0)}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={4} className="py-1 text-right text-muted-foreground">Net subtotal</td>
                    <td className="py-1 text-right">{formatCurrency(order.subtotal_amount ?? 0)}</td>
                  </tr>
                  {(order.order_discount_amount || 0) > 0 && (
                    <tr>
                      <td colSpan={4} className="py-1 text-right text-muted-foreground">
                        Order discount{order.discount_type === 'PERCENT' ? ` (${order.discount_value}%)` : ''}
                      </td>
                      <td className="py-1 text-right text-red-600">− {formatCurrency(order.order_discount_amount || 0)}</td>
                    </tr>
                  )}
                  {(order.tax_amount || 0) > 0 && (
                    <tr>
                      <td colSpan={4} className="py-1 text-right text-muted-foreground">Tax</td>
                      <td className="py-1 text-right">{formatCurrency(order.tax_amount || 0)}</td>
                    </tr>
                  )}
                  <tr className="border-t">
                    <td colSpan={4} className="py-2 text-right font-semibold">Total</td>
                    <td className="py-2 text-right text-lg font-bold text-primary">
                      {formatCurrency(order.total_amount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden space-y-3">
              {order.items?.map((item) => (
                <div key={item.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.product_name_snapshot}</p>
                      <p className="text-xs text-muted-foreground">{item.product_code_snapshot}</p>
                    </div>
                    <span className="font-semibold text-primary flex-shrink-0">{formatCurrency(item.line_total)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Qty: {item.quantity}</span>
                    <span>@ {formatCurrency(item.unit_price)}</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t pt-3">
                <span className="font-semibold">Total</span>
                <span className="text-lg font-bold text-primary">{formatCurrency(order.total_amount)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Actions</h2>
            <div className="space-y-3">
              {isDrafter && (
                <>
                  <button
                    onClick={() => navigate(`/app/sales/orders/${order.id}/edit`)}
                    className="flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit Order
                  </button>
                  <button
                    onClick={() => setShowSubmitDialog(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Send className="h-4 w-4" />
                    Submit Order
                  </button>
                  <button
                    onClick={() => setShowCancelDialog(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-4 w-4" />
                    Cancel Order
                  </button>
                </>
              )}
              {canReview && (
                <button
                  onClick={() => navigate(`/app/sales/orders/${order.id}/review`)}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  <CheckCircle className="h-4 w-4" />
                  Review Order
                </button>
              )}
            </div>
          </div>

          {(order.discount_total || 0) > 0 && (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <Tag className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Discount</h3>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total discount</span>
                  <span className="font-semibold text-red-600">
                    {formatCurrency(order.discount_total || 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Effective</span>
                  <span>
                    {effectiveDiscountPercent(
                      order.gross_subtotal ?? order.subtotal_amount ?? 0,
                      order.discount_total || 0,
                    )}
                    %
                  </span>
                </div>
                {order.discount_reason && (
                  <div className="border-t pt-1">
                    <p className="text-muted-foreground">Reason</p>
                    <p>{order.discount_reason}</p>
                  </div>
                )}
                {order.discount_requires_approval && (
                  <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
                    Above the approval threshold — requires manager sign-off.
                  </p>
                )}
              </div>
            </div>
          )}

          {order.rejected_reason && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h3 className="font-semibold text-red-800">Rejection Reason</h3>
              <p className="mt-1 text-sm text-red-700">{order.rejected_reason}</p>
            </div>
          )}

          {order.obm_reference_number && (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h3 className="font-semibold">OBM Reference</h3>
              <p className="mt-1 text-sm">{order.obm_reference_number}</p>
            </div>
          )}

          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h3 className="mb-2 font-semibold">Status History</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatDate(order.created_at)}</span>
              </div>
              {order.submitted_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Submitted</span>
                  <span>{formatDate(order.submitted_at)}</span>
                </div>
              )}
              {order.reviewed_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reviewed</span>
                  <span>{formatDate(order.reviewed_at)}</span>
                </div>
              )}
              {order.keyed_to_obm_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Keyed to OBM</span>
                  <span>{formatDate(order.keyed_to_obm_at)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showSubmitDialog}
        onOpenChange={setShowSubmitDialog}
        title="Submit Order"
        description="Are you sure you want to submit this order? It will be sent for review."
        confirmText="Submit"
        onConfirm={async () => {
          await submitOrder.mutateAsync({ id: Number(id) })
          setShowSubmitDialog(false)
        }}
        isLoading={submitOrder.isPending}
      />

      <ConfirmDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        title="Cancel Order"
        description="Are you sure you want to cancel this order? This action cannot be undone."
        confirmText="Cancel Order"
        variant="destructive"
        onConfirm={async () => {
          await cancelOrder.mutateAsync(Number(id))
          setShowCancelDialog(false)
        }}
        isLoading={cancelOrder.isPending}
      />

      <SalesOrderPrintDialog
        orderId={Number(id)}
        open={showPrintDialog}
        onClose={() => setShowPrintDialog(false)}
      />
    </div>
  )
}
