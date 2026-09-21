import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useStore } from '@/contexts/StoreContext'
import { storeCheckoutApi, storeAuthApi, CustomerAddress } from '@/api/store'
import { formatCurrency } from '@/lib/utils'
import { getUploadUrl } from '@/api/client'
import LoadingSpinner from '@/components/LoadingSpinner'
import { CreditCard, Truck, MapPin, Plus, ArrowLeft } from 'lucide-react'

interface ShippingMethod {
  id: string
  name: string
  cost: number
  days: string
}

export default function CheckoutPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { customer, cart } = useStore()
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null)
  const [shippingMethod, setShippingMethod] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [showNewAddress, setShowNewAddress] = useState(false)
  const [newAddress, setNewAddress] = useState({
    label: 'Home',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    postcode: '',
    phone: '',
  })

  const { data: shippingMethods, isLoading: shippingLoading } = useQuery({
    queryKey: ['shipping-methods'],
    queryFn: () => storeCheckoutApi.getShippingMethods().then((res) => res.data.methods),
  })

  const { data: addresses, isLoading: addressesLoading } = useQuery({
    queryKey: ['store-addresses'],
    queryFn: () => storeAuthApi.listAddresses().then((res) => res.data),
    enabled: !!customer,
  })

  useEffect(() => {
    if (!shippingMethod && shippingMethods && shippingMethods.length > 0) {
      setShippingMethod(shippingMethods[0].id)
    }
  }, [shippingMethods, shippingMethod])

  useEffect(() => {
    if (!cart || cart.items.length === 0) {
      navigate('/cart')
    }
  }, [cart, navigate])

  const createOrderMutation = useMutation({
    mutationFn: storeCheckoutApi.createOrder,
    onSuccess: async (res) => {
      const orderId = res.data.id
      try {
        const payRes = await storeCheckoutApi.initiatePayment(orderId)
        if (payRes.data.hitpay_payment_id) {
          const urlRes = await storeCheckoutApi.getPaymentUrl(orderId)
          window.location.href = urlRes.data.checkout_url
        } else {
          navigate(`/order-confirmation/${orderId}`)
        }
      } catch {
        navigate(`/order-confirmation/${orderId}`)
      }
    },
  })

  if (!cart || cart.items.length === 0) {
    return null
  }

  const selectedShipping = shippingMethods?.find((m) => m.id === shippingMethod)
  const shippingCost = selectedShipping?.cost || 0
  const total = cart.total + shippingCost

  const handlePlaceOrder = async () => {
    let addressId = selectedAddressId

    if (showNewAddress) {
      try {
        const res = await storeAuthApi.createAddress({
          ...newAddress,
          country: 'MY',
          is_default: addresses?.length === 0,
        } as any)
        addressId = res.data.id
      } catch {
        return
      }
    }

    const orderData: any = {
      shipping_method: shippingMethod,
      notes,
    }

    if (showNewAddress && !addressId) {
      orderData.shipping_address = newAddress
    } else if (addressId) {
      orderData.shipping_address_id = addressId
    }

    createOrderMutation.mutate(orderData)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Checkout</h1>
        <button
          onClick={() => navigate('/cart')}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Cart
        </button>
      </div>

      {createOrderMutation.isError && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {(createOrderMutation.error as any)?.response?.data?.detail || 'Failed to create order'}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Shipping Address */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
              <MapPin className="h-5 w-5" />
              Shipping Address
            </h2>
            {addressesLoading ? (
              <LoadingSpinner />
            ) : (
              <div className="space-y-3">
                {addresses?.filter((a: CustomerAddress) => a.address_line1).map((addr) => (
                  <label
                    key={addr.id}
                    className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer ${
                      selectedAddressId === addr.id ? 'border-blue-600 bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="address"
                      checked={selectedAddressId === addr.id}
                      onChange={() => { setSelectedAddressId(addr.id); setShowNewAddress(false) }}
                      className="mt-1"
                    />
                    <div>
                      <p className="font-medium">{addr.label}</p>
                      <p className="text-sm text-gray-600">{addr.address_line1}</p>
                      {addr.address_line2 && <p className="text-sm text-gray-600">{addr.address_line2}</p>}
                      <p className="text-sm text-gray-600">{addr.city}, {addr.state} {addr.postcode}</p>
                    </div>
                  </label>
                ))}
                <label
                  className={`flex items-center gap-3 rounded-lg border p-4 cursor-pointer ${
                    showNewAddress ? 'border-blue-600 bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="address"
                    checked={showNewAddress}
                    onChange={() => { setShowNewAddress(true); setSelectedAddressId(null) }}
                    className="mt-1"
                  />
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Plus className="h-4 w-4" />
                    Use a new address
                  </span>
                </label>

                {showNewAddress && (
                  <div className="mt-4 space-y-3 rounded-lg border p-4 bg-gray-50">
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder="Address Label (Home/Office)"
                        value={newAddress.label}
                        onChange={(e) => setNewAddress({ ...newAddress, label: e.target.value })}
                        className="rounded-lg border px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Phone"
                        value={newAddress.phone}
                        onChange={(e) => setNewAddress({ ...newAddress, phone: e.target.value })}
                        className="rounded-lg border px-3 py-2 text-sm"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Address Line 1 *"
                      value={newAddress.address_line1}
                      onChange={(e) => setNewAddress({ ...newAddress, address_line1: e.target.value })}
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Address Line 2 (optional)"
                      value={newAddress.address_line2}
                      onChange={(e) => setNewAddress({ ...newAddress, address_line2: e.target.value })}
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    />
                    <div className="grid grid-cols-3 gap-3">
                      <input
                        type="text"
                        placeholder="City *"
                        value={newAddress.city}
                        onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })}
                        className="rounded-lg border px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        placeholder="State *"
                        value={newAddress.state}
                        onChange={(e) => setNewAddress({ ...newAddress, state: e.target.value })}
                        className="rounded-lg border px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Postcode *"
                        value={newAddress.postcode}
                        onChange={(e) => setNewAddress({ ...newAddress, postcode: e.target.value })}
                        className="rounded-lg border px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Shipping Method */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
              <Truck className="h-5 w-5" />
              Shipping Method
            </h2>
            {shippingLoading ? (
              <LoadingSpinner />
            ) : (
              <div className="space-y-3">
                {shippingMethods?.map((method) => (
                  <label
                    key={method.id}
                    className={`flex items-center justify-between rounded-lg border p-4 cursor-pointer ${
                      shippingMethod === method.id ? 'border-blue-600 bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="shipping"
                        checked={shippingMethod === method.id}
                        onChange={() => setShippingMethod(method.id)}
                      />
                      <div>
                        <p className="font-medium">{method.name}</p>
                        <p className="text-sm text-gray-500">{method.days}</p>
                      </div>
                    </div>
                    <span className="font-medium">
                      {method.cost === 0 ? 'Free' : formatCurrency(method.cost)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Order Notes</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Special instructions for your order..."
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Order Summary */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 rounded-xl border bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold">Order Summary</h2>

            <div className="max-h-60 space-y-3 overflow-y-auto">
              {cart.items.map((item) => (
                <div key={item.id} className="flex gap-3">
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {item.product_image ? (
                      <img src={getUploadUrl(item.product_image)} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.product_name}</p>
                    <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                  </div>
                  <span className="text-sm font-medium">{formatCurrency(item.line_total)}</span>
                </div>
              ))}
            </div>

            <div className="border-t pt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span>{formatCurrency(cart.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Shipping ({selectedShipping?.name || '...'})</span>
                <span>{shippingCost === 0 ? 'Free' : formatCurrency(shippingCost)}</span>
              </div>
            </div>
            <div className="border-t pt-4">
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-blue-600">{formatCurrency(total)}</span>
              </div>
            </div>

            <button
              onClick={handlePlaceOrder}
              disabled={createOrderMutation.isPending || !shippingMethod}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4" />
              {createOrderMutation.isPending ? 'Processing...' : 'Place Order & Pay'}
            </button>

            <p className="text-center text-xs text-gray-500">
              Secure payment via HitPay
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
