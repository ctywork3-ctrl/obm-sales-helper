import client from './client'
import type { StockTransfer, TransferableProduct } from '@/types'

export interface CreateTransferRequest {
  from_location_id: number
  to_location_id: number
  notes?: string
  instructions?: string
  lines: { product_id: number; quantity: number; notes?: string }[]
}

export interface TransferScanResult {
  result: string
  message: string
  product_id?: number
  quantity_dispatched?: number
  quantity_received?: number
  quantity_expected?: number
  transfer: StockTransfer
}

export interface CompleteTransferResponse {
  transfer: StockTransfer
  received_units: number
  in_flight_released: number
  message: string
}

export const transfersApi = {
  list: (params?: { status?: string; open_only?: boolean }) =>
    client.get<StockTransfer[]>('/warehouse/transfers', { params }),

  get: (id: number) =>
    client.get<StockTransfer>(`/warehouse/transfers/${id}`),

  /** What can actually be sent from a location right now. */
  transferable: (fromLocationId: number, search?: string) =>
    client.get<TransferableProduct[]>('/warehouse/transfers/transferable', {
      params: { from_location_id: fromLocationId, search },
    }),

  create: (data: CreateTransferRequest) =>
    client.post<StockTransfer>('/warehouse/transfers', data),

  /** Scan out of the source (DISPATCH) or into the destination (RECEIVE). */
  scan: (id: number, code: string, phase: 'DISPATCH' | 'RECEIVE') =>
    client.post<TransferScanResult>(`/warehouse/transfers/${id}/scan`, { code, phase }),

  dispatch: (id: number, notes?: string) =>
    client.post<StockTransfer>(`/warehouse/transfers/${id}/dispatch`, { notes }),

  complete: (id: number, completionNotes?: string) =>
    client.post<CompleteTransferResponse>(`/warehouse/transfers/${id}/complete`, {
      completion_notes: completionNotes,
    }),

  cancel: (id: number) =>
    client.post<StockTransfer>(`/warehouse/transfers/${id}/cancel`),
}
