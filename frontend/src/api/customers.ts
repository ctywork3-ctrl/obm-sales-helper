import client from './client'
import type { Customer, PaginatedResponse } from '@/types'

export interface CustomerListParams {
  page?: number
  page_size?: number
  search?: string
  is_active?: boolean
}

export interface CreateCustomerRequest {
  name: string
  phone: string
  email?: string
  address?: string
  code?: string
}

export interface UpdateCustomerRequest extends Partial<CreateCustomerRequest> {
  is_active?: boolean
}

export const customersApi = {
  list: (params?: CustomerListParams) =>
    client.get<PaginatedResponse<Customer>>('/customers', { params }),

  listAll: (params?: CustomerListParams) =>
    client.get<PaginatedResponse<Customer>>('/customers/all', { params }),

  get: (id: number) =>
    client.get<Customer>(`/customers/${id}`),

  create: (data: CreateCustomerRequest) =>
    client.post<Customer>('/customers', data),

  update: (id: number, data: UpdateCustomerRequest) =>
    client.patch<Customer>(`/customers/${id}`, data),

  delete: (id: number) =>
    client.delete(`/customers/${id}`),
}
