import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { productUnitsApi } from '@/api/templates'
import { inventoryApi } from '@/api/inventory'
import { productsApi } from '@/api/products'
import { getApiErrorMessage } from '@/lib/apiError'
import { getUploadUrl } from '@/api/client'
import LoadingSpinner from '@/components/LoadingSpinner'
import SafeImage from '@/components/SafeImage'
import { Camera, Search, Plus, Package, ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import WorkflowHeader from '@/components/WorkflowHeader'
import BarcodeCamera from '@/components/BarcodeCamera'

export default function WarehouseScanner() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [scanInput, setScanInput] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [newSerial, setNewSerial] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [evidenceCaption, setEvidenceCaption] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const lookupQuery = useQuery({
    queryKey: ['unit-lookup', scanInput],
    queryFn: () => inventoryApi.resolve(scanInput).then((res) => res.data),
    enabled: scanInput.length >= 3,
  })

  const { data: productsData } = useQuery({
    queryKey: ['products-search', searchInput],
    queryFn: () => productsApi.list({ search: searchInput, page_size: 20 }).then((res) => res.data),
    enabled: searchInput.length >= 2,
  })

  const createUnit = useMutation({
    mutationFn: productUnitsApi.create,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['unit-lookup'] })
      setSuccess(`Unit created: ${data.data.serial_number}`)
      setError('')
      setShowCreate(false)
      setScanInput(data.data.serial_number)
      setNewSerial('')
      setNewLocation('')
    },
    onError: (err: any) => setError(getApiErrorMessage(err, 'Failed to create unit')),
  })

  const uploadEvidence = useMutation({
    mutationFn: ({ id, file, caption }: { id: number; file: File; caption: string }) =>
      productUnitsApi.uploadImage(id, file, caption),
    onSuccess: () => {
      setSuccess('Evidence photo uploaded')
      setEvidenceFile(null)
      setEvidenceCaption('')
      if (unit?.id) {
        queryClient.invalidateQueries({ queryKey: ['unit-images', unit.id] })
      }
      if (scanInput) lookupQuery.refetch()
    },
    onError: (err: any) => setError(getApiErrorMessage(err, 'Failed to upload evidence photo')),
  })

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault()
    if (lookupQuery.data?.found) {
      setSuccess('')
    } else if (scanInput.length >= 3) {
      setShowCreate(true)
      setNewSerial(scanInput)
    }
  }

  const handleCreateUnit = () => {
    if (!selectedProductId) {
      setError('Please select a product')
      return
    }
    setError('')
    createUnit.mutate({
      product_id: selectedProductId,
      serial_number: newSerial || undefined,
      warehouse_location: newLocation || undefined,
    })
  }

  const unit = lookupQuery.data?.found ? lookupQuery.data.unit : null
  const product = lookupQuery.data?.product || null

  const imagesQuery = useQuery({
    queryKey: ['unit-images', unit?.id],
    queryFn: () => productUnitsApi.listImages(unit!.id).then((res) => res.data),
    enabled: Boolean(unit?.id),
  })

  return (
    <div className="space-y-6">
      <WorkflowHeader
        title="Warehouse Scanner"
        subtitle="Scan a product unit, verify its identity, and record its location."
        icon={<Package className="h-5 w-5" />}
        backLabel="Back to warehouse"
        onBack={() => navigate(-1)}
      />

      {/* Scanner Input */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">Scan Barcode / Serial Number</h2>
        <form onSubmit={handleScan} className="flex gap-3">
          <div className="relative flex-1">
            <Camera className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={scanInput}
              onChange={(e) => { setScanInput(e.target.value); setShowCreate(false); setSuccess('') }}
              placeholder="Scan barcode or type serial number..."
              className="w-full rounded-lg border py-3 pl-10 pr-4 text-lg font-mono"
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Lookup
          </button>
        </form>
        <div className="mt-3">
          <BarcodeCamera onScan={(decoded) => { setScanInput(decoded); setShowCreate(false); setSuccess('') }} />
        </div>
      </div>

      {/* Status Messages */}
      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-600">{success}</div>}

      {/* Lookup Result */}
      {lookupQuery.data && !showCreate && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          {lookupQuery.data.found ? (
            <div>
              {unit ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className={`rounded-full px-3 py-1 text-sm font-medium ${
                      unit.status === 'AVAILABLE' ? 'bg-green-100 text-green-700' :
                      unit.status === 'SOLD' ? 'bg-gray-100 text-gray-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {unit.status}
                    </div>
                    <span className="font-mono text-lg font-semibold">{unit.unit_code || unit.serial_number}</span>
                    <Link to={`/app/warehouse/units/${unit.id}`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50">Open unit profile</Link>
                  </div>
                  {product && <div className="mt-3 text-sm text-gray-600"><p>Product: <span className="font-medium">{product.name}</span> ({product.item_code || product.obm_item_code || '-'})</p></div>}
                  {unit.warehouse_location && <p className="mt-1 text-sm text-gray-500">Location: {unit.warehouse_location}</p>}
                  {unit.id && (
                <div className="mt-4 border-t pt-4">
                  <p className="mb-2 text-sm font-medium">Internal evidence photo</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm"
                    />
                    <input
                      value={evidenceCaption}
                      onChange={(e) => setEvidenceCaption(e.target.value)}
                      placeholder="Caption (e.g. serial label)"
                      className="rounded-md border px-3 py-2 text-sm"
                    />
                    <button
                      disabled={!evidenceFile || uploadEvidence.isPending}
                      onClick={() => evidenceFile && uploadEvidence.mutate({ id: unit.id, file: evidenceFile, caption: evidenceCaption })}
                      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {uploadEvidence.isPending ? 'Uploading...' : 'Upload'}
                    </button>
                  </div>
                  {imagesQuery.data && imagesQuery.data.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-sm font-medium">Evidence gallery ({imagesQuery.data.length})</p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {imagesQuery.data.map((img: any) => (
                          <div key={img.id} className="overflow-hidden rounded-md border">
                            <SafeImage
                              src={productUnitsApi.imageUrl(img.id)}
                              alt={img.caption || 'Evidence photo'}
                              className="h-28 w-full object-cover"
                            />
                            {img.caption && (
                              <p className="truncate px-2 py-1 text-xs text-gray-600">{img.caption}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
                </>
              ) : (
                <div>
                  <p className="text-sm text-muted-foreground">Product barcode identified</p>
                  <p className="mt-1 text-lg font-semibold">{product?.name}</p>
                  <p className="text-sm text-gray-600">{product?.item_code || product?.obm_item_code || '-'} · Current stock {product?.stock_qty ?? 0}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {product?.id && <Link to={`/app/products/${product.id}`} className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50">Open product profile</Link>}
                    <Link to="/app/warehouse/receiving" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Receive this product</Link>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <p className="text-gray-500">No unit found for "{scanInput}"</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Create New Unit
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create New Unit Form */}
      {showCreate && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold">Create New Product Unit</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Product</label>
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search product by name or SKU..."
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              {productsData?.items && productsData.items.length > 0 && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border">
                  {productsData.items.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedProductId(p.id)
                        setSearchInput(`${p.name} (${p.item_code})`)
                      }}
                      className={`flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                        selectedProductId === p.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <span>{p.name}</span>
                      <span className="text-gray-400">{p.item_code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1">Serial Number</label>
                <input
                  type="text"
                  value={newSerial}
                  onChange={(e) => setNewSerial(e.target.value)}
                  placeholder="Auto-generated if empty"
                  className="w-full rounded-md border px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Location</label>
                <input
                  type="text"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  placeholder="e.g. RACK-A01"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCreateUnit}
                disabled={!selectedProductId || createUnit.isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {createUnit.isPending ? 'Creating...' : 'Create Unit'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setSearchInput('') }}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
