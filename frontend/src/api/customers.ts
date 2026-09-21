import client from './client'
import type { Customer, PaginatedResponse } from '@/types'

export interface CustomerOrderParams {
  page?: number
  page_size?: number
  status?: string
}

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

export interface CustomerContact {
  id: number
  customer_id: number
  name: string
  job_title?: string
  phone?: string
  mobile?: string
  email?: string
  whatsapp?: string
  is_primary: boolean
  is_active: boolean
  notes?: string
}

export interface CustomerAddress {
  id: number
  customer_id: number
  address_type: string
  label: string
  address_line1: string
  address_line2?: string
  postcode?: string
  city?: string
  state?: string
  country: string
  contact_name?: string
  contact_phone?: string
  delivery_notes?: string
  is_default: boolean
  is_active: boolean
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

  getOrders: (id: number, params?: CustomerOrderParams) =>
    client.get<PaginatedResponse<any>>(`/customers/${id}/orders`, { params }),

  listContacts: (id: number) =>
    client.get<CustomerContact[]>(`/customers/${id}/contacts`),

  listAddresses: (id: number) =>
    client.get<CustomerAddress[]>(`/customers/${id}/addresses`),

  createContact: (id: number, data: Omit<CustomerContact, 'id' | 'customer_id' | 'is_active'>) =>
    client.post<CustomerContact>(`/customers/${id}/contacts`, data),

  archiveContact: (customerId: number, contactId: number) =>
    client.delete(`/customers/${customerId}/contacts/${contactId}`),

  createAddress: (id: number, data: Omit<CustomerAddress, 'id' | 'customer_id' | 'is_active'>) =>
    client.post<CustomerAddress>(`/customers/${id}/addresses`, data),

  archiveAddress: (customerId: number, addressId: number) =>
    client.delete(`/customers/${customerId}/addresses/${addressId}`),

  assignSalesman: (id: number, salesman_id: number | null) =>
    client.patch<Customer>(`/customers/${id}/assign-salesman`, { salesman_id }),
}
