import client from './client'
import type { Product, ProductImage, ProductPrice, PaginatedResponse } from '@/types'

export interface ProductListParams {
  page?: number
  page_size?: number
  search?: string
  category?: string
  is_active?: boolean
}

export interface CreateProductRequest {
  obm_item_code: string
  item_code: string
  name: string
  category: string
  category_id?: number
  brand: string
  uom: string
  description?: string
  selling_price: number
  cost_price?: number
  stock_qty?: number
  stock_source?: string
  barcode?: string
  evidence_policy?: string
  inventory_model?: string
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
    // No Content-Type: the api client strips it so axios can set the multipart
    // boundary. Setting it by hand breaks the upload.
    return client.post<ProductImage>(`/products/${id}/images`, formData)
  },

  deleteImage: (productId: number, imageId: number) =>
    client.delete(`/product-images/${imageId}`),

  setPrimaryImage: (productId: number, imageId: number) =>
    client.post(`/product-images/${imageId}/set-primary`),

  listPrices: (id: number) =>
    client.get<ProductPrice[]>(`/products/${id}/prices`),

  createPrice: (id: number, data: { currency: string; unit_price: number; min_qty?: number | null }) =>
    client.post<ProductPrice>(`/products/${id}/prices`, data),

  updatePrice: (priceId: number, data: { unit_price?: number; min_qty?: number | null; is_active?: boolean }) =>
    client.patch<ProductPrice>(`/product-prices/${priceId}`, data),

  deletePrice: (priceId: number) =>
    client.delete(`/product-prices/${priceId}`),
}
