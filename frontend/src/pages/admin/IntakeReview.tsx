import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, ClipboardCheck } from 'lucide-react'
import { useProducts } from '@/hooks/useProducts'
import { intakeApi, inventoryPrivateMedia } from '@/api/inventory'
import { getApiErrorMessage } from '@/lib/apiError'
import WorkflowHeader from '@/components/WorkflowHeader'
import SafeImage from '@/components/SafeImage'

export default function IntakeReview() {
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const { data: requests = [], isLoading } = useQuery({ queryKey: ['intake-requests', 'PENDING_REVIEW'], queryFn: () => intakeApi.list().then((response) => response.data) })
  const { data: productsData } = useProducts({ page_size: 100 })
  const resolve = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => intakeApi.resolve(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intake-requests'] })
      setError('')
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not resolve request')),
  })

  return (
    <div className="space-y-6">
      <WorkflowHeader title="New Item Requests" subtitle="Link a request to an existing item, or create a new item. Stock is added separately in Goods Received." icon={<ClipboardCheck className="h-5 w-5" />} backLabel="Back" onBack={() => window.history.back()} />
      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading requests...</p>}
      {!isLoading && requests.length === 0 && <div className="rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">No pending unknown-product requests.</div>}
      <div className="space-y-4">{requests.map((request: any) => <IntakeCard key={request.id} request={request} products={productsData?.items || []} resolving={resolve.isPending} onResolve={(data) => resolve.mutate({ id: request.id, data })} />)}</div>
    </div>
  )
}

function IntakeCard({ request, products, resolving, onResolve }: { request: any; products: any[]; resolving: boolean; onResolve: (data: any) => void }) {
  const [existingProductId, setExistingProductId] = useState('')
  const [itemCode, setItemCode] = useState(`IR-${request.id}`)
  const [sellingPrice, setSellingPrice] = useState(request.suggested_selling_price || '')
  const [costPrice, setCostPrice] = useState(request.suggested_cost_price || '')
  const [notes, setNotes] = useState('')
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm"><div className="flex flex-wrap gap-4"><div className="flex-1"><p className="text-xs text-muted-foreground">{request.request_number} · {request.quantity_received || 0} units · {request.supplier_name || 'No supplier'}</p><h2 className="mt-1 text-lg font-semibold">{request.product_name}</h2><p className="text-sm text-muted-foreground">{request.brand || 'Unknown brand'} · {request.category || 'Uncategorized'} · Barcode {request.barcode_value || 'none'}</p><p className="mt-2 text-sm">{request.description || 'No description supplied.'}</p></div>{request.photo_path && <SafeImage src={inventoryPrivateMedia.intakePhoto(request.id)} alt="Unknown product request" className="h-24 w-24 rounded object-cover" />}</div><div className="mt-4 grid gap-3 lg:grid-cols-2"><label className="text-sm"><span className="font-medium">Link to existing product</span><select value={existingProductId} onChange={(e) => setExistingProductId(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2"><option value="">Create a new catalog product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.item_code}</option>)}</select></label>{!existingProductId && <label className="text-sm"><span className="font-medium">New item code</span><input value={itemCode} onChange={(e) => setItemCode(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" /></label>}{!existingProductId && <label className="text-sm"><span className="font-medium">Selling price</span><input type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" /></label>}{!existingProductId && <label className="text-sm"><span className="font-medium">Cost price</span><input type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" /></label>}<label className="text-sm lg:col-span-2"><span className="font-medium">Review notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="mt-1 w-full rounded-md border px-3 py-2" /></label></div><button type="button" onClick={() => onResolve(existingProductId ? { existing_product_id: Number(existingProductId), review_notes: notes } : { item_code: itemCode, selling_price: Number(sellingPrice) || 0, cost_price: Number(costPrice) || 0, review_notes: notes })} disabled={resolving || (!existingProductId && !itemCode.trim())} className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"><CheckCircle className="h-4 w-4" />{resolving ? 'Resolving...' : existingProductId ? 'Link product' : 'Create catalog product'}</button></div>
  )
}
