import client from './client'

export interface CustomerAccount {
  id: number
  email: string
  phone?: string
  full_name: string
  is_active: boolean
  email_verified: boolean
  created_at?: string
}

export interface CustomerAddress {
  id: number
  label: string
  address_line1: string
  address_line2?: string
  city: string
  state: string
  postcode: string
  country: string
  phone?: string
  is_default: boolean
}

export interface StoreProduct {
  id: number
  name: string
  item_code?: string
  obm_item_code?: string
  category?: string
  brand?: string
  description?: string
  uom?: string
  selling_price: number
  stock_qty: number
  image_url?: string
  images?: { id: number; file_path: string; is_primary: boolean }[]
  barcode?: string
}

export interface CartItem {
  id: number
  product_id: number
  quantity: number
  product_name?: string
  product_image?: string
  unit_price: number
  line_total: number
}

export interface CartData {
  id: number
  items: CartItem[]
  total: number
  item_count: number
}

export interface StoreOrder {
  id: number
  order_number: string
  status: string
  subtotal: number
  shipping_cost: number
  discount_amount: number
  total_amount: number
  currency: string
  shipping_method?: string
  notes?: string
  created_at?: string
  paid_at?: string
  shipped_at?: string
  items: {
    id: number
    product_id?: number
    product_name_snapshot?: string
    product_image_snapshot?: string
    quantity: number
    unit_price: number
    line_total: number
  }[]
}

export interface Category {
  id: number
  name: string
  slug: string
  description?: string
  parent_id?: number
  sort_order: number
  is_active: boolean
}

export const storeAuthApi = {
  register: (data: { email: string; password: string; full_name: string; phone?: string }) =>
    client.post<CustomerAccount>('/store/auth/register', data),

  login: (data: { email: string; password: string }) =>
    client.post<CustomerAccount>('/store/auth/login', data),

  logout: () => client.post('/store/auth/logout'),

  me: () => client.get<CustomerAccount>('/store/auth/me'),

  updateProfile: (data: { full_name?: string; phone?: string }) =>
    client.patch<CustomerAccount>('/store/auth/me', data),

  listAddresses: () => client.get<CustomerAddress[]>('/store/auth/addresses'),

  createAddress: (data: Omit<CustomerAddress, 'id'>) =>
    client.post<CustomerAddress>('/store/auth/addresses', data),

  deleteAddress: (id: number) => client.delete(`/store/auth/addresses/${id}`),
}

export const storeProductsApi = {
  list: (params?: {
    page?: number
    page_size?: number
    search?: string
    category?: string
    min_price?: number
    max_price?: number
    sort?: string
  }) => client.get<{ items: StoreProduct[]; total: number; page: number; page_size: number; pages: number }>(
    '/store/products', { params }
  ),

  get: (id: number) => client.get<StoreProduct>(`/store/products/${id}`),

  featured: (limit?: number) =>
    client.get<StoreProduct[]>('/store/products/featured', { params: { limit } }),

  categories: () => client.get<Category[]>('/store/products/categories'),
}

export const storeCartApi = {
  get: () => client.get<CartData>('/store/cart'),

  addItem: (data: { product_id: number; quantity: number }) =>
    client.post<CartData>('/store/cart/items', data),

  updateItem: (itemId: number, data: { product_id: number; quantity: number }) =>
    client.put<CartData>(`/store/cart/items/${itemId}`, data),

  removeItem: (itemId: number) =>
    client.delete<CartData>(`/store/cart/items/${itemId}`),

  clear: () => client.delete<CartData>('/store/cart'),
}

export const storeCheckoutApi = {
  createOrder: (data: {
    shipping_address_id?: number
    shipping_address?: any
    shipping_method?: string
    notes?: string
    promo_code?: string
  }) => client.post<StoreOrder>('/store/checkout', data),

  initiatePayment: (orderId: number) =>
    client.post<{ id: number; status: string; hitpay_payment_id?: string }>(
      `/store/checkout/${orderId}/pay`
    ),

  getPaymentUrl: (orderId: number) =>
    client.get<{ checkout_url: string }>(`/store/checkout/${orderId}/payment-url`),

  getOrder: (orderId: number) =>
    client.get<StoreOrder>(`/store/checkout/${orderId}`),

  listOrders: (params?: { page?: number; page_size?: number }) =>
    client.get<{ items: StoreOrder[]; total: number; page: number; page_size: number; pages: number }>(
      '/store/checkout/orders', { params }
    ),

  getShippingMethods: () =>
    client.get<{ methods: { id: string; name: string; cost: number; days: string }[] }>(
      '/store/checkout/shipping-methods'
    ),
}
