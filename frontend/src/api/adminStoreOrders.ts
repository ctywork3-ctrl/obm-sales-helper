import client from './client'

export interface StoreOrderListItem {
  id: number
  order_number: string
  status: string
  subtotal: number
  shipping_cost: number
  discount_amount: number
  total_amount: number
  currency: string
  shipping_method: string
  delivery_address_json: string | null
  delivery_address?: {
    label?: string
    address_line1?: string
    address_line2?: string
    city?: string
    state?: string
    postcode?: string
    country?: string
    phone?: string
  } | null
  notes: string | null
  created_at: string | null
  paid_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  customer: {
    id: number
    email: string
    full_name: string
    phone: string | null
  } | null
  items: {
    id: number
    product_id: number | null
    product_name_snapshot: string | null
    product_image_snapshot: string | null
    quantity: number
    unit_price: number
    line_total: number
  }[]
  payment: {
    status: string | null
    payment_method: string | null
    hitpay_payment_id: string | null
  } | null
}

export interface StoreOrderStats {
  total: number
  paid: number
  processing: number
  shipped: number
  revenue: number
}

export const adminStoreOrdersApi = {
  list: (params?: {
    page?: number
    page_size?: number
    status?: string
    search?: string
  }) =>
    client.get<{ items: StoreOrderListItem[]; total: number; page: number; page_size: number; pages: number }>(
      '/admin/store-orders', { params }
    ),

  get: (id: number) =>
    client.get<StoreOrderListItem>(`/admin/store-orders/${id}`),

  updateStatus: (id: number, status: string, cancelReason?: string) =>
    client.patch<{ message: string; status: string }>(`/admin/store-orders/${id}`, {
      status,
      cancel_reason: cancelReason,
    }),

  getStats: () =>
    client.get<StoreOrderStats>('/admin/store-orders/stats/summary'),
}
