import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCustomers, useDeleteCustomer } from '@/hooks/useCustomers'
import { customersApi } from '@/api/customers'
import { usersApi } from '@/api/users'
import { useAuth } from '@/hooks/useAuth'
import { getApiErrorMessage } from '@/lib/apiError'
import LoadingSpinner from '@/components/LoadingSpinner'
import SearchInput from '@/components/SearchInput'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Plus, Pencil, Trash2, ClipboardList, UserCog } from 'lucide-react'

export default function CustomerList() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteName, setDeleteName] = useState('')
  const [assignError, setAssignError] = useState('')

  const { data, isLoading } = useCustomers({
    search: search || undefined,
    page,
    page_size: 10,
  })
  const deleteCustomer = useDeleteCustomer()

  const canAssign = ['IT_ADMIN', 'DEVELOPER', 'MANAGER'].includes(user?.role || '')
  const { data: salesmen } = useQuery({
    queryKey: ['users', 'OUTSIDE_SALES'],
    queryFn: () => usersApi.list({ role: 'OUTSIDE_SALES', is_active: true }).then((res) => res.data),
    enabled: canAssign,
  })

  const assign = useMutation({
    mutationFn: ({ customerId, salesmanId }: { customerId: number; salesmanId: number | null }) =>
      customersApi.assignSalesman(customerId, salesmanId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      setAssignError('')
    },
    onError: (err) => setAssignError(getApiErrorMessage(err, 'Failed to assign salesman')),
  })

  const salesmenOptions = salesmen || []

  const renderAssignSelect = (customer: { id: number; salesman_id?: number | null }) => (
    <select
      value={customer.salesman_id ?? ''}
      disabled={assign.isPending}
      onChange={(e) =>
        assign.mutate({
          customerId: customer.id,
          salesmanId: e.target.value ? Number(e.target.value) : null,
        })
      }
      className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
      title="Choose which outside salesman can see this customer"
    >
      <option value="">Unassigned</option>
      {salesmenOptions.map((s) => (
        <option key={s.id} value={s.id}>
          {s.full_name}
        </option>
      ))}
    </select>
  )

  const handleDelete = async () => {
    if (deleteId) {
      await deleteCustomer.mutateAsync(deleteId)
      setDeleteId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          {canAssign && (
            <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
              <UserCog className="h-3.5 w-3.5" />
              Choose the assigned salesman per customer — only they see the customer in their list.
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search customers..."
            className="w-full sm:w-64"
          />
          <Link
              to="/app/admin/customers/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Customer
          </Link>
        </div>
      </div>

      {assignError && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{assignError}</div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : !data?.items?.length ? (
        <div className="py-12 text-center text-muted-foreground">
          No customers found
        </div>
      ) : (
        <>
          <div className="sm:hidden space-y-3">
            {data.items.map((customer) => (
              <div key={customer.id} className="rounded-lg border bg-white p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{customer.name}</p>
                    <p className="text-sm text-muted-foreground">{customer.code || customer.obm_customer_code}</p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium flex-shrink-0 ${
                      customer.is_active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {customer.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {customer.phone && customer.phone !== '-' && (
                  <p className="text-sm text-muted-foreground">{customer.phone}</p>
                )}
                {customer.email && customer.email !== '-' && (
                  <p className="text-sm text-muted-foreground truncate">{customer.email}</p>
                )}
                {canAssign && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Assigned salesman</p>
                    {renderAssignSelect(customer)}
                  </div>
                )}
                <div className="flex items-center gap-3 pt-2 border-t">
                  <Link
                    to={`/app/sales/customers/${customer.id}/orders`}
                    className="flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium hover:bg-accent"
                  >
                    <ClipboardList className="h-4 w-4" />
                    Orders
                  </Link>
                  <Link
                    to={`/app/admin/customers/${customer.id}/edit`}
                    className="flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium hover:bg-accent"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Link>
                  <button
                    onClick={() => {
                      setDeleteId(customer.id)
                      setDeleteName(customer.name)
                    }}
                    className="flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium text-destructive hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden sm:block overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Phone</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  {canAssign && <th className="px-4 py-3 text-left font-medium">Assigned Salesman</th>}
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((customer) => (
                  <tr key={customer.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{customer.name}</td>
                    <td className="px-4 py-3">{customer.code || customer.obm_customer_code}</td>
                    <td className="px-4 py-3">{customer.phone || '-'}</td>
                    <td className="px-4 py-3">{customer.email || '-'}</td>
                    {canAssign && <td className="px-4 py-3">{renderAssignSelect(customer)}</td>}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                          customer.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {customer.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Link
                          to={`/app/sales/customers/${customer.id}/orders`}
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          title="Order History"
                        >
                          <ClipboardList className="h-4 w-4" />
                        </Link>
                        <Link
                          to={`/app/admin/customers/${customer.id}/edit`}
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={() => {
                            setDeleteId(customer.id)
                            setDeleteName(customer.name)
                          }}
                          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title={`Delete ${deleteName}`}
        description="Are you sure you want to delete this customer?"
        confirmText="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        isLoading={deleteCustomer.isPending}
      />
    </div>
  )
}
