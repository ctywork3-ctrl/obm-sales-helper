import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { productsApi } from '@/api/products'
import { getApiErrorMessage } from '@/lib/apiError'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmDialog from '@/components/ConfirmDialog'
import WorkflowHeader from '@/components/WorkflowHeader'
import { Trash2, Plus, Tag } from 'lucide-react'

const CURRENCIES = ['MYR', 'SGD']

export default function ProductPrices() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [deletePriceId, setDeletePriceId] = useState<number | null>(null)
  const [currency, setCurrency] = useState('SGD')
  const [price, setPrice] = useState('')
  const [minQty, setMinQty] = useState('')
  const [error, setError] = useState('')

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => productsApi.get(Number(id)).then((res) => res.data),
    enabled: !!id,
  })

  const { data: prices = [] } = useQuery({
    queryKey: ['product-prices', id],
    queryFn: () => productsApi.listPrices(Number(id)).then((res) => res.data),
    enabled: !!id,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['product-prices', id] })
    queryClient.invalidateQueries({ queryKey: ['product', id] })
    queryClient.invalidateQueries({ queryKey: ['products'] })
  }

  const createPrice = useMutation({
    mutationFn: () =>
      productsApi.createPrice(Number(id), {
        currency,
        unit_price: Number(price),
        min_qty: minQty ? Number(minQty) : null,
      }),
    onSuccess: () => {
      invalidate()
      setPrice('')
      setMinQty('')
      setError('')
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Failed to add price')),
  })

  const deletePrice = useMutation({
    mutationFn: (priceId: number) => productsApi.deletePrice(priceId),
    onSuccess: () => {
      invalidate()
      setDeletePriceId(null)
      setError('')
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Failed to delete price')),
  })

  const toggleActive = useMutation({
    mutationFn: ({ priceId, isActive }: { priceId: number; isActive: boolean }) =>
      productsApi.updatePrice(priceId, { is_active: isActive }),
    onSuccess: invalidate,
    onError: (err) => setError(getApiErrorMessage(err, 'Failed to update price')),
  })

  const availableCurrencies = CURRENCIES.filter((c) => !prices.some((p) => p.currency === c))

  const handleAdd = () => {
    if (!price || Number(price) <= 0) {
      setError('Enter a price greater than zero')
      return
    }
    createPrice.mutate()
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <WorkflowHeader
        title="Currency Price List"
        subtitle="Set per-currency selling prices. Orders in a currency use these prices when available."
        icon={<Tag className="h-5 w-5" />}
        backLabel="Back to product"
        onBack={() => navigate(`/app/admin/products/${id}/edit`)}
      />

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">
          {product?.name} ({product?.obm_item_code || product?.item_code})
        </p>
        <p className="mt-1 text-sm">
          Base price (MYR): <span className="font-medium">RM {product?.selling_price ?? '-'}</span>
        </p>

        {prices.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 font-medium">Currency</th>
                <th className="pb-2 font-medium">Unit Price</th>
                <th className="pb-2 font-medium">Min Qty</th>
                <th className="pb-2 font-medium">Active</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-2 font-medium">{p.currency}</td>
                  <td className="py-2">
                    {p.currency === 'MYR' ? 'RM' : 'S$'} {Number(p.unit_price).toFixed(2)}
                  </td>
                  <td className="py-2 text-muted-foreground">{p.min_qty ?? '-'}</td>
                  <td className="py-2">
                    <button
                      onClick={() => toggleActive.mutate({ priceId: p.id, isActive: !p.is_active })}
                      disabled={toggleActive.isPending}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {p.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => setDeletePriceId(p.id)}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      title="Delete price"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {prices.length === 0 && (
          <div className="mt-4 py-6 text-center text-sm text-muted-foreground">
            No currency-specific prices yet. Orders will use the base MYR price.
          </div>
        )}

        {availableCurrencies.length > 0 && (
          <div className="mt-6 border-t pt-4">
            <p className="mb-2 text-sm font-medium">Add price</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                {availableCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Unit price *"
                className="rounded-md border px-3 py-2 text-sm"
              />
              <input
                type="number"
                min="1"
                value={minQty}
                onChange={(e) => setMinQty(e.target.value)}
                placeholder="Min qty"
                className="rounded-md border px-3 py-2 text-sm"
              />
              <button
                onClick={handleAdd}
                disabled={createPrice.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {createPrice.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deletePriceId}
        onOpenChange={(open) => !open && setDeletePriceId(null)}
        title="Delete Price"
        description="Are you sure you want to delete this currency price?"
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => deletePriceId && deletePrice.mutate(deletePriceId)}
        isLoading={deletePrice.isPending}
      />
    </div>
  )
}
