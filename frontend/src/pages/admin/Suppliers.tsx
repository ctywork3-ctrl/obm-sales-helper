import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { masterDataApi, type Supplier } from '@/api/masterData'
import LoadingSpinner from '@/components/LoadingSpinner'
import { cn } from '@/lib/utils'
import { Building2, ChevronDown, ChevronRight, Plus, Save, Search, X } from 'lucide-react'

/**
 * Supplier master data.
 *
 * Why this page exists: the receiving-discrepancy queue groups by supplier, and
 * it used to group by a free-text `supplier_name`. Typing "Mismatch Supplier"
 * and "mismatch supplier" produced TWO vendors, so nobody could see how many
 * shortages one supplier actually owed. Suppliers are now real records with a
 * normalized name, and the API refuses a near-duplicate instead of silently
 * accepting it.
 */
export default function Suppliers() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
  })

  const { data: suppliers, isLoading } = useQuery({
    queryKey: ['suppliers', search, showInactive],
    queryFn: () =>
      masterDataApi
        .suppliers({ q: search || undefined, include_inactive: showInactive || undefined })
        .then((res) => res.data),
  })

  const createSupplier = useMutation({
    mutationFn: () => masterDataApi.createSupplier(draft),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setDraft({ name: '', contact_person: '', phone: '', email: '', address: '', notes: '' })
      setShowForm(false)
      setError('')
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail
      // The API answers 409 with the existing supplier when the name matches a
      // normalized duplicate, so say that plainly instead of "request failed".
      if (err?.response?.status === 409 && detail?.message) {
        setError(detail.message)
      } else if (typeof detail === 'string') {
        setError(detail)
      } else {
        setError('Could not create the supplier')
      }
    },
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      masterDataApi.updateSupplier(id, { is_active: isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Suppliers</h1>
            <p className="text-sm text-muted-foreground">
              Who you buy from. Count differences are grouped by these records, so one
              supplier is one entry — not one entry per spelling.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowForm((open) => !open)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Cancel' : 'Add supplier'}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}

      {showForm && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">New supplier</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium">Name *</label>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Seng Heng Fishing Tackle Sdn Bhd"
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Casing and extra spaces are ignored, so it cannot accidentally create a
                second copy of a supplier you already have.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium">Contact person</label>
              <input
                value={draft.contact_person}
                onChange={(event) => setDraft({ ...draft, contact_person: event.target.value })}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Phone</label>
              <input
                value={draft.phone}
                onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                placeholder="03-1234 5678"
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Email</label>
              <input
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Address</label>
              <input
                value={draft.address}
                onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium">Notes</label>
              <input
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                placeholder="30-day terms, 2-week lead time"
                className="mt-1 h-10 w-full rounded-md border px-3 text-sm"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => { setShowForm(false); setError(''); }}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => createSupplier.mutate()}
              disabled={!draft.name.trim() || createSupplier.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {createSupplier.isPending ? 'Saving...' : 'Save supplier'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or code..."
            className="h-10 w-full rounded-md border pl-9 pr-3 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
            className="h-4 w-4"
          />
          Show inactive
        </label>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !suppliers?.length ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          {search ? `No suppliers match "${search}".` : 'No suppliers yet.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {suppliers.map((supplier) => (
                <SupplierRow
                  key={supplier.id}
                  supplier={supplier}
                  isExpanded={expanded === supplier.id}
                  onToggle={() => setExpanded(expanded === supplier.id ? null : supplier.id)}
                  onToggleActive={(isActive) =>
                    toggleActive.mutate({ id: supplier.id, isActive })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SupplierRow({
  supplier,
  isExpanded,
  onToggle,
  onToggleActive,
}: {
  supplier: Supplier
  isExpanded: boolean
  onToggle: () => void
  onToggleActive: (isActive: boolean) => void
}) {
  // Only fetch the outstanding-shortage detail for a row the user opened, so
  // the list stays one request instead of one per supplier.
  const { data: detail, isLoading } = useQuery({
    queryKey: ['supplier-discrepancies', supplier.id],
    queryFn: () => masterDataApi.supplierDiscrepancies(supplier.id).then((res) => res.data),
    enabled: isExpanded,
  })

  return (
    <>
      <tr className={cn(!supplier.is_active && 'opacity-50')}>
        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
          {supplier.code || '—'}
        </td>
        <td className="px-4 py-3 font-medium">
          <button onClick={onToggle} className="inline-flex items-center gap-1 text-left hover:text-primary">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {supplier.name}
          </button>
          {supplier.obm_supplier_code && (
            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
              OBM {supplier.obm_supplier_code}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-muted-foreground">{supplier.contact_person || '—'}</td>
        <td className="px-4 py-3 text-muted-foreground">{supplier.phone || '—'}</td>
        <td className="px-4 py-3">
          <span
            className={cn(
              'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
              supplier.is_active
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-100 text-gray-600'
            )}
          >
            {supplier.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td className="px-4 py-3 text-right">
          <button
            onClick={() => onToggleActive(!supplier.is_active)}
            className="text-xs text-muted-foreground hover:text-primary"
          >
            {supplier.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-gray-50">
          <td colSpan={6} className="px-4 py-4">
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : (
              <div className="space-y-3">
                {supplier.notes && (
                  <div className="text-sm">
                    <span className="font-medium">Notes: </span>
                    <span className="text-muted-foreground">{supplier.notes}</span>
                  </div>
                )}
                {supplier.email || supplier.address ? (
                  <div className="text-sm text-muted-foreground">
                    {supplier.email}
                    {supplier.email && supplier.address ? ' · ' : ''}
                    {supplier.address}
                  </div>
                ) : null}

                <div>
                  <div className="mb-2 text-sm font-medium">Count differences</div>
                  {!detail?.total ? (
                    <div className="text-sm text-muted-foreground">
                      Nothing outstanding — every delivery has matched.
                    </div>
                  ) : (
                    <>
                      <div className="mb-2 flex flex-wrap gap-4 text-sm">
                        <span>
                          <span className="font-semibold">{detail.total}</span> total
                        </span>
                        <span className={detail.open ? 'text-amber-600' : 'text-muted-foreground'}>
                          <span className="font-semibold">{detail.open}</span> still open
                        </span>
                        <span className={detail.outstanding_units ? 'text-red-600' : 'text-muted-foreground'}>
                          <span className="font-semibold">{detail.outstanding_units}</span> units
                          owed to you
                        </span>
                      </div>
                      <table className="w-full max-w-2xl text-xs">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="py-1 font-medium">Status</th>
                            <th className="py-1 font-medium">Direction</th>
                            <th className="py-1 font-medium">Expected</th>
                            <th className="py-1 font-medium">Counted</th>
                            <th className="py-1 font-medium">Difference</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.slice(0, 10).map((item) => (
                            <tr key={item.id} className="border-t">
                              <td className="py-1">{item.status}</td>
                              <td className="py-1">{item.direction}</td>
                              <td className="py-1">{item.quantity_expected}</td>
                              <td className="py-1">{item.quantity_scanned}</td>
                              <td className={cn('py-1 font-medium', item.direction === 'SHORT' ? 'text-red-600' : 'text-amber-600')}>
                                {item.direction === 'SHORT' ? '−' : '+'}
                                {item.difference}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {detail.items.length > 10 && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Showing the 10 most recent of {detail.items.length}.
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
