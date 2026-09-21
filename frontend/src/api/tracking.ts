import client from './client'

export interface SalesmanLocation {
  user_id: number
  username: string
  full_name: string
  role: string
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  source: string | null
  last_seen_at: string | null
  is_online: boolean
}

export interface LocationPoint {
  id: number
  latitude: number
  longitude: number
  accuracy: number | null
  source: string
  order_id: number | null
  created_at: string | null
}

export interface CustomerVisit {
  id: number
  salesman_name: string
  customer_name: string
  customer_id: number | null
  latitude: number
  longitude: number
  accuracy: number | null
  visited_at: string | null
}

export const trackingApi = {
  sendLocation: (data: {
    latitude: number
    longitude: number
    accuracy?: number
    source?: string
    order_id?: number
    customer_id?: number
  }) => client.post('/tracking/location', data),

  getSalesmen: () =>
    client.get<{ salesmen: SalesmanLocation[] }>('/tracking/salesmen'),

  getHistory: (userId: number, hours?: number) =>
    client.get<{ locations: LocationPoint[]; total: number }>(
      `/tracking/history/${userId}`,
      { params: hours ? { hours } : undefined }
    ),

  getVisitsToday: () =>
    client.get<{ visits: CustomerVisit[] }>('/tracking/visits/today'),

  getOrderLocation: (orderId: number) =>
    client.get<{ latitude: number | null; longitude: number | null; accuracy: number | null; created_at: string | null }>(
      `/tracking/order/${orderId}`
    ),
}
