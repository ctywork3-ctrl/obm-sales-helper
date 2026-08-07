import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCustomers, useDeleteCustomer } from '@/hooks/useCustomers'
import LoadingSpinner from '@/components/LoadingSpinner'
import SearchInput from '@/components/SearchInput'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Plus, Pencil, Trash2, Phone, MapPin } from 'lucide-react'

export default function SalesCustomerList() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteName, setDeleteName] = useState('')

  const { data, isLoading } = useCustomers({
    search: search || undefined,
    page,
    per_page: 12,
  })
  const deleteCustomer = useDeleteCustomer()

  const handleDelete = async () => {
    if (deleteId) {
      await deleteCustomer.mutateAsync(deleteId)
      setDeleteId(null)
    }
  }

  const customers = data?.items || []

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Customers</h1>
          <p className="text-sm text-muted-foreground">
            Register and manage your customer contacts
          </p>
        </div>
        <div className="flex gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search customers..."
            className="w-full sm:w-64"
          />
          <Link
            to="/sales/customers/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Customer
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : !customers.length ? (
        <div className="py-12 text-center text-muted-foreground">
          No customers yet. Add your first customer!
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {customers.map((customer) => (
            <div
              key={customer.id}
              className="rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{customer.name}</h3>
                  <p className="text-sm text-muted-foreground">{customer.code}</p>
                </div>
                <div className="flex gap-1">
                  <Link
                    to={`/sales/customers/${customer.id}/edit`}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => {
                      setDeleteId(customer.id)
                      setDeleteName(customer.name)
                    }}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </button>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                {customer.phone && customer.phone !== '-' && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {customer.phone}
                  </div>
                )}
                {customer.address && customer.address !== '-' && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    <span className="line-clamp-1">{customer.address}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
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
