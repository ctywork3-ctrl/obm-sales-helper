import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '@/contexts/StoreContext'
import { formatCurrency } from '@/lib/utils'
import { getUploadUrl } from '@/api/client'
import { Trash2, Minus, Plus, ShoppingBag, ArrowLeft } from 'lucide-react'

export default function CartPage() {
  const { cart, customer, removeFromCart, updateCartItem } = useStore()
  const navigate = useNavigate()

  if (!cart || cart.items.length === 0) {
    return (
      <div className="py-16 text-center">
        <ShoppingBag className="mx-auto h-16 w-16 text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Your cart is empty</h2>
        <p className="text-gray-500 mb-6">Add some products to get started!</p>
        <Link
          to="/shop"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <ShoppingBag className="h-4 w-4" />
          Start Shopping
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Shopping Cart ({cart.item_count} items)</h1>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Continue Shopping
        </button>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Cart items */}
        <div className="lg:col-span-2 space-y-4">
          {cart.items.map((item) => (
            <div key={item.id} className="flex gap-4 rounded-xl border bg-white p-4 shadow-sm">
              <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                {item.product_image ? (
                  <img
                    src={getUploadUrl(item.product_image)}
                    alt={item.product_name || ''}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-400">
                    No img
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{item.product_name}</p>
                <p className="text-sm text-gray-500">{formatCurrency(item.unit_price)} each</p>

                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateCartItem(item.id, item.product_id, Math.max(1, item.quantity - 1))}
                      className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-gray-50"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                    <button
                      onClick={() => updateCartItem(item.id, item.product_id, item.quantity + 1)}
                      className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-gray-50"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-semibold">{formatCurrency(item.line_total)}</span>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 rounded-xl border bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span>{formatCurrency(cart.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Shipping</span>
                <span>Calculated at checkout</span>
              </div>
            </div>
            <div className="border-t pt-4">
              <div className="flex justify-between font-semibold">
                <span>Estimated Total</span>
                <span className="text-blue-600">{formatCurrency(cart.total)}</span>
              </div>
            </div>
            <button
              onClick={() => navigate(customer ? '/checkout' : '/login?redirect=checkout')}
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {customer ? 'Proceed to Checkout' : 'Login to Checkout'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
