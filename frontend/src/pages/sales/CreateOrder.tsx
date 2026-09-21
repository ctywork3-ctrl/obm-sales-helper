import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCreateSalesOrder, useSubmitOrder } from '@/hooks/useSalesOrders'
import { useCustomers } from '@/hooks/useCustomers'
import { useProducts } from '@/hooks/useProducts'
import { useGeolocation } from '@/hooks/useGeolocation'
import { customersApi } from '@/api/customers'
import { masterDataApi } from '@/api/masterData'
import { salesOrdersApi } from '@/api/salesOrders'
import WorkflowHeader from '@/components/WorkflowHeader'
import SafeImage from '@/components/SafeImage'
import SearchInput from '@/components/SearchInput'
import LoadingSpinner from '@/components/LoadingSpinner'
import { DiscountTotals, LineDiscountField, OrderDiscountPanel } from '@/components/DiscountEditor'
import { computeDiscount, formatCurrency } from '@/lib/utils'
import { getUploadUrl } from '@/api/client'
import { getApiErrorMessage } from '@/lib/apiError'
import { Plus, Minus, Trash2, ShoppingCart } from 'lucide-react'

interface OrderItem {
  product_id: number
  product_name: string
  product_code: string
  product_image: string | null
  quantity: number
  unit_price: number
  discount_type: string
  discount_value: number
  notes: string
}

