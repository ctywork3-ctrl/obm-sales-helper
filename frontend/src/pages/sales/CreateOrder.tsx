import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateSalesOrder } from '@/hooks/useSalesOrders'
import { useCustomers } from '@/hooks/useCustomers'
import { useProducts } from '@/hooks/useProducts'
import SearchInput from '@/components/SearchInput'
import LoadingSpinner from '@/components/LoadingSpinner'
import { formatCurrency } from '@/lib/utils'
import { getUploadUrl } from '@/api/client'
import { Plus, Minus, Trash2, ShoppingCart } from 'lucide-react'

interface OrderItem {
  product_id: number
  product_name: string
  product_code: string
  product_image: string | null
  quantity: number
  unit_price: number
  notes: string
}

export default function CreateOrder() {
  const navigate = useNavigate()
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [items, setItems] = useState<OrderItem[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [error, setError] = useState('')

  const { data: customersData, isLoading: customersLoading } = useCustomers({
    page_size: 100,
  })
  const { data: productsData, isLoading: productsLoading } = useProducts({
    search: productSearch || undefined,
    page_size: 20,
  })
  const createOrder = useCreateSalesOrder()

  const customers = customersData?.items || []

  const addItem = (product: any) => {
    if (items.find((i) => i.product_id === product.id)) return
    setItems([
      ...items,
      {
        product_id: product.id,
        product_name: product.name,
        product_code: product.obm_item_code || product.item_code,
        product_image: product.images?.[0]?.file_path || null,
        quantity: 1,
        unit_price: product.selling_price,
        notes: '',
      },
    ])
    setProductSearch('')
  }

  const updateItem = (index: number, field: keyof OrderItem, value: any) => {
    const updated = [...items]
    updated[index] = { ...updated[index], [field]: value }
    setItems(updated)
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const total = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)

  const handleSubmit = async () => {
    if (!selectedCustomerId) {
      setError('Please select a customer')
      return
    }
    if (items.length === 0) {
      setError('Please add at least one item')
      return
    }

    setError('')
    try {
      const order = await createOrder.mutateAsync({
        customer_id: selectedCustomerId,
        delivery_address: deliveryAddress,
        notes: orderNotes,
        items: items.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          notes: item.notes,
        })),
      })
      navigate(`/sales/orders/${order.id}`)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create order')
    }
  }

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShoppingCart className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Create Sales Order</h1>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Customer</h2>
        {customersLoading ? (
          <LoadingSpinner />
        ) : (
          <div className="space-y-2">
            <select
              value={selectedCustomerId || ''}
              onChange={(e) => setSelectedCustomerId(Number(e.target.value) || null)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">-- Select a customer --</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} {customer.code === 'WALK-IN' ? '(Walk-in)' : `(${customer.code})`}
                </option>
              ))}
            </select>
            {selectedCustomer && (
              <div className="rounded-md bg-gray-50 p-3 text-sm text-muted-foreground">
                {selectedCustomer.phone && selectedCustomer.phone !== '-' && (
                  <span>Phone: {selectedCustomer.phone}</span>
                )}
                {selectedCustomer.address && selectedCustomer.address !== '-' && (
                  <span> | Address: {selectedCustomer.address}</span>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Don't see your customer?{' '}
              <a href="/sales/customers/new" className="text-primary underline">
                Add new customer
              </a>
            </p>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Add Products</h2>
        <SearchInput
          value={productSearch}
          onChange={setProductSearch}
          placeholder="Search products to add..."
        />
        {productsLoading && (
          <div className="flex justify-center py-4">
            <LoadingSpinner />
          </div>
        )}
        {productsData?.items && productsData.items.length > 0 && (
          <div className="mt-3 max-h-60 overflow-y-auto border rounded-md">
            {productsData.items.map((product) => (
              <button
                key={product.id}
                onClick={() => addItem(product)}
                disabled={items.some((i) => i.product_id === product.id)}
                className="flex w-full items-center gap-3 border-b p-3 text-left hover:bg-accent disabled:opacity-50 last:border-0"
              >
                <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                  {product.images?.[0] ? (
                    <img
                      src={getUploadUrl(product.images[0].file_path)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      No img
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{product.name}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {product.obm_item_code || product.item_code} | Stock: {product.stock_qty}
                  </p>
                </div>
                <span className="font-semibold flex-shrink-0">{formatCurrency(product.selling_price)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Order Items ({items.length})</h2>

          <div className="mb-2 hidden sm:grid sm:grid-cols-12 gap-2 px-3 text-xs font-medium text-muted-foreground">
            <div className="col-span-5">Product</div>
            <div className="col-span-2 text-center">Qty</div>
            <div className="col-span-2 text-center">Unit Price</div>
            <div className="col-span-2 text-right">Subtotal</div>
            <div className="col-span-1"></div>
          </div>

          <div className="space-y-2">
            {items.map((item, index) => (
              <div
                key={item.product_id}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 items-center rounded-md border p-3"
              >
                <div className="col-span-5 flex items-center gap-3">
                  <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                    {item.product_image ? (
                      <img
                        src={getUploadUrl(item.product_image)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        No img
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{item.product_name}</p>
                    <p className="text-xs text-muted-foreground">{item.product_code}</p>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground sm:hidden">Qty</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => updateItem(index, 'quantity', Math.max(1, item.quantity - 1))}
                      className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-md border hover:bg-gray-100 active:bg-gray-200"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
                      className="h-9 w-full min-w-0 rounded-md border px-2 text-sm text-center"
                    />
                    <button
                      type="button"
                      onClick={() => updateItem(index, 'quantity', item.quantity + 1)}
                      className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-md border hover:bg-gray-100 active:bg-gray-200"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground sm:hidden">Unit Price (RM)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unit_price}
                    onChange={(e) => updateItem(index, 'unit_price', Number(e.target.value))}
                    className="h-9 w-full rounded-md border px-2 text-sm text-center"
                  />
                </div>
                <div className="col-span-2 text-right font-semibold text-sm">
                  {formatCurrency(item.quantity * item.unit_price)}
                </div>
                <div className="col-span-1 text-right">
                  <button
                    onClick={() => removeItem(index)}
                    className="rounded-md p-1 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <span className="text-lg font-semibold">Total ({items.length} items)</span>
            <span className="text-xl font-bold text-primary">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Delivery & Notes</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium">Delivery Address</label>
            <textarea
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              rows={2}
              placeholder="Enter delivery address..."
              className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Notes</label>
            <textarea
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              rows={2}
              placeholder="Any special instructions..."
              className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md border px-4 py-2.5 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={createOrder.isPending || items.length === 0 || !selectedCustomerId}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <ShoppingCart className="h-4 w-4" />
          {createOrder.isPending ? 'Creating...' : 'Submit Order'}
        </button>
      </div>
    </div>
  )
}
