import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Search, SlidersHorizontal } from 'lucide-react'
import { useProducts } from '@/hooks/useProducts'
import { inventoryApi } from '@/api/inventory'
import { getApiErrorMessage } from '@/lib/apiError'
import WorkflowHeader from '@/components/WorkflowHeader'

export default function StockAdjustment() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [product, setProduct] = useState<any>(null)
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [location, setLocation] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const { data } = useProducts({ search: search || undefined, page_size: 12 })
  const adjust = useMutation({
    mutationFn: () => inventoryApi.adjust({ product_id: product.id, quantity_delta: Number(delta), reason, warehouse_location: location || undefined }),
    onSuccess: (response) => {
      setSuccess(`Adjustment ${response.data.adjustment_number} posted.`)
      setError('')
      setDelta('')
      setReason('')
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not post stock adjustment')),
  })

  return (
    <div className="space-y-6">
      <WorkflowHeader title="Fix Stock Count" subtitle="Fix a wrong quantity with a reason. Use Goods Received for new items." icon={<SlidersHorizontal className="h-5 w-5" />} backLabel="Back" onBack={() => navigate('/app/warehouse/scanner')} />
      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}
      <div className="rounded-lg border bg-white p-4 shadow-sm"><label className="block text-sm font-medium">Product</label><div className="relative mt-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input value={product ? `${product.name} · ${product.item_code}` : search} onChange={(e) => { setProduct(null); setSearch(e.target.value) }} placeholder="Search product..." className="w-full rounded-md border py-2 pl-9 pr-3" />{!product && search.length >= 2 && <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-white shadow-lg">{(data?.items || []).map((item: any) => <button type="button" key={item.id} onClick={() => { setProduct(item); setSearch('') }} className="block w-full border-b p-3 text-left text-sm hover:bg-gray-50"><span className="font-medium">{item.name}</span><span className="ml-2 text-muted-foreground">{item.item_code}</span><span className="float-right">Stock: {item.stock_qty}</span></button>)}</div>}</div>{product && <p className="mt-2 text-sm text-muted-foreground">Current stock: {product.stock_qty} {product.uom || ''}</p>}<div className="mt-4 grid gap-4 sm:grid-cols-3"><label className="text-sm"><span className="font-medium">Quantity change</span><input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+10 or -2" className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm"><span className="font-medium">Location</span><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm"><span className="font-medium">Reason *</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Count correction, damage..." className="mt-1 w-full rounded-md border px-3 py-2" /></label></div><div className="mt-4 flex gap-2"><button type="button" onClick={() => adjust.mutate()} disabled={!product || !delta || Number(delta) === 0 || reason.trim().length < 3 || adjust.isPending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{adjust.isPending ? 'Posting...' : 'Post adjustment'}</button><Link to="/app/warehouse/receiving" className="rounded-md border px-4 py-2 text-sm font-medium">Receive new stock instead</Link></div></div>
    </div>
  )
}
