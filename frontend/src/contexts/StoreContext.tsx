import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { storeAuthApi, storeCartApi, CustomerAccount, CartData } from '@/api/store'

interface StoreContextType {
  customer: CustomerAccount | null
  cart: CartData | null
  cartCount: number
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: { email: string; password: string; full_name: string; phone?: string }) => Promise<void>
  logout: () => Promise<void>
  refreshCart: () => Promise<void>
  addToCart: (productId: number, quantity?: number) => Promise<void>
  removeFromCart: (itemId: number) => Promise<void>
  updateCartItem: (itemId: number, productId: number, quantity: number) => Promise<void>
  clearCart: () => Promise<void>
}

const StoreContext = createContext<StoreContextType | undefined>(undefined)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<CustomerAccount | null>(null)
  const [cart, setCart] = useState<CartData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshCart = useCallback(async () => {
    try {
      const res = await storeCartApi.get()
      setCart(res.data)
    } catch {
      setCart(null)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        const res = await storeAuthApi.me()
        setCustomer(res.data)
        await refreshCart()
      } catch {
        setCustomer(null)
      } finally {
        setIsLoading(false)
      }
    }
    init()
  }, [refreshCart])

  const login = async (email: string, password: string) => {
    const res = await storeAuthApi.login({ email, password })
    setCustomer(res.data)
    await refreshCart()
  }

  const register = async (data: { email: string; password: string; full_name: string; phone?: string }) => {
    const res = await storeAuthApi.register(data)
    setCustomer(res.data)
    await refreshCart()
  }

  const logout = async () => {
    await storeAuthApi.logout()
    setCustomer(null)
    setCart(null)
  }

  const addToCart = async (productId: number, quantity = 1) => {
    const res = await storeCartApi.addItem({ product_id: productId, quantity })
    setCart(res.data)
  }

  const removeFromCart = async (itemId: number) => {
    const res = await storeCartApi.removeItem(itemId)
    setCart(res.data)
  }

  const updateCartItem = async (itemId: number, productId: number, quantity: number) => {
    const res = await storeCartApi.updateItem(itemId, { product_id: productId, quantity })
    setCart(res.data)
  }

  const clearCart = async () => {
    const res = await storeCartApi.clear()
    setCart(res.data)
  }

  return (
    <StoreContext.Provider
      value={{
        customer,
        cart,
        cartCount: cart?.item_count || 0,
        isLoading,
        login,
        register,
        logout,
        refreshCart,
        addToCart,
        removeFromCart,
        updateCartItem,
        clearCart,
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  const context = useContext(StoreContext)
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider')
  }
  return context
}
