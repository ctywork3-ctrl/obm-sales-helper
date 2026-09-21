import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Printer } from 'lucide-react'
import { inventoryApi } from '@/api/inventory'
import WorkflowHeader from '@/components/WorkflowHeader'
import LoadingSpinner from '@/components/LoadingSpinner'

export default function WarehouseReceipts() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const { data: receipts = [], isLoading } = useQuery({ queryKey: ['inventory-receipts'], queryFn: () => inventoryApi.listReceipts().then((response) => response.data) })
  const { data: selected, isLoading: detailLoading } = useQuery({ queryKey: ['inventory-receipt', selectedId], queryFn: () => inventoryApi.getReceipt(selectedId!).then((response) => response.data), enabled: Boolean(selectedId) })

  return (
    <div className="space-y-6">
      <WorkflowHeader title="Received History" subtitle="See everything that was received, with the items and proof photos." icon={<ClipboardList className="h-5 w-5" />} backLabel="Back" onBack={() => window.history.back()} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border bg-white p-4 shadow-sm lg:col-span-1"><h2 className="mb-3 font-semibold">Recent receipts</h2>{isLoading ? <LoadingSpinner /> : receipts.length === 0 ? <p className="text-sm text-muted-foreground">No receipts yet.</p> : <div className="divide-y">{receipts.map((receipt: any) => <button type="button" key={receipt.id} onClick={() => setSelectedId(receipt.id)} className={`w-full py-3 text-left ${selectedId === receipt.id ? 'bg-blue-50' : ''}`}><p className="font-mono text-sm font-medium">{receipt.receipt_number}</p><p className="text-xs text-muted-foreground">{receipt.supplier_name || 'No supplier'} · {receipt.reference_number || 'No reference'}</p><p className="mt-1 text-xs text-muted-foreground">{receipt.received_at ? new Date(receipt.received_at).toLocaleString() : '-'}</p></button>)}</div>}</div>
        <div className="rounded-lg border bg-white p-4 shadow-sm lg:col-span-2">{detailLoading && <LoadingSpinner />}{!selectedId && <div className="py-12 text-center text-sm text-muted-foreground">Select a receipt to view details.</div>}{selected && <div><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">Posted receipt</p><h2 className="text-xl font-semibold">{selected.receipt_number}</h2><p className="text-sm text-muted-foreground">{selected.supplier_name || 'No supplier'} · {selected.reference_number || 'No reference'} · {selected.warehouse_location || 'No location'}</p></div>{selected.units?.length > 0 && <Link to={`/app/warehouse/labels?units=${selected.units.map((unit: any) => unit.id).join(',')}`} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"><Printer className="h-4 w-4" /> Print labels</Link>}</div><div className="mt-5 space-y-3">{selected.lines?.map((line: any) => <div key={line.id} className="rounded-md border p-3"><div className="flex justify-between gap-2"><span className="font-medium">{line.product?.name || `Product #${line.product_id}`}</span><span>{line.quantity} · {line.tracking_mode}</span></div><p className="text-xs text-muted-foreground">{line.batch_number || 'No batch'} · {line.unit_count} serialized units</p></div>)}</div>{selected.units?.length > 0 && <div className="mt-5"><h3 className="mb-2 font-semibold">Units</h3><div className="max-h-52 overflow-y-auto divide-y">{selected.units.map((unit: any) => <Link key={unit.id} to={`/app/warehouse/units/${unit.id}`} className="flex justify-between py-2 text-sm hover:bg-gray-50"><span className="font-mono">{unit.unit_code}</span><span className="font-mono text-muted-foreground">{unit.barcode}</span></Link>)}</div></div>}</div>}</div>
      </div>
    </div>
  )
}
