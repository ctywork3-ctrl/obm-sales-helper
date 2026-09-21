import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Search } from 'lucide-react'
import { customersApi } from '@/api/customers'
import { usersApi } from '@/api/users'
import { getApiErrorMessage } from '@/lib/apiError'
import LoadingSpinner from '@/components/LoadingSpinner'
import WorkflowHeader from '@/components/WorkflowHeader'

export default function CustomerAssignments() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, page],
    queryFn: () => customersApi.listAll({ search: search || undefined, page, page_size: 20 }).then((res) => res.data),
  })

  const { data: salesmen } = useQuery({
    queryKey: ['users', 'OUTSIDE_SALES'],
    queryFn: () => usersApi.list({ role: 'OUTSIDE_SALES', is_active: true }).then((res) => res.data),
  })

  const assign = useMutation({
    mutationFn: ({ customerId, salesmanId }: { customerId: number; salesmanId: number | null }) =>
      customersApi.assignSalesman(customerId, salesmanId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      setError('')
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Failed to assign salesman')),
  })

  const totalPages = data?.pages ?? 1

  return (
    <div className="space-y-6">
      <WorkflowHeader
        title="Customer Assignments"
        subtitle="Assign outside sales representatives to existing customers."
        icon={<Users className="h-5 w-5" />}
        backLabel="Back to dashboard"
        onBack={() => window.history.back()}
      />

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search customers..."
            className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium">Customer</th>
                  <th className="pb-2 font-medium">Code</th>
                  <th className="pb-2 font-medium">Assigned Salesman</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((customer) => (
                  <tr key={customer.id} className="border-b last:border-0">
                    <td className="py-2">
                      <p className="font-medium">{customer.name}</p>
                      {customer.phone && customer.phone !== '-' && (
                        <p className="text-xs text-muted-foreground">{customer.phone}</p>
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">{customer.code || customer.obm_customer_code || '-'}</td>
                    <td className="py-2">
                      <select
                        value={customer.salesman_id ?? ''}
                        disabled={assign.isPending}
                        onChange={(e) =>
                          assign.mutate({
                            customerId: customer.id,
                            salesmanId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      >
                        <option value="">Unassigned</option>
                        {(salesmen ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.full_name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {(data?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-muted-foreground">
                      No customers found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
