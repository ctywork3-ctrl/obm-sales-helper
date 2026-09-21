import client from './client'

export interface TimelineEvent {
  id: number
  created_at: string
  actor_name: string
  actor_user_id: number | null
  actor_role: string | null
  action: string
  action_prefix: string
  entity_type: string | null
  entity_id: number | null
  entity_label: string | null
  result: string
  old_values: any
  new_values: any
  ip_address: string | null
}

export interface TimelineGroup {
  id: string
  entity_type: string | null
  entity_id: number | null
  entity_label: string | null
  events: TimelineEvent[]
  first_at: string
  last_at: string
  actor_name: string
  collapsed: boolean
}

export interface TimelineResponse {
  items: TimelineGroup[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface AnalyticsData {
  events_per_day: { date: string; count: number }[]
  by_action: { prefix: string; count: number }[]
  by_actor: { user_id: number; name: string; count: number }[]
  by_entity: { type: string; count: number }[]
  peak_hours: { hour: number; count: number }[]
  total_events: number
}

export const activityApi = {
  timeline: (params?: {
    page?: number
    page_size?: number
    action?: string
    entity_type?: string
    actor_user_id?: number
    start_date?: string
    end_date?: string
  }) => client.get<TimelineResponse>('/audit-logs/timeline', { params }),

  analytics: (params?: { days?: number }) =>
    client.get<AnalyticsData>('/audit-logs/analytics', { params }),

  get: (id: number) =>
    client.get<any>(`/audit-logs/${id}`),
}
