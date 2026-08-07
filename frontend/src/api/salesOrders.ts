import client from './client'
import type { SalesOrder, PaginatedResponse } from '@/types'

export interface SalesOrderListParams {
  page?: number
  page_size?: number
  search?: string
  status?: string
  customer_id?: number
  salesman_id?: number
  date_from?: string
  date_to?: string
}

export interface OrderItemInput {
  product_id: number
  quantity: number
  unit_price?: number
  discount_amount?: number
  notes?: string
}

export interface CreateSalesOrderRequest {
  customer_id: number
  delivery_address?: string
  notes?: string
  items: OrderItemInput[]
}

export interface SubmitOrderRequest {
  delivery_address?: string
}

export interface ReviewOrderRequest {
  action: 'approve' | 'reject'
  rejected_reason?: string
}

export interface KeyedToObmRequest {
  obm_reference_number: string
}

export const salesOrdersApi = {
  list: (params?: SalesOrderListParams) =>
    client.get<PaginatedResponse<SalesOrder>>('/sales-orders', { params }),

  get: (id: number) =>
    client.get<SalesOrder>(`/sales-orders/${id}`),

  create: (data: CreateSalesOrderRequest) =>
    client.post<SalesOrder>('/sales-orders', data),

  update: (id: number, data: Partial<CreateSalesOrderRequest>) =>
    client.patch<SalesOrder>(`/sales-orders/${id}`, data),

  delete: (id: number) =>
    client.delete(`/sales-orders/${id}`),

  submit: (id: number, data?: SubmitOrderRequest) =>
    client.post<SalesOrder>(`/sales-orders/${id}/submit`, data),

  review: (id: number, data: ReviewOrderRequest) =>
    data.action === 'reject'
      ? client.post<SalesOrder>(`/sales-orders/${id}/reject`, { reason: data.rejected_reason })
      : client.post<SalesOrder>(`/sales-orders/${id}/approve`),

  markKeyedToObm: (id: number, data: KeyedToObmRequest) =>
    client.post<SalesOrder>(`/sales-orders/${id}/mark-keyed-to-obm`, data),

  cancel: (id: number) =>
    client.post<SalesOrder>(`/sales-orders/${id}/cancel`),
}
