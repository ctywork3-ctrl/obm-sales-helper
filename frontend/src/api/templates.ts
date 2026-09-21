import client from './client'

export interface OrderTemplateItem {
  id: number
  product_id: number
  product_name?: string
  product_code?: string
  quantity: number
  unit_price?: number
}

export interface OrderTemplate {
  id: number
  name: string
  customer_id?: number
  notes?: string
  currency: string
  item_count: number
  items: OrderTemplateItem[]
  created_at?: string
}

export interface ProductUnit {
  id: number
  unit_code?: string
  serial_number: string
  manufacturer_serial?: string
  barcode?: string
  status: string
  warehouse_location?: string
  batch_number?: string
  received_at?: string
  sold_at?: string
  order_id?: number
  created_at?: string
}

export const orderTemplatesApi = {
  list: () => client.get<OrderTemplate[]>('/order-templates'),

  create: (data: { name: string; customer_id?: number; notes?: string; currency?: string; items: { product_id: number; quantity: number; unit_price?: number }[] }) =>
    client.post<OrderTemplate>('/order-templates', data),

  delete: (id: number) => client.delete(`/order-templates/${id}`),
}

export const productUnitsApi = {
  listForProduct: (productId: number) =>
    client.get<ProductUnit[]>(`/product-units/product/${productId}`),

  create: (data: { product_id: number; serial_number?: string; barcode?: string; warehouse_location?: string; batch_number?: string }) =>
    client.post<ProductUnit>('/product-units', data),

  lookup: (serialNumber: string) =>
    client.get<any>(`/product-units/lookup/${serialNumber}`),

  update: (id: number, data: { status?: string; warehouse_location?: string; barcode?: string; order_id?: number }) =>
    client.patch(`/product-units/${id}`, data),

  listImages: (id: number) => client.get(`/product-units/${id}/images`),
  imageUrl: (imageId: number) => `/api/product-units/images/${imageId}/file`,

  uploadImage: (id: number, file: File, caption?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (caption) form.append('caption', caption)
    // No Content-Type: stripped by the api client so axios sets the boundary.
    return client.post(`/product-units/${id}/images`, form)
  },
}
