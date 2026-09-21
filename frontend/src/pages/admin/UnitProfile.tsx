import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Camera, Package, MapPin } from 'lucide-react'
import { inventoryApi } from '@/api/inventory'
import { productUnitsApi } from '@/api/templates'
import { getUploadUrl } from '@/api/client'
import { getApiErrorMessage } from '@/lib/apiError'
import LoadingSpinner from '@/components/LoadingSpinner'
import SafeImage from '@/components/SafeImage'
import StatusBadge from '@/components/StatusBadge'

export default function UnitProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [location, setLocation] = useState('')
  const [status, setStatus] = useState('AVAILABLE')
  const [error, setError] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['inventory-unit', id],
    queryFn: () => inventoryApi.getUnit(Number(id)).then((response) => response.data),
    enabled: Boolean(id),
  })

  useEffect(() => {
    if (data?.unit) {
      setLocation(data.unit.warehouse_location || '')
      setStatus(data.unit.status)
    }
  }, [data?.unit])

  const upload = useMutation({
    mutationFn: () => productUnitsApi.uploadImage(Number(id), file!, caption),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-unit', id] })
      setFile(null)
      setCaption('')
      setError('')
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not upload evidence photo')),
  })

  const update = useMutation({
    mutationFn: () => productUnitsApi.update(Number(id), { status, warehouse_location: location }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-unit', id] })
      setError('')
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not update unit')),
  })

  if (isLoading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
  if (!data) return <div className="rounded-lg border bg-white p-6 text-center">Unit not found.</div>

  const { unit, product, images, movements } = data
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>
        <Link to={`/app/products/${unit.product_id}`} className="rounded-md border px-3 py-2 text-sm font-medium">Open product profile</Link>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border bg-white p-4 shadow-sm lg:col-span-2">
          <div className="flex gap-4">
            <SafeImage src={product?.images?.[0] ? getUploadUrl(product.images[0].file_path) : null} alt={product?.name || 'Product'} className="h-28 w-28 rounded-lg object-cover" />
            <div className="min-w-0 flex-1"><p className="text-sm text-muted-foreground">Physical unit</p><h1 className="truncate text-2xl font-bold">{product?.name || 'Unknown product'}</h1><p className="font-mono text-sm text-muted-foreground">{product?.item_code || product?.obm_item_code || '-'}</p><div className="mt-3"><StatusBadge status={unit.status} /></div></div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div><p className="text-xs text-muted-foreground">Internal unit ID</p><p className="font-mono font-semibold">{unit.unit_code || unit.serial_number}</p></div>
            <div><p className="text-xs text-muted-foreground">Generated barcode</p><p className="font-mono font-semibold">{unit.barcode || '-'}</p></div>
            <div><p className="text-xs text-muted-foreground">Manufacturer serial</p><p className="font-mono">{unit.manufacturer_serial || 'Not provided'}</p></div>
            <div><p className="text-xs text-muted-foreground">Location</p><p className="inline-flex items-center gap-1 font-medium"><MapPin className="h-4 w-4" />{unit.warehouse_location || 'Not assigned'}</p></div>
            <div><p className="text-xs text-muted-foreground">Batch / lot</p><p>{unit.batch_number || '-'}</p></div>
            <div><p className="text-xs text-muted-foreground">Received</p><p>{unit.received_at ? new Date(unit.received_at).toLocaleString() : '-'}</p></div>
          </div>
          <div className="mt-6 border-t pt-4">
            <p className="mb-3 text-sm font-semibold">Warehouse update</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm"><span className="font-medium">Status</span><select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2"><option value="AVAILABLE">Available</option><option value="RESERVED">Reserved</option><option value="DAMAGED">Damaged</option><option value="QUARANTINED">Quarantined</option><option value="SOLD">Sold</option></select></label>
              <label className="text-sm sm:col-span-2"><span className="font-medium">Warehouse location</span><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="RACK-A1" className="mt-1 w-full rounded-md border px-3 py-2" /></label>
            </div>
            <button type="button" onClick={() => update.mutate()} disabled={update.isPending} className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{update.isPending ? 'Saving...' : 'Save unit update'}</button>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Evidence photos</h2>
          <div className="space-y-2"><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm" /><input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption" className="w-full rounded-md border px-3 py-2 text-sm" /><button type="button" onClick={() => upload.mutate()} disabled={!file || upload.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"><Camera className="h-4 w-4" />{upload.isPending ? 'Uploading...' : 'Upload evidence'}</button></div>
          {images.length > 0 ? <div className="mt-4 grid grid-cols-2 gap-2">{images.map((image) => <div key={image.id} className="overflow-hidden rounded border"><SafeImage src={productUnitsApi.imageUrl(image.id)} alt={image.caption || 'Evidence'} className="h-24 w-full object-cover" /><p className="truncate px-1 py-1 text-xs text-muted-foreground">{image.caption || 'Evidence'}</p></div>)}</div> : <p className="mt-4 text-sm text-muted-foreground">No unit evidence photos yet.</p>}
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm"><h2 className="mb-3 inline-flex items-center gap-2 font-semibold"><Package className="h-4 w-4" />Inventory history</h2>{movements.length > 0 ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="pb-2">Date</th><th className="pb-2">Movement</th><th className="pb-2">Change</th><th className="pb-2">Reference</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id} className="border-b last:border-0"><td className="py-2">{movement.created_at ? new Date(movement.created_at).toLocaleString() : '-'}</td><td className="py-2">{movement.movement_type}</td><td className="py-2 font-medium">{movement.quantity_delta > 0 ? '+' : ''}{movement.quantity_delta}</td><td className="py-2">{movement.reason || '-'}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No movement history recorded.</p>}</div>
    </div>
  )
}
