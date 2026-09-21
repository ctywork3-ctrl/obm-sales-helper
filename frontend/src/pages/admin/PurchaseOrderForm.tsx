import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FilePlus, Plus, Trash2, Upload } from 'lucide-react'
import { useProducts } from '@/hooks/useProducts'
import { productsApi } from '@/api/products'
import { purchaseOrdersApi } from '@/api/purchaseOrders'
import { getApiErrorMessage } from '@/lib/apiError'
import WorkflowHeader from '@/components/WorkflowHeader'
import SafeImage from '@/components/SafeImage'
import { getUploadUrl } from '@/api/client'

interface POLine {
  product: any
  quantity_ordered: number
  unit_cost: string
}

interface ExtractedLine {
  item_code?: string
  name?: string
  quantity?: number
  unit_price?: number | null
  matched?: 'pending' | 'matched' | 'missing'
  matchedProduct?: any
}

export default function PurchaseOrderForm() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [supplierName, setSupplierName] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [lines, setLines] = useState<POLine[]>([])
  const [docFile, setDocFile] = useState<File | null>(null)
  const [docMessage, setDocMessage] = useState('')
  const [extracted, setExtracted] = useState<ExtractedLine[]>([])
  const [error, setError] = useState('')

  const { data: productsData, isLoading: productsLoading } = useProducts({
    search: productSearch || undefined,
    page_size: 12,
  })

  const createPO = useMutation({
    mutationFn: () => purchaseOrdersApi.create({
      supplier_name: supplierName,
      expected_date: expectedDate || undefined,
      notes: notes || undefined,
      lines: lines.map((line) => ({
        product_id: line.product.id,
        quantity_ordered: line.quantity_ordered,
        unit_cost: line.unit_cost ? Number(line.unit_cost) : undefined,
      })),
    }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      navigate(`/app/purchase-orders/${response.data.id}`)
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Failed to create purchase order')),
  })

  const matchExtractedLine = async (line: ExtractedLine): Promise<ExtractedLine> => {
    const q = line.item_code || line.name || ''
    if (!q) return { ...line, matched: 'missing' }
    try {
      const res = await productsApi.list({ search: q, page_size: 5 })
      const items = res.data?.items || []
      const exact = items.find((p: any) =>
        (line.item_code && (p.item_code === line.item_code || p.obm_item_code === line.item_code))
        || (line.name && p.name.toLowerCase() === (line.name || '').toLowerCase())
      )
      if (exact) return { ...line, matched: 'matched', matchedProduct: exact }
      return { ...line, matched: items.length ? 'pending' : 'missing' }
    } catch {
      return { ...line, matched: 'missing' }
    }
  }

  const uploadDoc = useMutation({
    mutationFn: () => purchaseOrdersApi.uploadDocument(docFile!),
    onSuccess: async (response) => {
      const d = response.data
      setDocMessage(d.message)
      setDocFile(null)
      if (d.supplier_name && !supplierName) setSupplierName(d.supplier_name)
      if (d.po_number) setNotes((n) => (n ? n : `Supplier PO: ${d.po_number}`))
      if (d.lines?.length) {
        const matched = await Promise.all(
          d.lines.map((line) => matchExtractedLine({ ...line, matched: 'pending' }))
        )
        setExtracted(matched)
      }
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Failed to upload document')),
  })

  const acceptExtractedLine = (line: ExtractedLine) => {
    if (!line.matchedProduct) return
    if (lines.some((l) => l.product.id === line.matchedProduct.id)) return
    setLines((cur) => [...cur, {
      product: line.matchedProduct,
      quantity_ordered: line.quantity || 1,
      unit_cost: line.unit_price != null ? String(line.unit_price) : '',
    }])
    setExtracted((cur) => cur.filter((l) => l !== line))
  }

  const addLine = (product: any) => {
    if (lines.some((line) => line.product.id === product.id)) return
    setLines([...lines, { product, quantity_ordered: 1, unit_cost: '' }])
    setProductSearch('')
  }

  return (
    <div className="space-y-6">
      <WorkflowHeader
        title="New Purchase Order"
        subtitle="Record what was ordered from the supplier. Warehouse receives against it when stock arrives."
        icon={<FilePlus className="h-5 w-5" />}
        backLabel="Back to purchase orders"
        onBack={() => navigate('/app/purchase-orders')}
      />

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">Supplier document (optional)</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Upload the supplier PO or invoice. The file is stored for review only — nothing is created or stocked automatically.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => setDocFile(e.target.files?.[0] || null)}
            className="block w-full text-sm"
          />
          <button
            type="button"
            disabled={!docFile || uploadDoc.isPending}
            onClick={() => uploadDoc.mutate()}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {uploadDoc.isPending ? 'Uploading...' : 'Attach'}
          </button>
        </div>
        {docMessage && <p className="mt-2 text-sm text-green-700">{docMessage}</p>}

        {extracted.length > 0 && (
          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm font-semibold">AI read these lines — please check and add</p>
            <div className="mt-2 space-y-2">
              {extracted.map((line, i) => (
                <div key={i} className="flex items-center gap-3 rounded-md border bg-white p-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {line.name || line.item_code || 'Unknown item'}
                      {line.item_code && <span className="ml-1 text-muted-foreground">({line.item_code})</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Qty {line.quantity ?? '?'}{line.unit_price != null ? ` · ${line.unit_price}` : ''}
                    </p>
                  </div>
                  {line.matched === 'matched' ? (
                    <button type="button" onClick={() => acceptExtractedLine(line)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                      Add
                    </button>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">
                      {line.matched === 'missing' ? 'Not found — add manually' : 'Check name'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="font-medium">Supplier *</span>
            <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Supplier B" className="mt-1 w-full rounded-md border px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="font-medium">Expected date</span>
            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="font-medium">Notes</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="mt-1 w-full rounded-md border px-3 py-2" />
          </label>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">Ordered lines</h2>
        <input
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
          placeholder="Search product name, SKU, or barcode..."
          className="w-full rounded-md border px-3 py-2"
        />
        {productSearch.length >= 2 && (
          <div className="mt-1 max-h-64 overflow-y-auto rounded-md border bg-white shadow-lg">
            {productsLoading && <p className="p-3 text-sm text-muted-foreground">Searching...</p>}
            {(productsData?.items || []).map((product: any) => (
              <button
                type="button"
                key={product.id}
                onClick={() => addLine(product)}
                disabled={lines.some((line) => line.product.id === product.id)}
                className="flex w-full items-center gap-3 border-b p-3 text-left hover:bg-gray-50 disabled:opacity-50"
              >
                <SafeImage src={product.images?.[0] ? getUploadUrl(product.images[0].file_path) : null} alt={product.name} className="h-10 w-10 rounded object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{product.name}</span>
                  <span className="block text-xs text-muted-foreground">{product.item_code || product.obm_item_code || '-'}</span>
                </span>
                <Plus className="h-4 w-4" />
              </button>
            ))}
            {!productsLoading && (productsData?.items || []).length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">No product found. Create the product first, or submit an unknown-product request.</p>
            )}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {lines.map((line, index) => (
            <div key={line.product.id} className="rounded-lg border p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{line.product.name}</p>
                  <p className="text-xs text-muted-foreground">{line.product.item_code || line.product.obm_item_code || '-'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  className="rounded p-1 text-muted-foreground hover:text-red-600"
                  title="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="font-medium">Quantity ordered *</span>
                  <input
                    type="number" min="1" value={line.quantity_ordered}
                    onChange={(e) => setLines((current) => current.map((l, i) => i === index ? { ...l, quantity_ordered: Math.max(1, Number(e.target.value) || 1) } : l))}
                    className="mt-1 w-full rounded-md border px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  <span className="font-medium">Unit cost</span>
                  <input
                    type="number" min="0" step="0.01" value={line.unit_cost}
                    onChange={(e) => setLines((current) => current.map((l, i) => i === index ? { ...l, unit_cost: e.target.value } : l))}
                    placeholder="Optional"
                    className="mt-1 w-full rounded-md border px-3 py-2"
                  />
                </label>
              </div>
            </div>
          ))}
          {lines.length === 0 && (
            <div className="rounded-md bg-gray-50 p-6 text-center text-sm text-muted-foreground">
              Search and select products to add ordered lines.
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-gray-50 p-4 sm:rounded-lg sm:border">
        <span className="text-sm text-muted-foreground">{lines.length} lines</span>
        <button
          type="button"
          onClick={() => createPO.mutate()}
          disabled={createPO.isPending || lines.length === 0 || !supplierName.trim()}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {createPO.isPending ? 'Creating...' : 'Create purchase order'}
        </button>
      </div>
    </div>
  )
}
