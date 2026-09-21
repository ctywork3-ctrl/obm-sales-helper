import client from './client'

export interface InventoryProductSummary {
  id: number
  name: string
  item_code?: string | null
  obm_item_code?: string | null
  category?: string | null
  brand?: string | null
  uom?: string | null
  description?: string | null
  selling_price?: number
  stock_qty: number
  inventory_model?: string | null
  images: { id: number; file_path: string; is_primary: boolean }[]
}

export interface InventoryUnit {
  id: number
  unit_code?: string | null
  serial_number: string
  manufacturer_serial?: string | null
  barcode?: string | null
  status: string
  warehouse_location?: string | null
  batch_number?: string | null
  product_id: number
  product_name?: string | null
  product_code?: string | null
  received_at?: string | null
  receipt_id?: number | null
}

export interface InventoryReceiptLineInput {
  product_id: number
  quantity: number
  tracking_mode: 'SERIALIZED' | 'BULK'
  batch_number?: string
  unit_cost?: number
  manufacturer_serials?: string[]
  purchase_order_line_id?: number
}

export interface InventoryReceipt {
  id: number
  receipt_number: string
  status: string
  supplier_name?: string | null
  reference_number?: string | null
  warehouse_location?: string | null
  notes?: string | null
  received_at: string
  created_by: number
  posted_by?: number | null
  posted_at?: string | null
  lines: {
    id: number
    product_id: number
    product?: InventoryProductSummary | null
    quantity: number
    tracking_mode: string
    batch_number?: string | null
    unit_cost?: number | null
    unit_count: number
  }[]
  units: InventoryUnit[]
  images: InventoryReceiptImage[]
}

export interface InventoryReceiptImage {
  id: number
  receipt_id: number
  file_path: string
  original_filename?: string | null
  caption?: string | null
  uploaded_by: number
  created_at?: string | null
}

export interface InventoryResolution {
  found: boolean
  value: string
  result_type: 'UNIT' | 'PRODUCT' | 'UNKNOWN'
  unit?: InventoryUnit | null
  product?: InventoryProductSummary | null
}

export interface InventoryUnitProfile {
  unit: InventoryUnit
  product: InventoryProductSummary | null
  images: { id: number; file_path: string; caption?: string | null; created_at?: string | null }[]
  movements: {
    id: number
    quantity_delta: number
    movement_type: string
    source_type?: string | null
    source_id?: number | null
    reason?: string | null
    created_at?: string | null
  }[]
}

export const inventoryApi = {
  receive: (data: {
    supplier_name?: string
    reference_number?: string
    warehouse_location?: string
    received_at?: string
    notes?: string
    purchase_order_id?: number
    lines: InventoryReceiptLineInput[]
  }) =>
    client.post<InventoryReceipt>('/inventory/receipts', data, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),

  adjust: (data: { product_id: number; quantity_delta: number; reason: string; warehouse_location?: string }) =>
    client.post('/inventory/adjustments', data, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),

  listReceipts: () => client.get<InventoryReceipt[]>('/inventory/receipts'),

  getReceipt: (id: number) => client.get<InventoryReceipt>(`/inventory/receipts/${id}`),

  uploadReceiptImage: (id: number, file: File, caption?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (caption) form.append('caption', caption)
    // No Content-Type: stripped by the api client so axios sets the boundary.
    return client.post<InventoryReceiptImage>(`/inventory/receipts/${id}/images`, form)
  },

  resolve: (value: string) => client.get<InventoryResolution>(`/inventory/resolve/${encodeURIComponent(value)}`),

  getUnit: (id: number) => client.get<InventoryUnitProfile>(`/inventory/units/${id}`),
}

export const inventoryPrivateMedia = {
  receiptImage: (id: number) => `/api/inventory/receipt-images/${id}/file`,
  intakePhoto: (id: number) => `/api/barcodes/intake-request/${id}/photo`,
}

export const intakeApi = {
  list: (status = 'PENDING_REVIEW') => client.get<any[]>('/barcodes/intake-requests', { params: { request_status: status } }),
  create: (data: {
    barcode_value?: string
    product_name: string
    brand?: string
    category?: string
    description?: string
    quantity_received?: number
    supplier_name?: string
    suggested_selling_price?: string
    suggested_cost_price?: string
  }) => client.post<{ id: number; request_number: string; status: string }>('/barcodes/intake-request', data),

  uploadPhoto: (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    // No Content-Type: stripped by the api client so axios sets the boundary.
    return client.post(`/barcodes/intake-request/${id}/photo`, form)
  },

  submit: (id: number) => client.post(`/barcodes/intake-request/${id}/submit`),

  resolve: (id: number, data: { existing_product_id?: number; item_code?: string; selling_price?: number; cost_price?: number; review_notes?: string }) =>
    client.post(`/barcodes/intake-request/${id}/resolve`, data),
}
