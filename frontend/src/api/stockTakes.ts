import client from './client'
import type { StockTakeCountLine, StockTakeSession } from '@/types'

export interface StartStockTakeRequest {
  scope: 'LOCATION' | 'PRODUCT' | 'ALL'
  location_id?: number
  product_id?: number
  notes?: string
  instructions?: string
}

export interface StockTakeScanResult {
  result: 'OK' | 'UNKNOWN' | 'NOT_IN_SCOPE' | 'ALREADY_COUNTED'
  message: string
  product_id?: number
  counted_qty?: number
  expected_qty?: number
  variance?: number
}

export interface CompleteStockTakeResponse {
  session: StockTakeSession
  applied: {
    product_id: number
    applied: boolean
    delta?: number
    adjustment_number?: string
    missing_serials?: string[]
    unexpected_serials?: string[]
    reason?: string
  }[]
  net_variance: number
  uncounted_lines: number
  message: string
}

export const stockTakesApi = {
  list: (params?: { status?: string; open_only?: boolean }) =>
    client.get<StockTakeSession[]>('/warehouse/stock-takes', { params }),

  get: (id: number) =>
    client.get<StockTakeSession>(`/warehouse/stock-takes/${id}`),

  start: (data: StartStockTakeRequest) =>
    client.post<StockTakeSession>('/warehouse/stock-takes', data),

  /** Scan a unit as present. Repeat scans are harmless. */
  scan: (id: number, code: string) =>
    client.post<StockTakeScanResult>(`/warehouse/stock-takes/${id}/scan`, { code }),

  /** Set the counted quantity on a bulk line. */
  setQuantity: (id: number, lineId: number, quantity: number, notes?: string) =>
    client.post<StockTakeCountLine>(`/warehouse/stock-takes/${id}/lines/${lineId}/quantity`, {
      quantity,
      notes,
    }),

  /** Post the differences. Needs a reason whenever anything differs. */
  complete: (id: number, completionNotes: string) =>
    client.post<CompleteStockTakeResponse>(`/warehouse/stock-takes/${id}/complete`, {
      completion_notes: completionNotes,
    }),

  cancel: (id: number) =>
    client.post<StockTakeSession>(`/warehouse/stock-takes/${id}/cancel`),
}
