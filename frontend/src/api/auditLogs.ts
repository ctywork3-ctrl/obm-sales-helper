import client from './client'
import type { AuditLog, PaginatedResponse } from '@/types'

export interface AuditLogListParams {
  page?: number
  page_size?: number
  per_page?: number
  actor_user_id?: number
  action?: string
  entity_type?: string
  entity_id?: number
  start_date?: string
  end_date?: string
  date_from?: string
  date_to?: string
}

export const auditLogsApi = {
  list: (params?: AuditLogListParams) => {
    const query: Record<string, any> = {}
    if (params) {
      if (params.page) query.page = params.page
      if (params.per_page) query.page_size = params.per_page
      if (params.action) query.action = params.action
      if (params.entity_type) query.entity_type = params.entity_type
      if (params.actor_user_id) query.actor_user_id = params.actor_user_id
      if (params.date_from) query.start_date = params.date_from
      if (params.date_to) query.end_date = params.date_to
    }
    return client.get<PaginatedResponse<AuditLog>>('/audit-logs', { params: query })
  },

  get: (id: number) =>
    client.get<AuditLog>(`/audit-logs/${id}`),

  export: (params?: AuditLogListParams) => {
    const query: Record<string, any> = {}
    if (params) {
      if (params.action) query.action = params.action
      if (params.entity_type) query.entity_type = params.entity_type
      if (params.date_from) query.start_date = params.date_from
      if (params.date_to) query.end_date = params.date_to
    }
    return client.get('/audit-logs/export', {
      params: query,
      responseType: 'blob',
    })
  },
}
