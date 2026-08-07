import client from './client'
import type { Product, ProductImage, PaginatedResponse } from '@/types'

export interface ProductListParams {
  page?: number
  per_page?: number
  search?: string
  category?: string
  is_active?: boolean
}

export interface CreateProductRequest {
  obm_item_code: string
  item_code: string
  name: string
  category: string
  brand: string
  uom: string
  description?: string
  selling_price: number
  cost_price?: number
  stock_qty?: number
  stock_source?: string
  barcode?: string
  is_active?: boolean
}

export interface UpdateProductRequest extends Partial<CreateProductRequest> {}

export const productsApi = {
  list: (params?: ProductListParams) =>
    client.get<PaginatedResponse<Product>>('/products', { params }),

  listAll: (params?: ProductListParams) =>
    client.get<PaginatedResponse<Product>>('/products/all', { params }),

  get: (id: number) =>
    client.get<Product>(`/products/${id}`),

  create: (data: CreateProductRequest) =>
    client.post<Product>('/products', data),

  update: (id: number, data: UpdateProductRequest) =>
    client.patch<Product>(`/products/${id}`, data),

  delete: (id: number) =>
    client.delete(`/products/${id}`),

  uploadImage: (id: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return client.post<ProductImage>(`/products/${id}/images`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  deleteImage: (productId: number, imageId: number) =>
    client.delete(`/products/${productId}/images/${imageId}`),

  setPrimaryImage: (productId: number, imageId: number) =>
    client.patch(`/products/${productId}/images/${imageId}/primary`),

  getImages: (id: number) =>
    client.get<ProductImage[]>(`/products/${id}/images`),
}
