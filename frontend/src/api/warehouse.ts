import client from './client'
import type {
  DiscrepancyList,
  ReceivingDiscrepancy,
  ReceivingTask,
  StockLocation,
  StockOverview,
  WarrantyLookupResult,
} from '@/types'

export interface ReceivingTaskListParams {
  status?: string
  mine?: boolean
  assigned_to?: number
}

export interface CreateReceivingTaskRequest {
  purchase_order_id?: number
  supplier_name?: string
  assigned_to?: number
  due_date?: string
  priority?: string
  location_id?: number
  instructions?: string
  lines?: {
    product_id: number
    purchase_order_line_id?: number
    quantity_expected: number
    unit_cost?: number
    notes?: string
  }[]
}

export const warehouseApi = {
  // --- locations
  listLocations: (includeInactive = false) =>
    client.get<StockLocation[]>('/warehouse/locations', {
      params: { include_inactive: includeInactive },
    }),

  createLocation: (data: Partial<StockLocation>) =>
    client.post('/warehouse/locations', data),

  updateLocation: (id: number, data: Partial<StockLocation>) =>
    client.patch(`/warehouse/locations/${id}`, data),

  // --- receiving tasks
  listTasks: (params?: ReceivingTaskListParams) =>
    client.get<ReceivingTask[]>('/warehouse/receiving-tasks', { params }),

  getTask: (id: number) =>
    client.get<ReceivingTask>(`/warehouse/receiving-tasks/${id}`),

  createTask: (data: CreateReceivingTaskRequest) =>
    client.post<ReceivingTask>('/warehouse/receiving-tasks', data),

  updateTask: (id: number, data: Record<string, unknown>) =>
    client.patch<ReceivingTask>(`/warehouse/receiving-tasks/${id}`, data),

  startTask: (id: number) =>
    client.post<ReceivingTask>(`/warehouse/receiving-tasks/${id}/start`),

  scan: (
    id: number,
    data: { task_line_id: number; code: string; quantity?: number; condition?: string; note?: string },
  ) =>
    client.post<{
      result: string
      message: string
      quantity_scanned: number
      quantity_expected: number
      unit?: { id: number; serial_number: string }
    }>(`/warehouse/receiving-tasks/${id}/scan`, data),

  setLineQuantity: (taskId: number, lineId: number, quantity: number, notes?: string) =>
    client.post(`/warehouse/receiving-tasks/${taskId}/lines/${lineId}/quantity`, {
      quantity,
      notes,
    }),

  completeTask: (id: number, data: { allow_shortfall?: boolean; completion_notes?: string }) =>
    client.post<{
      task: ReceivingTask
      receipt_number: string
      receipt_id: number
      lines_moved: number
      shortfalls: number
      overages: number
    }>(`/warehouse/receiving-tasks/${id}/complete`, data),

  cancelTask: (id: number) =>
    client.post<ReceivingTask>(`/warehouse/receiving-tasks/${id}/cancel`),

  // --- stock
  stockOverview: (params?: {
    search?: string
    low_stock_only?: boolean
    low_stock_threshold?: number
    include_inactive?: boolean
    limit?: number
  }) => client.get<StockOverview>('/warehouse/stock-overview', { params }),

  stockMovements: (params?: { product_id?: number; limit?: number }) =>
    client.get('/warehouse/stock-movements', { params }),

  // --- warranty
  warrantyLookup: (code: string) =>
    client.get<WarrantyLookupResult>(`/warehouse/warranty/lookup/${encodeURIComponent(code)}`),

  listClaims: (status?: string) =>
    client.get('/warehouse/warranty/claims', { params: { status } }),

  createClaim: (data: { code: string; issue: string }) =>
    client.post('/warehouse/warranty/claims', data),

  updateClaim: (id: number, data: Record<string, unknown>) =>
    client.patch(`/warehouse/warranty/claims/${id}`, data),

  // --- count differences (the purchase manager's chase list) --------------

  listDiscrepancies: (params?: { status?: string; supplier?: string; open_only?: boolean }) =>
    client.get<DiscrepancyList>('/warehouse/discrepancies', { params }),

  updateDiscrepancy: (id: number, data: { status?: string; resolution_note?: string }) =>
    client.patch<ReceivingDiscrepancy>(`/warehouse/discrepancies/${id}`, data),

  taskDiscrepancies: (taskId: number) =>
    client.get<ReceivingDiscrepancy[]>(`/warehouse/receiving-tasks/${taskId}/discrepancies`),
}
