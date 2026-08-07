import { useQuery } from '@tanstack/react-query'
import { auditLogsApi, type AuditLogListParams } from '@/api/auditLogs'

export function useAuditLogs(params?: AuditLogListParams) {
  return useQuery({
    queryKey: ['audit-logs', params],
    queryFn: () => auditLogsApi.list(params).then((res) => res.data),
  })
}

export function useAuditLog(id: number) {
  return useQuery({
    queryKey: ['audit-logs', id],
    queryFn: () => auditLogsApi.get(id).then((res) => res.data),
    enabled: !!id,
  })
}

export function useExportAuditLogs() {
  return auditLogsApi.export
}