export default function CreateOrder() {
  const navigate = useNavigate()
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null)
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null)
  const [taxProfileId, setTaxProfileId] = useState<number | null>(null)
  const [showContactForm, setShowContactForm] = useState(false)
  const [showAddressForm, setShowAddressForm] = useState(false)
  const [showMoreDetails, setShowMoreDetails] = useState(false)
  const [contactDraft, setContactDraft] = useState({ name: '', job_title: '', mobile: '', email: '' })
  const [addressDraft, setAddressDraft] = useState({ label: '', address_line1: '', city: '', state: '', postcode: '', contact_name: '', contact_phone: '' })
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [items, setItems] = useState<OrderItem[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [error, setError] = useState('')

  // Order-level discount
  const [orderDiscountType, setOrderDiscountType] = useState('NONE')
  const [orderDiscountValue, setOrderDiscountValue] = useState(0)
  const [orderDiscountReason, setOrderDiscountReason] = useState('')

  const { data: customersData, isLoading: customersLoading } = useCustomers({ page_size: 100 })
  const { data: productsData, isLoading: productsLoading } = useProducts({
    search: productSearch || undefined,
    page_size: 20,
  })
  const createOrder = useCreateSalesOrder()
  const submitOrder = useSubmitOrder()
  const { sendLocation } = useGeolocation()
  const queryClient = useQueryClient()

  const { data: discountPolicy } = useQuery({
    queryKey: ['discount-policy'],
    queryFn: () => salesOrdersApi.discountPolicy().then((res) => res.data),
  })

  const createContact = useMutation({
    mutationFn: () => customersApi.createContact(selectedCustomerId!, { ...contactDraft, is_primary: contacts.length === 0 }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['customer-contacts', selectedCustomerId] })
      setSelectedContactId(response.data.id)
      setContactDraft({ name: '', job_title: '', mobile: '', email: '' })
      setShowContactForm(false)
    },
    onError: (err: any) => setError(getApiErrorMessage(err, 'Failed to create contact')),
  })

  const createAddress = useMutation({
    mutationFn: () => customersApi.createAddress(selectedCustomerId!, { ...addressDraft, is_default: addresses.length === 0, address_type: 'DELIVERY', country: 'MY' }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['customer-addresses', selectedCustomerId] })
      setSelectedAddressId(response.data.id)
      setAddressDraft({ label: '', address_line1: '', city: '', state: '', postcode: '', contact_name: '', contact_phone: '' })
      setShowAddressForm(false)
    },
    onError: (err: any) => setError(getApiErrorMessage(err, 'Failed to create delivery address')),
  })

  const archiveContact = useMutation({
    mutationFn: (contactId: number) => customersApi.archiveContact(selectedCustomerId!, contactId),
    onSuccess: (_data, contactId) => {
      queryClient.invalidateQueries({ queryKey: ['customer-contacts', selectedCustomerId] })
      if (selectedContactId === contactId) setSelectedContactId(null)
    },
    onError: (err: any) => setError(getApiErrorMessage(err, 'Failed to remove contact')),
  })

  const archiveAddress = useMutation({
    mutationFn: (addressId: number) => customersApi.archiveAddress(selectedCustomerId!, addressId),
    onSuccess: (_data, addressId) => {
      queryClient.invalidateQueries({ queryKey: ['customer-addresses', selectedCustomerId] })
      if (selectedAddressId === addressId) setSelectedAddressId(null)
    },
    onError: (err: any) => setError(getApiErrorMessage(err, 'Failed to remove delivery address')),
  })

  const customers = customersData?.items || []
  const { data: taxProfiles = [] } = useQuery({
    queryKey: ['tax-profiles'],
    queryFn: () => masterDataApi.taxProfiles().then((res) => res.data),
  })

  const { data: contacts = [] } = useQuery({
    queryKey: ['customer-contacts', selectedCustomerId],
    queryFn: () => customersApi.listContacts(selectedCustomerId!).then((res) => res.data),
    enabled: Boolean(selectedCustomerId),
  })
  const { data: addresses = [] } = useQuery({
    queryKey: ['customer-addresses', selectedCustomerId],
    queryFn: () => customersApi.listAddresses(selectedCustomerId!).then((res) => res.data),
    enabled: Boolean(selectedCustomerId),
  })

  useEffect(() => {
    const primaryContact = contacts.find((contact) => contact.is_primary) || contacts[0]
    const defaultAddress = addresses.find((address) => address.is_default) || addresses[0]
    setSelectedContactId(primaryContact?.id || null)
    setSelectedAddressId(defaultAddress?.id || null)
  }, [contacts, addresses])

  const selectedTaxProfile = taxProfiles.find((profile) => profile.id === taxProfileId)
  const orderCurrency = selectedTaxProfile?.currency || 'MYR'

  const priceForProduct = (product: any, currency: string): number => {
    if (currency !== 'MYR' && Array.isArray(product.prices)) {
      const match = product.prices.find(
        (p: any) => p.currency === currency && p.is_active !== false,
      )
      if (match) return Number(match.unit_price)
    }
    return product.selling_price
  }

  // --- live totals (mirrors the server's pricing service) ---
  const totals = useMemo(() => {
    const grossSubtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
    const lineDiscount = items.reduce(
      (sum, item) => sum + computeDiscount(item.quantity * item.unit_price, item.discount_type, item.discount_value),
      0,
    )
    const orderDiscount = computeDiscount(grossSubtotal - lineDiscount, orderDiscountType, orderDiscountValue)
    const taxableBase = grossSubtotal - lineDiscount - orderDiscount
    const taxRate = selectedTaxProfile ? Number(selectedTaxProfile.rate) / 100 : 0
    const tax = taxableBase * taxRate
    return { grossSubtotal, lineDiscount, orderDiscount, tax, total: taxableBase + tax }
  }, [items, orderDiscountType, orderDiscountValue, selectedTaxProfile])

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
        unit_price: priceForProduct(product, orderCurrency),
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

  const repriceItems = (currency: string) => {
    setItems((prev) =>
      prev.map((item) => {
        const product = (productsData?.items || []).find((p: any) => p.id === item.product_id)
        if (!product) return item
        return { ...item, unit_price: priceForProduct(product, currency) }
      }),
    )
  }

  const handleTaxProfileChange = (value: string) => {
    const nextId = Number(value) || null
    const nextProfile = taxProfiles.find((profile) => profile.id === nextId)
    const nextCurrency = nextProfile?.currency || 'MYR'
    if (nextCurrency !== orderCurrency) {
      repriceItems(nextCurrency)
    }
    setTaxProfileId(nextId)
  }

  const handleSubmit = async (submitAfterCreate: boolean) => {
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
        delivery_address_id: selectedAddressId || undefined,
        contact_id: selectedContactId || undefined,
        tax_profile_id: taxProfileId || undefined,
        currency: orderCurrency,
        delivery_address: deliveryAddress,
        notes: orderNotes,
        discount_type: orderDiscountType,
        discount_value: orderDiscountValue,
        discount_reason: orderDiscountReason || undefined,
        items: items.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_type: item.discount_type,
          discount_value: item.discount_value,
          notes: item.notes,
        })),
      })
      if (submitAfterCreate) {
        try {
          await submitOrder.mutateAsync({ id: order.id, data: { delivery_address: deliveryAddress } })
        } catch (submitErr: any) {
          setError(getApiErrorMessage(submitErr, `Order ${order.order_number} saved as draft but could not be submitted`))
          navigate(`/app/sales/orders/${order.id}`)
          return
        }
      }
      navigate(`/app/sales/orders/${order.id}`)
      sendLocation('ORDER_CREATE', { orderId: order.id })
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to create order'))
    }
  }

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId)

  return (
    <div className="space-y-6">
      <WorkflowHeader
        title="Create Sales Order"
        subtitle="Build a draft, confirm delivery details, then submit it for review."
        icon={<ShoppingCart className="h-5 w-5" />}
        backLabel="Back to orders"
        onBack={() => navigate(-1)}
      />

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
              onChange={(e) => {
                const nextCustomerId = Number(e.target.value) || null
                setSelectedCustomerId(nextCustomerId)
                setSelectedContactId(null)
                setSelectedAddressId(null)
                setDeliveryAddress('')
                setShowContactForm(false)
                setShowAddressForm(false)
                if (nextCustomerId) {
                  sendLocation('CUSTOMER_CHECK_IN', { customerId: nextCustomerId })
                }
              }}
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
            {selectedCustomerId && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowMoreDetails(!showMoreDetails)}
                  className="text-xs font-medium text-primary underline"
                >
                  {showMoreDetails ? 'Hide customer details' : 'More customer details (optional)'}
                </button>
                <p className="mt-1 text-xs text-muted-foreground">
                  The customer's own phone and address are used by default. Only add a contact or delivery address if this order needs them.
                </p>
              </div>
            )}
            {selectedCustomerId && showMoreDetails && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium">Contact</label>
                    {selectedContactId && (
                      <button
                        type="button"
                        disabled={archiveContact.isPending}
                        onClick={() => {
                          if (window.confirm('Remove this contact? It will no longer appear on new orders. Past orders keep their saved copy.')) {
                            archiveContact.mutate(selectedContactId)
                          }
                        }}
                        className="text-xs text-destructive underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <select
                    value={selectedContactId || ''}
                    onChange={(e) => setSelectedContactId(Number(e.target.value) || null)}
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">No contact selected</option>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name}{contact.job_title ? ` - ${contact.job_title}` : ''}
                      </option>
                    ))}
                  </select>
                  {contacts.length === 0 && <p className="mt-1 text-xs text-muted-foreground">No saved contacts yet.</p>}
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium">Delivery address</label>
                    {selectedAddressId && (
                      <button
                        type="button"
                        disabled={archiveAddress.isPending}
                        onClick={() => {
                          if (window.confirm('Remove this delivery address? It will no longer appear on new orders. Past orders keep their saved copy.')) {
                            archiveAddress.mutate(selectedAddressId)
                          }
                        }}
                        className="text-xs text-destructive underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <select
                    value={selectedAddressId || ''}
                    onChange={(e) => setSelectedAddressId(Number(e.target.value) || null)}
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Use custom address below</option>
                    {addresses.map((address) => (
                      <option key={address.id} value={address.id}>
                        {address.label}{address.is_default ? ' (Default)' : ''}
                      </option>
                    ))}
                  </select>
                  {addresses.length === 0 && <p className="mt-1 text-xs text-muted-foreground">No saved delivery addresses yet.</p>}
                </div>
              </div>
            )}
            {selectedCustomerId && showMoreDetails && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => { setShowContactForm(!showContactForm); setShowAddressForm(false) }} className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-gray-50">+ Add contact</button>
                <button type="button" onClick={() => { setShowAddressForm(!showAddressForm); setShowContactForm(false) }} className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-gray-50">+ Add delivery address</button>
              </div>
            )}
            {showMoreDetails && showContactForm && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                <p className="mb-2 text-sm font-semibold">New customer contact</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="rounded-md border px-3 py-2 text-sm" placeholder="Name *" value={contactDraft.name} onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })} />
                  <input className="rounded-md border px-3 py-2 text-sm" placeholder="Job title" value={contactDraft.job_title} onChange={(e) => setContactDraft({ ...contactDraft, job_title: e.target.value })} />
                  <input className="rounded-md border px-3 py-2 text-sm" placeholder="Mobile" value={contactDraft.mobile} onChange={(e) => setContactDraft({ ...contactDraft, mobile: e.target.value })} />
                  <input className="rounded-md border px-3 py-2 text-sm" placeholder="Email" value={contactDraft.email} onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })} />
                </div>
                <button type="button" disabled={!contactDraft.name.trim() || createContact.isPending} onClick={() => createContact.mutate()} className="mt-3 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">{createContact.isPending ? 'Saving...' : 'Save contact'}</button>
              </div>
            )}
            {showMoreDetails && showAddressForm && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                <p className="mb-2 text-sm font-semibold">New delivery address</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="rounded-md border px-3 py-2 text-sm" placeholder="Label * (e.g. Main warehouse)" value={addressDraft.label} onChange={(e) => setAddressDraft({ ...addressDraft, label: e.target.value })} />
                  <input className="rounded-md border px-3 py-2 text-sm" placeholder="Address line 1 *" value={addressDraft.address_line1} onChange={(e) => setAddressDraft({ ...addressDraft, address_line1: e.target.value })} />
                  <input className="rounded-md border px-3 py-2 text-sm" placeholder="City" value={addressDraft.city} onChange={(e) => setAddressDraft({ ...addressDraft, city: e.target.value })} />
                  <input className="rounded-md border px-3 py-2 text-sm" placeholder="State" value={addressDraft.state} onChange={(e) => setAddressDraft({ ...addressDraft, state: e.target.value })} />
                  <input className="rounded-md border px-3 py-2 text-sm" placeholder="Postcode" value={addressDraft.postcode} onChange={(e) => setAddressDraft({ ...addressDraft, postcode: e.target.value })} />
                  <input className="rounded-md border px-3 py-2 text-sm" placeholder="Delivery contact phone" value={addressDraft.contact_phone} onChange={(e) => setAddressDraft({ ...addressDraft, contact_phone: e.target.value })} />
                </div>
                <button type="button" disabled={!addressDraft.label.trim() || !addressDraft.address_line1.trim() || createAddress.isPending} onClick={() => createAddress.mutate()} className="mt-3 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">{createAddress.isPending ? 'Saving...' : 'Save address'}</button>
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
                  <SafeImage
                    src={product.images?.[0] ? getUploadUrl(product.images[0].file_path) : null}
                    alt={product.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{product.name}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {product.obm_item_code || product.item_code} | Stock: {product.stock_qty}
                  </p>
                </div>
                <span className="font-semibold flex-shrink-0">{formatCurrency(priceForProduct(product, orderCurrency), orderCurrency)}</span>
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
                  key={item.product_id}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 items-center rounded-md border p-3"
                >
                  <div className="col-span-1 flex items-center gap-3 sm:col-span-4">
                    <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded bg-gray-100">
                      <SafeImage
                        src={item.product_image ? getUploadUrl(item.product_image) : null}
                        alt={item.product_name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{item.product_name}</p>
                      <p className="text-xs text-muted-foreground">{item.product_code}</p>
                    </div>
                  </div>
                  <div className="col-span-1 sm:col-span-2">
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
                  <div className="col-span-1 sm:col-span-2">
                    <label className="text-xs text-muted-foreground sm:hidden">Unit Price ({orderCurrency})</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => updateItem(index, 'unit_price', Number(e.target.value))}
                      className="h-9 w-full rounded-md border px-2 text-sm text-center"
                    />
                  </div>
                  <div className="col-span-1 sm:col-span-2">
                    <label className="text-xs text-muted-foreground sm:hidden">Discount</label>
                    <LineDiscountField
                      gross={gross}
                      type={item.discount_type}
                      value={item.discount_value}
                      currency={orderCurrency}
                      onChange={(type, value) => setItemDiscount(index, type, value)}
                    />
                  </div>
                  <div className="col-span-1 flex items-center justify-between text-sm font-semibold sm:col-span-1 sm:block sm:text-right">
                    <span className="text-xs font-normal text-muted-foreground sm:hidden">Subtotal</span>
                    {formatCurrency(gross - lineDiscount, orderCurrency)}
                  </div>
                  <div className="col-span-1 justify-self-end text-right sm:col-span-1">
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
            tax={totals.tax}
            total={totals.total}
            currency={orderCurrency}
            itemCount={items.length}
            taxRateLabel={selectedTaxProfile ? `${selectedTaxProfile.rate}%` : undefined}
          />
        </div>
      )}

      <OrderDiscountPanel
        grossSubtotal={totals.grossSubtotal - totals.lineDiscount}
        type={orderDiscountType}
        value={orderDiscountValue}
        reason={orderDiscountReason}
        currency={orderCurrency}
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
            <label className="block text-sm font-medium">Currency & tax profile</label>
            <select
              value={taxProfileId || ''}
              onChange={(e) => handleTaxProfileChange(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">No tax profile selected</option>
              {taxProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.currency} · {profile.name} ({profile.rate}%)
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              The server recalculates and snapshots tax when the order is created.
              {orderCurrency !== 'MYR' && ' Prices switch to the currency-specific price list when available.'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium">Delivery Address / Special Delivery Point</label>
            <textarea
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              rows={2}
              placeholder={selectedAddressId ? 'Optional delivery instructions...' : 'Enter delivery address...'}
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

      <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-end sm:bg-transparent sm:border-0 sm:p-0">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md border px-4 py-2.5 text-sm font-medium hover:bg-accent"
        >
          Back
        </button>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => handleSubmit(false)}
            disabled={createOrder.isPending || submitOrder.isPending || items.length === 0 || !selectedCustomerId}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-primary px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
          >
            Save as Draft
          </button>
          <button
            onClick={() => handleSubmit(true)}
            disabled={createOrder.isPending || submitOrder.isPending || items.length === 0 || !selectedCustomerId}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <ShoppingCart className="h-4 w-4" />
            {createOrder.isPending
              ? 'Creating...'
              : submitOrder.isPending
                ? 'Submitting...'
                : 'Submit Order'}
          </button>
        </div>
      </div>
    </div>
  )
}
