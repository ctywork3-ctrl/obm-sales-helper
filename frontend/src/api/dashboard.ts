import client from './client'

export interface DashboardStats {
  total_orders: number
  pending_orders: number
  total_revenue: number
  total_products: number
  low_stock_count: number
  low_stock_products: Array<{id: number, name: string, stock_qty: number, item_code: string}>
  recent_orders: Array<{id: number, order_number: string, status: string, total_amount: number, created_at: string}>
}

export const getDashboardStats = async (): Promise<DashboardStats> => {
  const response = await client.get('/dashboard/stats')
  return response.data
}