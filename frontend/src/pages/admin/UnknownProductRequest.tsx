import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Camera, FileQuestion, Send } from 'lucide-react'
import { intakeApi } from '@/api/inventory'
import { getApiErrorMessage } from '@/lib/apiError'
import WorkflowHeader from '@/components/WorkflowHeader'

export default function UnknownProductRequest() {
  const navigate = useNavigate()
  const [productName, setProductName] = useState('')
  const [barcodeValue, setBarcodeValue] = useState('')
  const [brand, setBrand] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [supplier, setSupplier] = useState('')
  const [sellingPrice, setSellingPrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const submitRequest = useMutation({
    mutationFn: async () => {
      const response = await intakeApi.create({ product_name: productName, barcode_value: barcodeValue || undefined, brand: brand || undefined, category: category || undefined, description: description || undefined, quantity_received: quantity, supplier_name: supplier || undefined, suggested_selling_price: sellingPrice || undefined, suggested_cost_price: costPrice || undefined })
      if (photo) await intakeApi.uploadPhoto(response.data.id, photo)
      await intakeApi.submit(response.data.id)
      return response.data
    },
    onSuccess: (data) => {
      setSuccess(`${data.request_number} submitted. A manager can link it to an existing product or create a new catalog item.`)
      setError('')
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not submit product request')),
  })

  return (
    <div className="space-y-6">
      <WorkflowHeader title="New Item Request" subtitle="Tell the manager about an item we don't have yet. They will add it or link it to an existing item." icon={<FileQuestion className="h-5 w-5" />} backLabel="Back" onBack={() => navigate('/app/warehouse/receiving')} />
      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}
      {!success && <div className="rounded-lg border bg-white p-4 shadow-sm"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm sm:col-span-2"><span className="font-medium">Product name *</span><input value={productName} onChange={(e) => setProductName(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm"><span className="font-medium">Scanned manufacturer barcode</span><input value={barcodeValue} onChange={(e) => setBarcodeValue(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 font-mono" /></label><label className="text-sm"><span className="font-medium">Quantity received</span><input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm"><span className="font-medium">Brand</span><input value={brand} onChange={(e) => setBrand(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm"><span className="font-medium">Suggested category</span><input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm"><span className="font-medium">Supplier</span><input value={supplier} onChange={(e) => setSupplier(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm"><span className="font-medium">Suggested selling price</span><input value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm"><span className="font-medium">Suggested cost price</span><input value={costPrice} onChange={(e) => setCostPrice(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm sm:col-span-2"><span className="font-medium">Description</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="mt-1 w-full rounded-md border px-3 py-2" /></label><label className="text-sm sm:col-span-2"><span className="font-medium">Product / packaging photo</span><div className="mt-1 flex items-center gap-3"><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setPhoto(e.target.files?.[0] || null)} /><Camera className="h-5 w-5 text-muted-foreground" /></div></label></div><div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => submitRequest.mutate()} disabled={!productName.trim() || submitRequest.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4" />{submitRequest.isPending ? 'Submitting...' : 'Submit request'}</button><Link to="/app/warehouse/receiving" className="rounded-md border px-4 py-2.5 text-sm font-medium">Cancel</Link></div></div>}
    </div>
  )
}
