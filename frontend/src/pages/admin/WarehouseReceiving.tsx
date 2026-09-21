import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PackagePlus, Plus, Trash2, Printer, Camera } from 'lucide-react'
import { useProducts } from '@/hooks/useProducts'
import { inventoryApi, inventoryPrivateMedia } from '@/api/inventory'
import { purchaseOrdersApi } from '@/api/purchaseOrders'
import { getUploadUrl } from '@/api/client'
import { getApiErrorMessage } from '@/lib/apiError'
import WorkflowHeader from '@/components/WorkflowHeader'
import SafeImage from '@/components/SafeImage'
import LoadingSpinner from '@/components/LoadingSpinner'

interface ReceiptLine {
  product: any
  quantity: number
  tracking_mode: 'SERIALIZED' | 'BULK'
  batch_number: string
  unit_cost: string
  manufacturer_serials: string
  purchase_order_line_id?: number
}

function evidenceHint(policy?: string | null): string | null {
  if (policy === 'UNIT') return 'Unit photo required: capture each serialized unit.'
  if (policy === 'NONE') return 'No photo needed for this product.'
  return null
}

export default function WarehouseReceiving() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const poParam = searchParams.get('po')
  const queryClient = useQueryClient()
  const [productSearch, setProductSearch] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [warehouseLocation, setWarehouseLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<ReceiptLine[]>([])
  const [receipt, setReceipt] = useState<any>(null)
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [evidenceCaption, setEvidenceCaption] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [poPrefilled, setPoPrefilled] = useState(false)

  const { data: productsData, isLoading: productsLoading } = useProducts({
    search: productSearch || undefined,
    page_size: 12,
  })

  const { data: purchaseOrder, isLoading: poLoading } = useQuery({
    queryKey: ['purchase-order', poParam],
    queryFn: () => purchaseOrdersApi.get(Number(poParam)).then((res) => res.data),
    enabled: Boolean(poParam),
  })

  useEffect(() => {
    if (!purchaseOrder || poPrefilled) return
    if (purchaseOrder.status !== 'SENT' && purchaseOrder.status !== 'PARTIALLY_RECEIVED') {
      setError(`Purchase order ${purchaseOrder.po_number} is ${purchaseOrder.status} and cannot be received against.`)
      return
    }
    setSupplierName(purchaseOrder.supplier_name || '')
    setLines(
      (purchaseOrder.lines || [])
        .filter((line: any) => line.quantity_outstanding > 0)
        .map((line: any) => ({
          product: {
            id: line.product_id,
            name: line.product_name || `Product #${line.product_id}`,
            item_code: line.product_code,
            images: [],
            evidence_policy: line.evidence_policy || 'RECEIPT',
            inventory_model: line.inventory_model || 'BULK',
          },
          quantity: line.quantity_outstanding,
          tracking_mode: line.inventory_model === 'SERIALIZED' ? 'SERIALIZED' : 'BULK',
          batch_number: '',
          unit_cost: line.unit_cost != null ? String(line.unit_cost) : '',
          manufacturer_serials: '',
          purchase_order_line_id: line.id,
        }))
    )
    setPoPrefilled(true)
    setSuccess(`Prefilled ${purchaseOrder.po_number}: adjust quantities to what actually arrived.`)
  }, [purchaseOrder, poPrefilled])

  const receive = useMutation({
    mutationFn: () => inventoryApi.receive({
      supplier_name: supplierName || undefined,
      reference_number: referenceNumber || undefined,
      warehouse_location: warehouseLocation || undefined,
      notes: notes || undefined,
      purchase_order_id: poParam ? Number(poParam) : undefined,
      lines: lines.map((line) => ({
        product_id: line.product.id,
        quantity: line.quantity,
        tracking_mode: line.tracking_mode,
        batch_number: line.batch_number || undefined,
        unit_cost: line.unit_cost ? Number(line.unit_cost) : undefined,
        manufacturer_serials: line.manufacturer_serials
          .split(/[,\n]+/)
          .map((value) => value.trim())
          .filter(Boolean),
        purchase_order_line_id: line.purchase_order_line_id,
      })),
    }),
    onSuccess: (response) => {
      setReceipt(response.data)
      setSuccess(`${response.data.receipt_number} posted successfully. Stock and ledger updated.`)
      setError('')
      setLines([])
      setProductSearch('')
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not post inventory receipt')),
  })

  const uploadEvidence = useMutation({
    mutationFn: () => inventoryApi.uploadReceiptImage(receipt.id, evidenceFile!, evidenceCaption),
    onSuccess: (response) => {
      setReceipt((current: any) => ({ ...current, images: [...(current.images || []), response.data] }))
      setEvidenceFile(null)
      setEvidenceCaption('')
      setSuccess('Receiving evidence photo uploaded')
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not upload evidence photo')),
  })

  const addLine = (product: any) => {
    if (lines.some((line) => line.product.id === product.id)) return
    const model = (product.inventory_model || 'BULK').toUpperCase()
    setLines([
      ...lines,
      {
        product,
        quantity: 1,
        tracking_mode: model === 'SERIALIZED' ? 'SERIALIZED' : 'BULK',
        batch_number: '',
        unit_cost: '',
        manufacturer_serials: '',
      },
    ])
    setProductSearch('')
  }

  const updateLine = (index: number, patch: Partial<ReceiptLine>) => {
    setLines((current) => current.map((line, lineIndex) => (
      lineIndex === index ? { ...line, ...patch } : line
    )))
  }

  const totalQuantity = lines.reduce((total, line) => total + line.quantity, 0)

  return (
    <div className="space-y-6">
      <WorkflowHeader
        title="Goods Received"
        subtitle="Register incoming inventory, create unit identities, and update stock in one transaction."
        icon={<PackagePlus className="h-5 w-5" />}
        backLabel="Back to warehouse"
        onBack={() => navigate('/app/warehouse/scanner')}
      />

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}

      {poParam && !receipt && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm">
          {poLoading ? (
            <span className="inline-flex items-center gap-2"><LoadingSpinner /> Loading purchase order...</span>
          ) : purchaseOrder ? (
            <p>
              Receiving against <Link to={`/app/purchase-orders/${purchaseOrder.id}`} className="font-mono font-medium underline">{purchaseOrder.po_number}</Link>
              {' '}({purchaseOrder.supplier_name}) — lines prefilled with outstanding quantities. Shortages and over-delivery update the PO automatically.
            </p>
          ) : null}
        </div>
      )}

      {!receipt && (
        <>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm">
                <span className="font-medium">Supplier</span>
                <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Supplier name" className="mt-1 w-full rounded-md border px-3 py-2" />
              </label>
              <label className="text-sm">
                <span className="font-medium">Delivery note / reference</span>
                <input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="DN-2026-001" className="mt-1 w-full rounded-md border px-3 py-2" />
              </label>
              <label className="text-sm">
                <span className="font-medium">Warehouse location</span>
                <input value={warehouseLocation} onChange={(e) => setWarehouseLocation(e.target.value)} placeholder="MAIN-RACK-A" className="mt-1 w-full rounded-md border px-3 py-2" />
              </label>
              <label className="text-sm">
                <span className="font-medium">Notes</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condition or receiving notes" className="mt-1 w-full rounded-md border px-3 py-2" />
              </label>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Products received</h2>
                <p className="text-sm text-muted-foreground">Select manager-created products. Unknown items should be submitted as a product request.</p>
              </div>
              <Link to="/app/warehouse/unknown-product" className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50">Unknown product request</Link>
            </div>

            <div className="relative mt-4">
              <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search product name, SKU, or barcode..." className="w-full rounded-md border px-3 py-2" />
              {productSearch.length >= 2 && (
                <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-white shadow-lg">
                  {productsLoading && <p className="p-3 text-sm text-muted-foreground">Searching...</p>}
                  {(productsData?.items || []).map((product: any) => (
                    <button type="button" key={product.id} onClick={() => addLine(product)} disabled={lines.some((line) => line.product.id === product.id)} className="flex w-full items-center gap-3 border-b p-3 text-left hover:bg-gray-50 disabled:opacity-50">
                      <SafeImage src={product.images?.[0] ? getUploadUrl(product.images[0].file_path) : null} alt={product.name} className="h-10 w-10 rounded object-cover" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{product.name}</span>
                        <span className="block text-xs text-muted-foreground">{product.item_code || product.obm_item_code || '-'} · Current stock {product.stock_qty ?? 0}</span>
                      </span>
                      <Plus className="h-4 w-4" />
                    </button>
                  ))}
                  {!productsLoading && (productsData?.items || []).length === 0 && <p className="p-3 text-sm text-muted-foreground">No product found. Use Unknown product request.</p>}
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {lines.map((line, index) => (
                <div key={line.product.id} className="rounded-lg border p-3">
                  <div className="flex items-start gap-3">
                    <SafeImage src={line.product.images?.[0] ? getUploadUrl(line.product.images[0].file_path) : null} alt={line.product.name} className="h-12 w-12 rounded object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{line.product.name}</p>
                      <p className="text-xs text-muted-foreground">{line.product.item_code || line.product.obm_item_code || '-'}</p>
                      {evidenceHint(line.product.evidence_policy) && (
                        <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          {evidenceHint(line.product.evidence_policy)}
                        </p>
                      )}
                    </div>
                    <button type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} className="rounded p-1 text-muted-foreground hover:text-red-600" title="Remove product">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <label className="text-sm"><span className="font-medium">Quantity</span><input type="number" min="1" value={line.quantity} onChange={(e) => updateLine(index, { quantity: Math.max(1, Number(e.target.value) || 1) })} className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                    <div className="text-sm"><span className="font-medium">Tracking</span><p className="mt-1 rounded-md bg-gray-100 px-3 py-2 text-muted-foreground">{line.tracking_mode === 'SERIALIZED' ? 'One barcode per unit' : 'Count quantity only'}</p></div>
                    <label className="text-sm"><span className="font-medium">Batch / lot</span><input value={line.batch_number} onChange={(e) => updateLine(index, { batch_number: e.target.value })} placeholder="Optional" className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                    <label className="text-sm"><span className="font-medium">Unit cost</span><input type="number" min="0" step="0.01" value={line.unit_cost} onChange={(e) => updateLine(index, { unit_cost: e.target.value })} placeholder="Optional" className="mt-1 w-full rounded-md border px-3 py-2" /></label>
                    {line.tracking_mode === 'SERIALIZED' && <label className="text-sm sm:col-span-2 lg:col-span-5"><span className="font-medium">Manufacturer serials</span><textarea value={line.manufacturer_serials} onChange={(e) => updateLine(index, { manufacturer_serials: e.target.value })} placeholder="Optional: one serial per line or comma-separated. Leave blank to generate internal unit IDs." rows={2} className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm" /></label>}
                  </div>
                </div>
              ))}
              {lines.length === 0 && <div className="rounded-md bg-gray-50 p-6 text-center text-sm text-muted-foreground">Search and select a product to begin receiving.</div>}
            </div>
          </div>

          <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-gray-50 p-4 sm:rounded-lg sm:border">
            <span className="text-sm text-muted-foreground">{lines.length} product lines · {totalQuantity} total units</span>
            <button type="button" onClick={() => receive.mutate()} disabled={receive.isPending || lines.length === 0} className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {receive.isPending ? 'Posting receipt...' : 'Post Received Stock'}
            </button>
          </div>
        </>
      )}

      {receipt && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-sm text-muted-foreground">Posted receipt</p><h2 className="text-xl font-semibold">{receipt.receipt_number}</h2><p className="text-sm text-green-700">Inventory and stock ledger updated.</p></div>
              {receipt.units?.length > 0 && <Link to={`/app/warehouse/labels?units=${receipt.units.map((unit: any) => unit.id).join(',')}`} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><Printer className="h-4 w-4" /> Print unit labels</Link>}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md bg-gray-50 p-3"><p className="text-xs text-muted-foreground">Supplier</p><p className="font-medium">{receipt.supplier_name || '-'}</p></div>
              <div className="rounded-md bg-gray-50 p-3"><p className="text-xs text-muted-foreground">Reference</p><p className="font-medium">{receipt.reference_number || '-'}</p></div>
              <div className="rounded-md bg-gray-50 p-3"><p className="text-xs text-muted-foreground">Units created</p><p className="font-medium">{receipt.units?.length || 0} serialized · {receipt.lines?.filter((line: any) => line.tracking_mode === 'BULK').reduce((total: number, line: any) => total + line.quantity, 0) || 0} bulk</p></div>
            </div>
          </div>

          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Receiving evidence</h2>
            <p className="mb-3 text-sm text-muted-foreground">Photos are private warehouse evidence, separate from manager-approved catalog images.</p>
            <div className="flex flex-col gap-2 sm:flex-row"><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)} className="block w-full text-sm" /><input value={evidenceCaption} onChange={(e) => setEvidenceCaption(e.target.value)} placeholder="Caption" className="rounded-md border px-3 py-2 text-sm" /><button type="button" disabled={!evidenceFile || uploadEvidence.isPending} onClick={() => uploadEvidence.mutate()} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"><Camera className="h-4 w-4" /> Upload</button></div>
            {receipt.images?.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{receipt.images.map((image: any) => <div key={image.id} className="overflow-hidden rounded-md border"><SafeImage src={inventoryPrivateMedia.receiptImage(image.id)} alt={image.caption || 'Receiving evidence'} className="h-28 w-full object-cover" /><p className="truncate px-2 py-1 text-xs text-muted-foreground">{image.caption || 'Evidence photo'}</p></div>)}</div>}
          </div>

          {receipt.units?.length > 0 && <div className="rounded-lg border bg-white p-4 shadow-sm"><h2 className="mb-3 font-semibold">Generated unit identities</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="pb-2">Unit ID</th><th className="pb-2">Barcode</th><th className="pb-2">Product</th><th className="pb-2">Location</th></tr></thead><tbody>{receipt.units.map((unit: any) => <tr key={unit.id} className="border-b last:border-0"><td className="py-2 font-mono">{unit.unit_code}</td><td className="py-2 font-mono">{unit.barcode}</td><td className="py-2">{unit.product_name}</td><td className="py-2">{unit.warehouse_location || '-'}</td></tr>)}</tbody></table></div></div>}

          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setReceipt(null); setSuccess(''); setSupplierName(''); setReferenceNumber(''); setNotes(''); setPoPrefilled(false); setLines([]) }} className="rounded-md border px-4 py-2 text-sm font-medium">Receive another shipment</button><Link to="/app/warehouse/scanner" className="rounded-md border px-4 py-2 text-sm font-medium">Open scanner</Link></div>
        </div>
      )}
    </div>
  )
}
