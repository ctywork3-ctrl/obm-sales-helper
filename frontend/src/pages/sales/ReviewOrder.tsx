import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSalesOrder, useReviewOrder, useMarkKeyedToObm } from '@/hooks/useSalesOrders'
import LoadingSpinner from '@/components/LoadingSpinner'
import StatusBadge from '@/components/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ArrowLeft, CheckCircle, XCircle } from 'lucide-react'

export default function ReviewOrder() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [rejectReason, setRejectReason] = useState('')
  const [obmRef, setObmRef] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [showKeyedForm, setShowKeyedForm] = useState(false)
  const [error, setError] = useState('')

  const { data: order, isLoading } = useSalesOrder(Number(id))
  const reviewOrder = useReviewOrder()
  const markKeyed = useMarkKeyedToObm()

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

  const handleApprove = async () => {
    setError('')
    try {
      await reviewOrder.mutateAsync({
        id: Number(id),
        data: { action: 'approve' },
      })
      navigate('/sales/all-orders')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to approve order')
    }
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setError('Please provide a rejection reason')
      return
    }
    setError('')
    try {
      await reviewOrder.mutateAsync({
        id: Number(id),
        data: { action: 'reject', rejected_reason: rejectReason },
      })
      navigate('/sales/all-orders')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to reject order')
    }
  }

  const handleKeyedToObm = async () => {
    if (!obmRef.trim()) {
      setError('Please enter OBM reference number')
      return
    }
    setError('')
    try {
      await markKeyed.mutateAsync({
        id: Number(id),
        data: { obm_reference_number: obmRef },
      })
      navigate('/sales/all-orders')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to mark as keyed')
    }
  }

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

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Order Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Order Number</p>
                <p className="font-medium">{order.order_number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Customer</p>
                <p className="font-medium">{order.customer?.name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Salesman</p>
                <p className="font-medium">{order.salesman?.full_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Order Date</p>
                <p className="font-medium">{formatDate(order.order_date)}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Order Items</h2>
            <div className="overflow-x-auto">
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
                  {order.items?.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2">
                        <p className="font-medium">{item.product_name_snapshot}</p>
                        <p className="text-xs text-muted-foreground">{item.product_code_snapshot}</p>
                      </td>
                      <td className="py-2 text-right">{item.quantity}</td>
                      <td className="py-2 text-right">{formatCurrency(item.unit_price)}</td>
                      <td className="py-2 text-right font-medium">{formatCurrency(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t">
                    <td colSpan={3} className="py-2 text-right font-semibold">Total</td>
                    <td className="py-2 text-right text-lg font-bold text-primary">
                      {formatCurrency(order.total_amount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {order.status === 'SUBMITTED' && (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">Review Actions</h2>
              <div className="space-y-3">
                {!showRejectForm && (
                  <button
                    onClick={handleApprove}
                    disabled={reviewOrder.isPending}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Approve Order
                  </button>
                )}
                <button
                  onClick={() => setShowRejectForm(!showRejectForm)}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                >
                  <XCircle className="h-4 w-4" />
                  Reject Order
                </button>
                {showRejectForm && (
                  <div className="space-y-3">
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Enter rejection reason..."
                      rows={3}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <button
                      onClick={handleReject}
                      disabled={reviewOrder.isPending}
                      className="flex w-full items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                    >
                      {reviewOrder.isPending ? 'Rejecting...' : 'Confirm Rejection'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {(order.status === 'KEYED_TO_OBM' || order.status === 'SUBMITTED') && (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">Key to OBM</h2>
              {!showKeyedForm ? (
                <button
                  onClick={() => setShowKeyedForm(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Mark as Keyed to OBM
                </button>
              ) : (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={obmRef}
                    onChange={(e) => setObmRef(e.target.value)}
                    placeholder="OBM Reference Number"
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <button
                    onClick={handleKeyedToObm}
                    disabled={markKeyed.isPending}
                    className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {markKeyed.isPending ? 'Processing...' : 'Confirm Keyed'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
