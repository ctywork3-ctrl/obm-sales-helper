import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { useProduct, useCreateProduct, useUpdateProduct } from '@/hooks/useProducts'
import { getApiErrorMessage } from '@/lib/apiError'
import { masterDataApi } from '@/api/masterData'
import LoadingSpinner from '@/components/LoadingSpinner'
import { ArrowLeft } from 'lucide-react'

export default function ProductForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEdit = !!id

  const [obmItemCode, setObmItemCode] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [brand, setBrand] = useState('')
  const [uom, setUom] = useState('pcs')
  const [description, setDescription] = useState('')
  const [sellingPrice, setSellingPrice] = useState(0)
  const [costPrice, setCostPrice] = useState(0)
  const [stockSource, setStockSource] = useState('')
  const [barcode, setBarcode] = useState('')
  const [evidencePolicy, setEvidencePolicy] = useState('RECEIPT')
  const [inventoryModel, setInventoryModel] = useState('BULK')
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState('')

  const { data: existing, isLoading: loadingProduct } = useProduct(Number(id))
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const { data: categories = [] } = useQuery({
    queryKey: ['master-data', 'categories'],
    queryFn: () => masterDataApi.categories().then((response) => response.data),
  })

  useEffect(() => {
    if (existing) {
      setObmItemCode(existing.obm_item_code)
      setItemCode(existing.item_code)
      setName(existing.name)
      setCategory(existing.category)
      setCategoryId(existing.category_id || null)
      setBrand(existing.brand)
      setUom(existing.uom)
      setDescription(existing.description)
      setSellingPrice(existing.selling_price)
      setCostPrice(existing.cost_price)
      setStockSource(existing.stock_source)
      setBarcode(existing.barcode)
      setEvidencePolicy(existing.evidence_policy || 'RECEIPT')
      setInventoryModel(existing.inventory_model || 'BULK')
      setIsActive(existing.is_active)
    }
  }, [existing])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const data = {
      obm_item_code: obmItemCode,
      item_code: itemCode,
      name,
      category,
      category_id: categoryId || undefined,
      brand,
      uom,
      description,
      selling_price: sellingPrice,
      cost_price: costPrice,
      stock_source: stockSource,
      barcode,
      evidence_policy: evidencePolicy,
      inventory_model: inventoryModel,
      is_active: isActive,
    }

    try {
      if (isEdit) {
        await updateProduct.mutateAsync({ id: Number(id), data })
      } else {
        await createProduct.mutateAsync({ ...data, stock_qty: 0 })
      }
      navigate('/app/admin/products')
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to save product'))
    }
  }

  if (isEdit && loadingProduct) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="mb-6 text-2xl font-bold">
          {isEdit ? 'Edit Product' : 'Create Product'}
        </h1>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">OBM Item Code</label>
              <input
                type="text"
                value={obmItemCode}
                onChange={(e) => setObmItemCode(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Item Code</label>
              <input
                type="text"
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
                required
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium">Product Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium">Category</label>
              <select
                value={categoryId || ''}
                onChange={(e) => {
                  const nextId = Number(e.target.value) || null
                  setCategoryId(nextId)
                  const selected = categories.find((item) => item.id === nextId)
                  if (selected) setCategory(selected.name)
                }}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select manager category</option>
                {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {categories.length === 0 && <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Legacy category text" className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />}
            </div>
            <div>
              <label className="block text-sm font-medium">Brand</label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">UOM</label>
              <select
                value={uom}
                onChange={(e) => setUom(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="pcs">Pcs</option>
                <option value="kg">Kg</option>
                <option value="ltr">Ltr</option>
                <option value="box">Box</option>
                <option value="set">Set</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Selling Price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(Number(e.target.value))}
                required
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Cost Price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={costPrice}
                onChange={(e) => setCostPrice(Number(e.target.value))}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          {isEdit && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                Stock quantity is managed through receiving and adjustments, not this form.
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Current stock: {existing?.stock_qty ?? '—'} {existing?.uom ?? ''}
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Barcode</label>
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Stock Source</label>
              <input
                type="text"
                value={stockSource}
                onChange={(e) => setStockSource(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Receiving photo policy</label>
            <select
              value={evidencePolicy}
              onChange={(e) => setEvidencePolicy(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="RECEIPT">Receipt photo (one photo per delivery)</option>
              <option value="UNIT">Unit photo (photo per serialized unit)</option>
              <option value="NONE">No photo needed (e.g. nails, consumables)</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Controls what warehouse staff are asked to photograph when receiving this product.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium">Stock tracking</label>
            <select
              value={inventoryModel}
              onChange={(e) => setInventoryModel(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="BULK">Just count quantity (nails, line, lures)</option>
              <option value="SERIALIZED">Track each unit (rods, reels, parts)</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Tracked items get one barcode per unit and stock follows the unit count.
            </p>
          </div>
          </div>

          <div>
            <label className="block text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="isActive" className="text-sm font-medium">
              Active
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createProduct.isPending || updateProduct.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createProduct.isPending || updateProduct.isPending
                ? 'Saving...'
                : isEdit
                ? 'Update Product'
                : 'Create Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
