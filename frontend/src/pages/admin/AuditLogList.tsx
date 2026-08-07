import { useState } from 'react'
import { useAuditLogs, useExportAuditLogs } from '@/hooks/useAuditLogs'
import LoadingSpinner from '@/components/LoadingSpinner'
import { formatDate } from '@/lib/utils'
import { Download, Eye } from 'lucide-react'

export default function AuditLogList() {
  const [page, setPage] = useState(1)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [selectedLog, setSelectedLog] = useState<any>(null)

  const { data, isLoading } = useAuditLogs({
    page,
    page_size: 20,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    action: action || undefined,
    entity_type: entityType || undefined,
  })
  const exportLogs = useExportAuditLogs()

  const handleExport = async () => {
    try {
      const response = await exportLogs({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        action: action || undefined,
        entity_type: entityType || undefined,
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `audit-logs-${new Date().toISOString().split('T')[0]}.csv`)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      alert('Failed to export audit logs')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label className="block text-sm font-medium">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Action</label>
            <select
              value={action}
              onChange={(e) => { setAction(e.target.value); setPage(1) }}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All Actions</option>
              <option value="auth.login">Login</option>
              <option value="auth.logout">Logout</option>
              <option value="sales_order">Sales Order</option>
              <option value="users">Users</option>
              <option value="products">Products</option>
              <option value="customers">Customers</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium">Entity Type</label>
            <select
              value={entityType}
              onChange={(e) => { setEntityType(e.target.value); setPage(1) }}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All Entities</option>
              <option value="user">User</option>
              <option value="product">Product</option>
              <option value="customer">Customer</option>
              <option value="sales_order">Sales Order</option>
            </select>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : !data?.items?.length ? (
        <div className="py-12 text-center text-muted-foreground">
          No audit logs found
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium">Actor</th>
                <th className="px-4 py-3 text-left font-medium">Action</th>
                <th className="px-4 py-3 text-left font-medium">Entity</th>
                <th className="px-4 py-3 text-left font-medium">Result</th>
                <th className="px-4 py-3 text-left font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((log) => (
                <tr key={log.id} className="border-b last:border-0">
                  <td className="px-4 py-3 text-xs">{formatDate(log.created_at)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{log.actor_name || `User #${log.actor_user_id}`}</p>
                    <p className="text-xs text-muted-foreground">{log.actor_role_at_time}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p>{log.entity_type}</p>
                    <p className="text-xs text-muted-foreground">{log.entity_label}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                        log.result === 'SUCCESS'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {log.result}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedLog(log)}
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1 text-sm">
            Page {page} of {data.pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            disabled={page === data.pages}
            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSelectedLog(null)} />
          <div className="relative z-50 max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold">Audit Log Details</h2>
            <div className="space-y-3 text-sm">
              <div>
                <span className="font-medium">Request ID:</span> {selectedLog.request_id}
              </div>
              <div>
                <span className="font-medium">Actor:</span> {selectedLog.actor_name || `User #${selectedLog.actor_user_id}`}
              </div>
              <div>
                <span className="font-medium">Action:</span> {selectedLog.action}
              </div>
              <div>
                <span className="font-medium">Entity:</span> {selectedLog.entity_type} #{selectedLog.entity_id}
              </div>
              <div>
                <span className="font-medium">IP Address:</span> {selectedLog.ip_address}
              </div>
              {selectedLog.old_values_json && Object.keys(selectedLog.old_values_json).length > 0 && (
                <div>
                  <span className="font-medium">Old Values:</span>
                  <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-xs">
                    {JSON.stringify(selectedLog.old_values_json, null, 2)}
                  </pre>
                </div>
              )}
              {selectedLog.new_values_json && Object.keys(selectedLog.new_values_json).length > 0 && (
                <div>
                  <span className="font-medium">New Values:</span>
                  <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-xs">
                    {JSON.stringify(selectedLog.new_values_json, null, 2)}
                  </pre>
                </div>
              )}
              {selectedLog.error_message && (
                <div>
                  <span className="font-medium text-destructive">Error:</span> {selectedLog.error_message}
                </div>
              )}
            </div>
            <button
              onClick={() => setSelectedLog(null)}
              className="mt-6 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
