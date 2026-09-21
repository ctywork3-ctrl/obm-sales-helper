import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, FileText, PackagePlus, Send, XCircle } from 'lucide-react'
import { purchaseOrdersApi } from '@/api/purchaseOrders'
import { getApiErrorMessage } from '@/lib/apiError'
import WorkflowHeader from '@/components/WorkflowHeader'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmDialog from '@/components/ConfirmDialog'
import CreateReceivingTaskDialog from '@/components/CreateReceivingTaskDialog'

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [showTaskDialog, setShowTaskDialog] = useState(false)

  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => purchaseOrdersApi.get(Number(id)).then((res) => res.data),
    enabled: Boolean(id),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-order', id] })
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
  }

  const send = useMutation({
    mutationFn: () => purchaseOrdersApi.send(Number(id)),
    onSuccess: () => { invalidate(); setError('') },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not send purchase order')),
  })

  const cancel = useMutation({
    mutationFn: () => purchaseOrdersApi.cancel(Number(id)),
    onSuccess: () => { invalidate(); setConfirmCancel(false); setError('') },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not cancel purchase order')),
  })

  if (isLoading) {
    return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
  }
  if (!po) {
    return <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">Purchase order not found.</div>
  }

  const canReceive = po.status === 'SENT' || po.status === 'PARTIALLY_RECEIVED'
  const outstanding = po.lines.reduce((total: number, line: any) => total + line.quantity_outstanding, 0)

  return (
    <div className="space-y-6">
      <WorkflowHeader
        title={po.po_number}
        subtitle={`Supplier: ${po.supplier_name} · Status: ${po.status.replace(/_/g, ' ')}`}
        icon={<FileText className="h-5 w-5" />}
        backLabel="Back to purchase orders"
        onBack={() => navigate('/app/purchase-orders')}
      />

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="flex flex-wrap gap-2">
        {po.status === 'DRAFT' && (
          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={send.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {send.isPending ? 'Sending...' : 'Send to warehouse'}
          </button>
        )}
        {canReceive && (
          <button
            type="button"
            onClick={() => setShowTaskDialog(true)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <ClipboardCheck className="h-4 w-4" />
            Issue receiving task ({outstanding} outstanding)
          </button>
        )}
        {canReceive && (
          <Link
            to={`/app/warehouse/receiving?po=${po.id}`}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-gray-50"
            title="Posts stock without scanning serials or creating a task. Use only for adjustments."
          >
            <PackagePlus className="h-4 w-4" />
            Advanced: post a receipt without scanning
          </Link>
        )}
        {(po.status === 'DRAFT' || po.status === 'SENT' || po.status === 'PARTIALLY_RECEIVED') && (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-destructive"
          >
            <XCircle className="h-4 w-4" />
            Cancel PO
          </button>
        )}
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">Ordered lines</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2">Product</th>
                <th className="pb-2 text-right">Ordered</th>
                <th className="pb-2 text-right">Received</th>
                <th className="pb-2 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((line: any) => (
                <tr key={line.id} className="border-b last:border-0">
                  <td className="py-2">
                    <p className="font-medium">{line.product_name || `Product #${line.product_id}`}</p>
                    <p className="text-xs text-muted-foreground">{line.product_code || ''}</p>
                  </td>
                  <td className="py-2 text-right">{line.quantity_ordered}</td>
                  <td className="py-2 text-right">
                    {line.quantity_received}
                    {/*
                      OBM's own "already received" figure, shown only when it
                      disagrees with ours. A gap means goods arrived that nobody
                      booked in here, or a receipt from before this system — a
                      human has to decide which, so it is surfaced rather than
                      quietly reconciled. Sending someone to count goods that
                      arrived months ago is how a task list loses credibility.
                    */}
                    {line.obm_quantity_processed != null &&
                      line.obm_quantity_processed > line.quantity_received && (
                        <span
                          className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                          title={`OBM records ${line.obm_quantity_processed} received on this line. This app has no receipt for it.`}
                        >
                          OBM {line.obm_quantity_processed}
                        </span>
                      )}
                  </td>
                  <td className="py-2 text-right font-semibold">{line.quantity_outstanding}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {po.notes && <p className="mt-3 text-sm text-muted-foreground">Notes: {po.notes}</p>}
      </div>

      {po.documents.length > 0 && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Attached documents</h2>
          <div className="space-y-2">
            {po.documents.map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                <span className="truncate">{doc.original_filename || `Document #${doc.id}`}</span>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs">{doc.extraction_status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel purchase order?"
        description="Outstanding quantities will no longer be receivable. Received stock stays in inventory."
        confirmText="Cancel PO"
        onConfirm={() => cancel.mutate()}
      />

      <CreateReceivingTaskDialog
        purchaseOrderId={po.id}
        purchaseOrderNumber={po.po_number}
        open={showTaskDialog}
        onClose={() => setShowTaskDialog(false)}
      />
    </div>
  )
}
