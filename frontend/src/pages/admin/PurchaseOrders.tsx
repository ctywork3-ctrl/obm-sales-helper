import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileText, Plus, Upload } from 'lucide-react'
import { purchaseOrdersApi } from '@/api/purchaseOrders'
import { getApiErrorMessage } from '@/lib/apiError'
import WorkflowHeader from '@/components/WorkflowHeader'
import LoadingSpinner from '@/components/LoadingSpinner'
import SearchInput from '@/components/SearchInput'

const STATUS_FILTERS = ['All', 'DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED']

export default function PurchaseOrders() {
  const [status, setStatus] = useState('All')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['purchase-orders', status, search],
    queryFn: async () => {
      try {
        const res = await purchaseOrdersApi.list({
          status: status === 'All' ? undefined : status,
          search: search || undefined,
        })
        return res.data
      } catch (err: any) {
        setError(getApiErrorMessage(err, 'Failed to load purchase orders'))
        return []
      }
    },
  })

  return (
    <div className="space-y-6">
      <WorkflowHeader
        title="Supplier PO"
        subtitle="Orders you placed with suppliers. Warehouse staff receive the goods against these."
        icon={<FileText className="h-5 w-5" />}
        backLabel="Back"
        onBack={() => window.history.back()}
      />

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${status === s ? 'bg-primary text-primary-foreground' : 'hover:bg-gray-50'}`}
            >
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search PO / supplier..." />
          <Link to="/app/purchase-orders/import" className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50">
            <Upload className="h-4 w-4" /> Import
          </Link>
          <Link to="/app/purchase-orders/new" className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            <Plus className="h-4 w-4" /> New PO
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          No purchase orders found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-4 py-3 font-medium">PO Number</th>
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Ordered</th>
                <th className="px-4 py-3 text-right font-medium">Received</th>
                <th className="px-4 py-3 text-right font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((po) => (
                <tr key={po.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/app/purchase-orders/${po.id}`} className="font-mono font-medium text-primary underline">
                      {po.po_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {po.supplier_name}
                    {/* A PO keeps the vendor name from its document AND a link to
                        supplier master data. When there is no link, say so:
                        otherwise an imported "Shimano SEA" looks identical to a
                        properly linked supplier and the counts never reconcile. */}
                    {!po.supplier_id && (
                      <span
                        className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                        title="This vendor is not linked to a supplier record yet."
                      >
                        not linked
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium">
                      {po.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{po.total_ordered}</td>
                  <td className="px-4 py-3 text-right">{po.total_received}</td>
                  <td className="px-4 py-3 text-right font-semibold">{po.total_outstanding}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
