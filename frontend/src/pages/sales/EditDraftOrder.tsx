import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { salesOrdersApi } from '@/api/salesOrders'
import { customersApi } from '@/api/customers'
import { useProducts } from '@/hooks/useProducts'
import SearchInput from '@/components/SearchInput'
import LoadingSpinner from '@/components/LoadingSpinner'
import { DiscountTotals, LineDiscountField, OrderDiscountPanel } from '@/components/DiscountEditor'
import { computeDiscount, formatCurrency } from '@/lib/utils'
import { getUploadUrl } from '@/api/client'
import { Plus, Minus, Trash2, ShoppingCart, Save } from 'lucide-react'

interface OrderItem {
  product_id: number | null
  product_name: string
  product_code: string
  product_image: string | null
  quantity: number
  unit_price: number
  discount_type: string
  discount_value: number
  notes: string
}

export default function EditDraftOrder() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const orderId = parseInt(id || '0')
  const queryClient = useQueryClient()

  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [items, setItems] = useState<OrderItem[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [error, setError] = useState('')
  const [initialized, setInitialized] = useState(false)

  const [orderDiscountType, setOrderDiscountType] = useState('NONE')
  const [orderDiscountValue, setOrderDiscountValue] = useState(0)
  const [orderDiscountReason, setOrderDiscountReason] = useState('')

  const { data: discountPolicy } = useQuery({
    queryKey: ['discount-policy'],
    queryFn: () => salesOrdersApi.discountPolicy().then((res) => res.data),
  })

  const { data: orderData, isLoading: orderLoading } = useQuery({
    queryKey: ['sales-order', orderId],
    queryFn: () => salesOrdersApi.get(orderId).then((res) => res.data),
    enabled: !!orderId,
  })

  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => customersApi.listAll({ page_size: 100 }).then((res) => res.data),
  })

  const { data: productsData, isLoading: productsLoading } = useProducts({
    search: productSearch || undefined,
    page_size: 20,
  })

  const updateOrderMutation = useMutation({
    mutationFn: (data: any) => salesOrdersApi.fullUpdate(orderId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-order', orderId] })
      navigate(`/app/sales/orders/${orderId}`)
    },
  })

  useEffect(() => {
    if (orderData && !initialized) {
      setSelectedCustomerId(orderData.customer_id)
      setDeliveryAddress(orderData.delivery_address || '')
      setOrderNotes(orderData.notes || '')
      setOrderDiscountType(orderData.discount_type || 'NONE')
      setOrderDiscountValue(Number(orderData.discount_value || 0))
      setOrderDiscountReason(orderData.discount_reason || '')
      setItems(
        orderData.items.map((item: any) => ({
          product_id: item.product_id,
          product_name: item.product_name_snapshot || '',
          product_code: item.product_code_snapshot || '',
          product_image: null,
          quantity: item.quantity,
          unit_price: item.unit_price || 0,
          discount_type: item.discount_type || 'NONE',
          discount_value: Number(item.discount_value || 0),
          notes: item.notes || '',
        }))
      )
      setInitialized(true)
    }
  }, [orderData, initialized])

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
        discount_type: 'NONE',
        discount_value: 0,
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

  const setItemDiscount = (index: number, type: string, value: number) => {
    const updated = [...items]
    updated[index] = { ...updated[index], discount_type: type, discount_value: value }
    setItems(updated)
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  // Live totals, mirroring the server's pricing service.
  const totals = useMemo(() => {
    const grossSubtotal = items.reduce((sum, item) => sum + (item.quantity * item.unit_price || 0), 0)
    const lineDiscount = items.reduce(
      (sum, item) =>
        sum + computeDiscount(item.quantity * item.unit_price, item.discount_type, item.discount_value),
      0,
    )
    const orderDiscount = computeDiscount(grossSubtotal - lineDiscount, orderDiscountType, orderDiscountValue)
    return { grossSubtotal, lineDiscount, orderDiscount, net: grossSubtotal - lineDiscount - orderDiscount }
  }, [items, orderDiscountType, orderDiscountValue])

  const handleSave = async () => {
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
      await updateOrderMutation.mutateAsync({
        customer_id: selectedCustomerId,
        delivery_address: deliveryAddress,
        notes: orderNotes,
        discount_type: orderDiscountType,
        discount_value: orderDiscountValue,
        discount_reason: orderDiscountReason,
        items: items.map((item) => ({
          product_id: item.product_id,
          product_code_snapshot: item.product_code,
          product_name_snapshot: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_type: item.discount_type,
          discount_value: item.discount_value,
          notes: item.notes,
        })),
      })
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update order')
    }
  }

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId)

  if (orderLoading || !initialized) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (orderData && orderData.status !== 'DRAFT') {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Only draft orders can be edited
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShoppingCart className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Edit Draft Order</h1>
          <p className="text-sm text-muted-foreground">{orderData?.order_number}</p>
        </div>
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
              {customers.map((customer: any) => (
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
               <a href="/app/sales/customers/new" className="text-primary underline">
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
            <div className="col-span-4">Product</div>
            <div className="col-span-2 text-center">Qty</div>
            <div className="col-span-2 text-center">Unit Price</div>
            <div className="col-span-2 text-center">Discount</div>
            <div className="col-span-1 text-right">Subtotal</div>
            <div className="col-span-1"></div>
          </div>

          <div className="space-y-2">
            {items.map((item, index) => {
              const gross = item.quantity * item.unit_price
              const lineDiscount = computeDiscount(gross, item.discount_type, item.discount_value)
              return (
              <div
                key={`${item.product_id}-${index}`}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 items-center rounded-md border p-3"
              >
                <div className="col-span-4 flex items-center gap-3">
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
                  <div className="min-w-0">
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
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground sm:hidden">Discount</label>
                  <LineDiscountField
                    gross={gross}
                    type={item.discount_type}
                    value={item.discount_value}
                    onChange={(type, value) => setItemDiscount(index, type, value)}
                  />
                </div>
                <div className="col-span-1 text-right font-semibold text-sm">
                  {formatCurrency(gross - lineDiscount)}
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
              )
            })}
          </div>

          <DiscountTotals
            grossSubtotal={totals.grossSubtotal}
            lineDiscount={totals.lineDiscount}
            orderDiscount={totals.orderDiscount}
            tax={0}
            total={totals.net}
            itemCount={items.length}
          />
        </div>
      )}

      <OrderDiscountPanel
        grossSubtotal={totals.grossSubtotal - totals.lineDiscount}
        type={orderDiscountType}
        value={orderDiscountValue}
        reason={orderDiscountReason}
        approvalThresholdPercent={discountPolicy?.approval_threshold_percent ?? 10}
        onChange={(patch) => {
          if (patch.type !== undefined) setOrderDiscountType(patch.type)
          if (patch.value !== undefined) setOrderDiscountValue(patch.value)
          if (patch.reason !== undefined) setOrderDiscountReason(patch.reason)
        }}
      />

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
          onClick={handleSave}
          disabled={updateOrderMutation.isPending || items.length === 0 || !selectedCustomerId}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {updateOrderMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
