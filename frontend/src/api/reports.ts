import client from './client'

export const reportsApi = {
  salesSummary: (params?: { date_from?: string; date_to?: string; salesman_id?: number; status?: string }) =>
    client.get('/reports/sales-summary', { params }),

  inventory: (params?: { category?: string; low_stock_only?: boolean }) =>
    client.get('/reports/inventory', { params }),

  commissions: (params?: { date_from?: string; date_to?: string }) =>
    client.get('/reports/commissions', { params }),
}
